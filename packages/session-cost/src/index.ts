/**
 * dsh-session-cost host half: the `sessionCost` session projection.
 *
 * Replays the durable session log and bills every model call at its event
 * time — but ONLY for providers with known per-token pricing. Providers are
 * classified in PROVIDERS:
 *  - 'metered': per-token billing (currently only deepseek-official). Every
 *    metered provider owns an `eras` table: a date-ordered list of price
 *    schedules, each with its own `since` (and optional `until`), peak
 *    windows, and per-model prices. A price change = APPEND one era; nothing
 *    existing is edited, and historical events keep billing at the era that
 *    was in effect at their event time;
 *  - 'subscription': flat-plan endpoints (kimi-coding, opencode-go) where the
 *    per-token figure is NOT a real bill — but when the provider publishes
 *    API list prices, the subscription entry carries reference `eras` so the
 *    projection can estimate "what these tokens would have cost". Consumers
 *    mark such figures with ≈ (the sole non-exact marker);
 *  - anything else: 'unknown' — tokens counted, cost is 0, NEVER silently
 *    billed at another provider's price sheet.
 *
 * TIME ZONES: era boundaries (`since`/`until`) are absolute instants (epoch
 * ms or ISO strings — timezone-carrying, unambiguous). Peak windows are UTC
 * hours, half-open [start, end), because isPeakHour reads getUTCHours().
 * When a provider's official sheet states windows in another timezone
 * (DeepSeek declares them in Beijing time), write the sheet's own hours and
 * convert with toUtcWindows(windows, offsetHours) so the conversion stays
 * visible next to the source numbers.
 *
 * This package owns ONLY the projection and its display-currency config
 * (settings namespace `session-cost`); rendering lives in consumer plugins
 * (dsh-session-cost) that read the projection by key. The view carries the
 * resolved currency so consumers need no config channel.
 *
 * The projection itself is pure (init/apply/view), needs no ledger, and
 * makes no network calls. Prices are pinned constants; a provider price
 * change is one new era in PROVIDERS plus a stateVersion bump.
 */

import { z } from 'zod'
import Schema from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { currencyCode, formatMoney, resolveCurrency, type Currency, type PluginConfig } from './currency'

export const name = 'session-cost'

/** 峰谷窗口,UTC 小时,半开区间 [start, end);允许跨午夜(start > end)。 */
export interface PeakWindow {
  start: number
  end: number
}

/**
 * 一档价格,USD / 1M tokens。
 * cacheHit 命中价的读取部分;cacheWrite 为缓存写入价,缺省按 cacheHit 计
 * (DeepSeek/Kimi 口径:写缓存不另收费;OpenAI/Anthropic 风格"写读不同价"
 * 的价表必须显式给出)。
 */
export interface PriceTier {
  cacheHit: number
  cacheMiss: number
  output: number
  /** 缓存写入价;缺省 = cacheHit。 */
  cacheWrite?: number
}

/** 一个模型的价格档:基价 + 可选峰时档 + 可选长上下文档。 */
export interface PriceEntry extends PriceTier {
  /** 峰时价;缺省则峰谷同价。 */
  peak?: PriceTier
  /**
   * 长上下文价:单次请求 prompt(input+cacheRead+cacheWrite)≥ threshold
   * 时整档替换基价(如 OpenAI 的 ≥272K 长上下文价)。与 peak 不组合——
   * 目前声明 longContext 的价表(OpenAI)没有峰谷;将来若两者并存需扩展。
   */
  longContext?: PriceTier & { threshold: number }
}

/**
 * 一个价格时代:since(含)到 until(不含,缺省正无穷)内生效。
 * since/until 为 ISO 带时区字符串或 epoch ms;peakWindows 为空 = 统一价。
 */
export interface Era {
  since: string | number
  until?: string | number
  peakWindows: PeakWindow[]
  models: Record<string, PriceEntry>
}

export interface MeteredProvider {
  kind: 'metered'
  eras: Era[]
}

export interface SubscriptionProvider {
  kind: 'subscription'
  label: string
  /** 官方 API 刊例价参考表(可选);估算"这些 token 值多少钱",非真实账单。 */
  eras?: Era[]
}

export type ProviderEntry = MeteredProvider | SubscriptionProvider

/** 一次用量的四个计费桶(投影内部形状;reasoning 只展示不计费)。 */
export interface UsageBuckets {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
}

export interface Totals extends UsageBuckets {
  cost: number
}

export type PricingKind = 'metered' | 'subscription' | 'unknown'

export interface RateResult {
  kind: PricingKind
  label?: string
  era?: Era
  entry?: PriceEntry
  tier?: PriceTier
}

/** 会话事件的最小面(本投影只消费这三种)。 */
export interface SessionEvent {
  type: string
  time?: number
  data?: {
    header?: { config?: { provider?: unknown; model?: unknown } }
    turn?: number
    step?: number
    chunk?: { type?: string; usage?: RawUsage }
    usage?: RawUsage
  }
}

/** 事件里的原始 usage 形状(inputTokens 键)。 */
export interface RawUsage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/** 某一步 (turn, step) 当前生效的用量样本(替换式去重的最小记录)。 */
interface StepSample {
  provider: string | null
  model: string | null
  kind: PricingKind
  buckets: UsageBuckets
  cost: number
}

export interface ProjectionState {
  provider: string | null
  model: string | null
  totals: Totals
  /** 各计价类别当前生效样本数(替换旧样本时递减,归零即消失)。 */
  kinds: Record<PricingKind, number>
  /** 逐步样本表,key 为 `${turn}:${step}`;同 key 新样本先减旧再加。 */
  samples: Record<string, StepSample>
}

export interface SessionCostView extends Totals {
  pricing: 'none' | 'metered' | 'subscription' | 'mixed' | 'unknown'
  /** 有未知路由的用量未计入 cost(展示的金额只是已知部分的下限)。 */
  partial: boolean
  /** 宿主端按 loader 行 config 解析的显示币种,客户端直接采用。 */
  currency: Currency
  /**
   * 自描述的费用显示串('≈¥0.0082'):数据 owner 负责格式化,消费方
   * 原样摆放。metered 精确;subscription/mixed/partial 加 ≈ 估算标记;
   * unknown/none/零成本省略(绝不展示按别家价表套出的数字)。
   */
  display?: { cost: string }
}

/** dsh-session-projection 的投影单元契约。 */
export interface ProjectionUnit<S, V> {
  key: string
  schema: z.ZodType<V>
  /** 0.1.1 起注册表只把带 wire 的投影视图发给浏览器(snapshot/drive 全路径)。 */
  wire?: { viewSchema: z.ZodType<V>; view: (state: S) => V }
  stateVersion: number
  init: () => S
  apply: (state: S, event: SessionEvent) => S
  view: (state: S) => V
}

/** Cordis 上下文的最小面(只声明本插件用到的)。 */
export interface CordisContext {
  inject: (services: string[], callback: (ctx: CordisContext) => void) => void
  effect?: (fn: () => unknown, label?: string) => void
  sessionProjections?: { register: <S, V>(unit: ProjectionUnit<S, V>) => void }
  /** dsh-settings 服务:注册命名空间 schema,拿回 owner scope。 */
  settings?: {
    register: (ns: string, schema: unknown, options?: { base?: unknown }) => {
      get: () => unknown
      watch: (callback: () => void) => () => void
    }
  }
}

/**
 * 将一个provider价目表声明的窗口换算为 UTC 窗口。
 * windows 为该价目表使用的本地时区小时(半开 [start, end)),tzOffset 为
 * 该时区相对 UTC 的小时偏移(如北京时间 = 8)。
 */
export function toUtcWindows(windows: PeakWindow[], tzOffset: number): PeakWindow[] {
  return windows.map((w) => ({
    start: (((w.start - tzOffset) % 24) + 24) % 24,
    end: (((w.end - tzOffset) % 24) + 24) % 24,
  }))
}

/** 时刻归一:ISO 字符串或 epoch ms → epoch ms;非法输入为 NaN。 */
function timeMs(value: string | number | undefined): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Date.parse(value)
  return NaN
}

/**
 * 按 provider 组织的计价表。新 provider 支持 = 在此加一条;某 provider
 * 调价 = 在其 eras 末尾追加一个时代(since 为生效时刻):
 *  - metered:eras 按 since 升序,每个时代 {since, until?, peakWindows,
 *    models};models 下每个模型一档 {cacheHit, cacheMiss, output}(即该
 *    时代谷时/统一价),可选 peak 细分(峰时价,缺省则峰谷同价)。
 *    peakWindows 为 UTC 小时半开区间;空数组 = 该时代无峰谷(统一价)。
 *  - subscription:订阅/包月端点,不按 token 产生真实账单;若官方发布了
 *    API 刊例价,可带 eras 参考价表(结构与 metered 相同),cost 为
 *    "这些 token 按刊例价值多少钱"的估算,客户端以 ≈ 标记展示;
 *    不配 eras 则 cost 恒 0,不显示费用。
 * 没有 default 回退:不认识的 provider、模型或"无时代覆盖的时刻"一律
 * unknown(不计费),绝不套用别家或别时代的价表。
 */
export const PROVIDERS: Record<string, ProviderEntry> = {
  'deepseek-official': {
    kind: 'metered',
    eras: [
      {
        // 峰谷计价前的统一价(官方旧价目表),2026-08-17 00:00 北京时间止。
        since: 0,
        until: '2026-08-16T16:00:00Z',
        peakWindows: [],
        models: {
          'deepseek-v4-flash': { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
          'deepseek-v4-pro': { cacheHit: 0.003625, cacheMiss: 0.435, output: 0.87 },
        },
      },
      {
        // 峰谷计价,官方 2026-08-17 00:00 北京时间生效 = 2026-08-16 16:00 UTC。
        // 官方高峰按北京时间声明:09:00-12:00 与 14:00-18:00(几乎正好覆盖
        // 中国工作日),此处用 toUtcWindows 显式换算。
        since: '2026-08-16T16:00:00Z',
        peakWindows: toUtcWindows([
          { start: 9, end: 12 }, // 北京 09:00-12:00 → UTC 01:00-04:00
          { start: 14, end: 18 }, // 北京 14:00-18:00 → UTC 06:00-10:00
        ], 8),
        models: {
          'deepseek-v4-flash': {
            cacheHit: 0.007,
            cacheMiss: 0.22,
            output: 0.66,
            peak: { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32 },
          },
          'deepseek-v4-pro': {
            cacheHit: 0.022,
            cacheMiss: 0.66,
            output: 1.98,
            peak: { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 },
          },
        },
      },
    ],
  },
  'kimi-coding': {
    kind: 'subscription',
    label: 'Kimi For Coding',
    // 订阅端点,不产生真实账单;以下按官方 API 刊例价(USD/1M)作参考估算:
    //  - K3:cacheHit 0.30 / cacheMiss 3.0 / output 15.0(k3 是 DSH 默认路由
    //    上报的模型 id,与 k3-256k 同一模型,同刊例价);
    //  - K2.7 Code:cacheHit 0.19 / cacheMiss 0.95 / output 4.0,官方模型 id
    //    为 kimi-k2.7-code,k2.7-code 为 DSH 风格简写,同刊例价。
    eras: [
      {
        since: 0,
        peakWindows: [],
        models: {
          'k3': { cacheHit: 0.3, cacheMiss: 3.0, output: 15.0 },
          'k3-256k': { cacheHit: 0.3, cacheMiss: 3.0, output: 15.0 },
          'kimi-k2.7-code': { cacheHit: 0.19, cacheMiss: 0.95, output: 4.0 },
          'k2.7-code': { cacheHit: 0.19, cacheMiss: 0.95, output: 4.0 },
        },
      },
    ],
  },
  'opencode-go': { kind: 'subscription', label: 'opencode-go' },
  // OpenAI 官方 metered(provider id 取自 pi-ai 内建目录的 "openai")。
  // 2026-08 官方价目表 Standard 服务档;Batch/Flex 半价、Fast 翻倍,事件流
  // 不携带 service_tier,一律按 Standard 计——走 Batch/Fast 的路由会算错,
  // 请勿依赖。短/长上下文按单次请求 prompt 是否 ≥272K 分档(longContext)。
  openai: {
    kind: 'metered',
    eras: [
      {
        since: 0,
        peakWindows: [],
        models: {
          'gpt-5.6-sol': {
            cacheHit: 0.5, cacheMiss: 5.0, output: 30.0, cacheWrite: 6.25,
            longContext: { threshold: 272_000, cacheHit: 1.0, cacheMiss: 10.0, output: 45.0, cacheWrite: 12.5 },
          },
          'gpt-5.6-terra': {
            cacheHit: 0.2, cacheMiss: 2.0, output: 12.0, cacheWrite: 2.5,
            longContext: { threshold: 272_000, cacheHit: 0.4, cacheMiss: 4.0, output: 18.0, cacheWrite: 5.0 },
          },
          'gpt-5.6-luna': {
            cacheHit: 0.02, cacheMiss: 0.2, output: 1.2, cacheWrite: 0.25,
            longContext: { threshold: 272_000, cacheHit: 0.04, cacheMiss: 0.4, output: 1.8, cacheWrite: 0.5 },
          },
        },
      },
    ],
  },
}

/** 某一时刻是否处于峰时段。atMs 为 epoch ms;windows 为 UTC 小时半开区间。 */
export function isPeakHour(atMs: number, windows: PeakWindow[] | undefined): boolean {
  if (!Array.isArray(windows) || windows.length === 0) return false
  const hour = new Date(atMs).getUTCHours()
  return windows.some((w) => {
    const start = Number(w?.start)
    const end = Number(w?.end)
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false
    if (start < end) return hour >= start && hour < end
    return hour >= start || hour < end // 跨午夜窗口(换算后可能出现,兼容处理)
  })
}

/**
 * 选一个 metered provider 在 atMs 时刻生效的时代。
 * eras 按 since 升序;命中的条件是 since <= atMs < until(until 缺省为正无穷)。
 * 无覆盖(如早于所有时代)返回 undefined → 调用方按 unknown 处理。
 */
export function eraFor(providerEntry: ProviderEntry, atMs: number): Era | undefined {
  const eras = providerEntry.eras
  if (!Array.isArray(eras) || eras.length === 0) return undefined
  if (!Number.isFinite(atMs)) return undefined
  for (let i = eras.length - 1; i >= 0; i--) {
    const era = eras[i]
    const since = timeMs(era?.since)
    const until = era?.until === undefined ? Infinity : timeMs(era.until)
    if (Number.isFinite(since) && atMs >= since && atMs < until) return era
  }
  return undefined
}

/** 按事件时刻挑选价格档:该时代峰时段内且模型有 peak 细档 → peak;否则时代基价。 */
export function tierFor(entry: PriceEntry | undefined, atMs: number, era: Era | { peakWindows?: PeakWindow[] } = { peakWindows: [] }): PriceTier {
  const base = entry ?? { cacheHit: 0, cacheMiss: 0, output: 0 }
  if (isPeakHour(atMs, era.peakWindows)) {
    const p = base.peak
    return p === undefined ? base : p
  }
  return base
}

/**
 * 一次用量的美元成本;cache read 按命中价,cache write 按写入价(缺省 =
 * 命中价),reasoning 不再计。声明了 longContext 的模型在单次请求 prompt
 * (input+cacheRead+cacheWrite)≥ threshold 时整档换长上下文价。
 */
export function costOf(tokens: Partial<UsageBuckets>, entry: PriceEntry | undefined, atMs: number, era: Era | { peakWindows?: PeakWindow[] } = { peakWindows: [] }): number {
  const input = Math.max(0, Number(tokens?.input) || 0)
  const output = Math.max(0, Number(tokens?.output) || 0)
  const cacheRead = Math.max(0, Number(tokens?.cacheRead) || 0)
  const cacheWrite = Math.max(0, Number(tokens?.cacheWrite) || 0)
  const prompt = input + cacheRead + cacheWrite
  const long = entry?.longContext
  const tier = long !== undefined && prompt >= long.threshold ? long : tierFor(entry, atMs, era)
  const writePrice = tier.cacheWrite ?? tier.cacheHit
  return Math.max(0, (input * tier.cacheMiss + output * tier.output + cacheRead * tier.cacheHit + cacheWrite * writePrice) / 1_000_000)
}

/**
 * 解析一路由 (provider, model) 在某一时刻的计价方式。
 * metered 与带刊例价表的 subscription 都带 entry/tier,调用方据此计费
 * (subscription 的金额为参考估算,不是真实账单)。不做任何回退:算不出价
 * (未知 provider、未知模型、无时代覆盖)就是 unknown 或无估算,绝不套用
 * 别家价表或别时代价格。
 */
export function rateFor(provider: string | null, model: string | null, atMs: number, providers: Record<string, ProviderEntry> = PROVIDERS): RateResult {
  const p = provider === null ? undefined : providers?.[provider]
  if (p === undefined) return { kind: 'unknown' }
  if (p.kind === 'subscription') {
    const label = p.label ?? provider
    const era = eraFor(p, atMs)
    const entry = era !== undefined && typeof model === 'string' && model.length > 0 ? era.models?.[model] : undefined
    if (era === undefined || entry === undefined) return { kind: 'subscription', label }
    return { kind: 'subscription', label, era, entry, tier: tierFor(entry, atMs, era) }
  }
  if (p.kind !== 'metered') return { kind: 'unknown' }
  const era = eraFor(p, atMs)
  if (era === undefined) return { kind: 'unknown' }
  const entry = typeof model === 'string' && model.length > 0 ? era.models?.[model] : undefined
  if (entry === undefined) return { kind: 'unknown' }
  return { kind: 'metered', era, entry, tier: tierFor(entry, atMs, era) }
}

const sessionCostSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  reasoning: z.number(),
  cost: z.number(),
  pricing: z.enum(['none', 'metered', 'subscription', 'mixed', 'unknown']),
  partial: z.boolean(),
  currency: z.object({
    symbol: z.string(),
    decimals: z.number(),
    rate: z.number(),
  }),
  display: z.object({ cost: z.string() }).optional(),
})

/**
 * sessionCost 投影工厂:按事件时刻(event.time)用当时路由、当时时代的
 * 计价方式逐次计费;逐步样本表按 (turn, step) 去重,同 key 新样本(最终
 * message)替换旧样本(流式 chunk),先减后加,与事件交错顺序无关。
 * 订阅制路由按刊例价估算参考金额(无刊例价则计 0),未知路由计 0;
 * view 的 pricing 字段标注构成,partial 标注"有未知路由用量未计入",
 * 客户端据此渲染精确金额、≈ 估算或隐藏。currency 为宿主端按 loader 行
 * config 解析的显示币种(浏览器端没有 config 通道,随 view 下发);传入
 * CurrencyHolder 时 view 每次读取当前值,在线汇率刷新随之生效。
 */
export function makeSessionCostProjection(providers: Record<string, ProviderEntry> = PROVIDERS, currency: Currency | CurrencyHolder = resolveCurrency(undefined)): ProjectionUnit<ProjectionState, SessionCostView> {
  const holder: CurrencyHolder = 'current' in currency ? currency : { current: currency }
  const zeroBuckets = (): Totals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0 })
  const zeroKinds = (): Record<PricingKind, number> => ({ metered: 0, subscription: 0, unknown: 0 })
  const viewFn = (state: ProjectionState): SessionCostView => {
    const kinds = state.kinds ?? zeroKinds()
    const metered = (kinds.metered ?? 0) > 0
    const subscription = (kinds.subscription ?? 0) > 0
    const unknown = (kinds.unknown ?? 0) > 0
    // 已知路由的费用是真数,不因为有未知路由就整体隐藏;unknown 只在
    // 全无可计费样本时独占 pricing。partial 提示客户端加 ≈(下限而非全额)。
    const pricing = metered && subscription ? 'mixed' : metered ? 'metered' : subscription ? 'subscription' : unknown ? 'unknown' : 'none'
    const partial = unknown && (metered || subscription)
    // 自描述显示串:估算标记 ≈ 与币种格式化都在数据 owner 侧完成。
    const approximate = pricing === 'mixed' || pricing === 'subscription' || partial
    const showable = (pricing === 'metered' || pricing === 'mixed' || pricing === 'subscription') && state.totals.cost > 0
    const display = showable ? { cost: (approximate ? '≈' : '') + formatMoney(state.totals.cost, holder.current) } : undefined
    return { ...state.totals, pricing, partial, currency: holder.current, ...(display !== undefined ? { display } : {}) }
  }
  return {
    key: 'sessionCost',
    schema: sessionCostSchema,
    // 0.1.1 起浏览器只收带 wire 的投影视图;viewSchema 即 view 的形状校验。
    wire: { viewSchema: sessionCostSchema, view: viewFn },
    stateVersion: 5,
    init: () => ({ provider: null, model: null, totals: zeroBuckets(), kinds: zeroKinds(), samples: {} }),
    apply(state, event) {
      if (event.type === 'request/header') {
        const model = event.data?.header?.config?.model
        const provider = event.data?.header?.config?.provider
        const nextModel = typeof model === 'string' && model.length > 0 ? model : null
        const nextProvider = typeof provider === 'string' && provider.length > 0 ? provider : null
        return nextModel === state.model && nextProvider === state.provider ? state : { ...state, model: nextModel, provider: nextProvider }
      }
      let usage: RawUsage | null = null
      let turn = 0
      let step = 0
      if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'usage' && event.data.chunk.usage !== undefined) {
        usage = event.data.chunk.usage
        turn = event.data.turn ?? 0
        step = event.data.step ?? 0
      } else if (event.type === 'assistant/message' && event.data?.usage !== undefined) {
        usage = event.data.usage
        turn = event.data.turn ?? 0
        step = event.data.step ?? 0
      } else {
        return state
      }
      const buckets: UsageBuckets = {
        input: usage.inputTokens ?? 0,
        output: usage.outputTokens ?? 0,
        cacheRead: usage.cacheReadTokens ?? 0,
        cacheWrite: usage.cacheWriteTokens ?? 0,
        reasoning: usage.reasoningTokens ?? 0,
      }
      const key = `${turn}:${step}`
      const prev = state.samples[key] ?? null
      if (
        prev !== null &&
        prev.provider === state.provider &&
        prev.model === state.model &&
        prev.buckets.input === buckets.input &&
        prev.buckets.output === buckets.output &&
        prev.buckets.cacheRead === buckets.cacheRead &&
        prev.buckets.cacheWrite === buckets.cacheWrite &&
        prev.buckets.reasoning === buckets.reasoning
      ) {
        return state
      }
      const atMs = Number.isFinite(Number(event.time)) && Number(event.time) > 0 ? Number(event.time) : Date.now()
      const rate = rateFor(state.provider, state.model, atMs, providers)
      // metered 是真实账单;subscription 带刊例价时是参考估算;其余计 0。
      const billed = rate.entry !== undefined ? costOf(buckets, rate.entry, atMs, rate.era) : 0
      const totals = { ...state.totals }
      const kinds = { ...state.kinds }
      const shift = (bucket: UsageBuckets, cost: number, sign: 1 | -1, kind: PricingKind) => {
        totals.input += sign * bucket.input
        totals.output += sign * bucket.output
        totals.cacheRead += sign * bucket.cacheRead
        totals.cacheWrite += sign * bucket.cacheWrite
        totals.reasoning += sign * bucket.reasoning
        totals.cost += sign * cost
        kinds[kind] = Math.max(0, (kinds[kind] ?? 0) + sign)
      }
      if (prev !== null) shift(prev.buckets, prev.cost, -1, prev.kind)
      shift(buckets, billed, 1, rate.kind)
      const samples = { ...state.samples, [key]: { provider: state.provider, model: state.model, kind: rate.kind, buckets, cost: billed } }
      return { provider: state.provider, model: state.model, totals, kinds, samples }
    },
    view: viewFn,
  }
}

// ── 显示币种配置(settings namespace:session-cost) ─────────────────────

/**
 * 费用显示币种:随 view 下发(SessionCostView.currency),消费插件无需
 * config 通道。传输通道是 settings 命名空间 session-cost(见文件底部
 * apply):用户在设置 GUI 或 settings.yaml 里编辑,实时生效;loader 行
 * config 降级为 base 层(schema 默认 < config < 用户层)。
 */
export const SESSION_COST_NS = 'session-cost'

/** 命名空间解析后的完整文档;哨兵值(''/0/-1)表示"未设置"。 */
export interface SessionCostDoc {
  currency: string
  exchangeRate: number
  decimals: number
  symbol: string
}

/** settings schema:每个字段都有默认值,缺省文档即全哨兵。 */
export const sessionCostSettingsSchema = Schema.object({
  currency: Schema.string().default(''),
  exchangeRate: Schema.number().default(0),
  decimals: Schema.number().default(-1),
  symbol: Schema.string().default(''),
})

/** loader 行 config → base 层文档(哨兵填充)。 */
export function toBaseDoc(config?: PluginConfig): SessionCostDoc {
  return {
    currency: typeof config?.currency === 'string' ? config.currency : '',
    exchangeRate: typeof config?.exchangeRate === 'number' ? config.exchangeRate : 0,
    decimals: typeof config?.decimals === 'number' ? config.decimals : -1,
    symbol: typeof config?.symbol === 'string' ? config.symbol : '',
  }
}

// ── 汇率解析(显式覆盖 > 在线查询 > 内置表) ──────────────────────────────

/** view 每次读取的币种持有者;在线汇率刷新就改它的 current。 */
export interface CurrencyHolder {
  current: Currency
}

/**
 * 在线查询最新汇率并更新 holder(frankfurter.dev,ECB 参考汇率,免 key)。
 * 仅显示用途:汇率不进投影 state,重放确定性不受影响。失败(离线、超时、
 * 形状不符)返回 false,holder 保持原值(内置表/上次成功值)。USD 与
 * 非 ISO 4217 三字母码直接跳过。
 */
export async function refreshCurrencyRate(holder: CurrencyHolder, code: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  if (!/^[A-Z]{3}$/.test(code) || code === 'USD') return false
  try {
    const res = await fetchFn(`https://api.frankfurter.dev/v1/latest?base=USD&symbols=${code}`, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return false
    const data: unknown = await res.json()
    const rate = (data as { rates?: Record<string, unknown> } | null)?.rates?.[code]
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return false
    holder.current = { ...holder.current, rate }
    return true
  } catch {
    return false
  }
}

/** 文档 → resolveCurrency 入参(哨兵转 undefined)。 */
export function currencyConfigFromDoc(doc: SessionCostDoc): PluginConfig {
  return {
    currency: doc.currency !== '' ? doc.currency : undefined,
    exchangeRate: doc.exchangeRate > 0 ? doc.exchangeRate : undefined,
    decimals: doc.decimals >= 0 ? doc.decimals : undefined,
    symbol: doc.symbol || undefined,
  }
}

/**
 * 币种驱动器:把有效设置文档换算进 CurrencyHolder,并管在线汇率刷新。
 * 去重:币种相关字段(currency/exchangeRate/decimals/symbol)没变就不动
 * holder 也不发请求——改模板行这类无关设置不会扰动汇率。钉死汇率
 * (exchangeRate > 0)时不发请求。
 */
export interface CurrencyDriver {
  readonly holder: CurrencyHolder
  readonly pinned: boolean
  readonly code: string
  adopt: (doc: SessionCostDoc) => void
}

export function makeCurrencyDriver(fetchFn: typeof fetch = fetch, holder: CurrencyHolder = { current: resolveCurrency(undefined) }): CurrencyDriver {
  let lastKey: string | null = null
  let pinned = false
  let code = 'CNY'
  return {
    holder,
    get pinned() {
      return pinned
    },
    get code() {
      return code
    },
    adopt(doc: SessionCostDoc): void {
      const cfg = currencyConfigFromDoc(doc)
      // 显式列出参与去重的字段,不用 JSON.stringify 隐式依赖键序
      const key = [cfg.currency ?? '', cfg.exchangeRate ?? 0, cfg.decimals ?? -1, cfg.symbol ?? ''].join('|')
      if (key === lastKey) return
      lastKey = key
      holder.current = resolveCurrency(cfg)
      pinned = cfg.exchangeRate !== undefined
      code = currencyCode(cfg)
      if (!pinned) void refreshCurrencyRate(holder, code, fetchFn)
    },
  }
}

/**
 * 注册投影,并挂载 settings 命名空间 session-cost:显示币种的有效值
 * 来自"schema 默认 < loader config(base)< 用户层"的合成结果,scope.watch
 * 驱动汇率即时重解析(用户在设置 GUI 改币种即生效)。显式 exchangeRate
 * (任一层)钉死汇率,禁用在线查询;否则启动即刷 + 每日刷新。
 * 存量 settings.yaml 段落非法时 register 抛错——捕获后回退 base 层,
 * 不影响投影与其余功能。无 sessionProjections / settings 的装配
 * (如 headless)回退到纯 loader config 行为。
 */
export function apply(ctx: CordisContext, config?: PluginConfig): void {
  const driver = makeCurrencyDriver()
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    const registry = projectionCtx.sessionProjections
    if (registry === undefined) return
    registry.register(makeSessionCostProjection(PROVIDERS, driver.holder))
  })
  const base = toBaseDoc(config)
  driver.adopt(base)
  ctx.inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx.settings
    if (settings === undefined) return
    let scope: { get: () => unknown; watch: (callback: () => void) => () => void }
    try {
      scope = settings.register(settingsNamespace(SESSION_COST_NS), sessionCostSettingsSchema, { base })
    } catch {
      return // 存量段落非法:回退 base,GUI 卡片因命名空间未 serve 而自动隐藏
    }
    driver.adopt(scope.get() as SessionCostDoc)
    const unwatch = scope.watch(() => driver.adopt(scope.get() as SessionCostDoc))
    settingsCtx.effect?.(() => unwatch, 'dsh-session-cost: settings watch')
  })
  // 每日刷新(仅未钉死时);holder 里已是内置表兜底值。
  ctx.effect?.(() => {
    const timer = setInterval(() => {
      if (!driver.pinned) void refreshCurrencyRate(driver.holder, driver.code)
    }, 86_400_000)
    return () => clearInterval(timer)
  }, 'dsh-session-cost: fx refresh')
}
