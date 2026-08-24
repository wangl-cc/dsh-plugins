/**
 * 共享纯函数:stats 折叠、token/时长/货币格式化、币种解析。
 *
 * 被 client bundle(经 rolldown 内联)与 Node 测试(dist/format.js)共用,
 * 杜绝"client 逻辑不可测"的受控重复。零依赖、零副作用、不触碰 DOM/React。
 */

/** tokenUsage 投影 view 的形状(dsh-token-meter)。 */
export interface TokenUsage {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** 会话窗口内一个折叠节点(官方 chat.legacy.nodes 的最小面)。 */
export interface ChatNode {
  kind: string
  turn?: number
  step?: number
  time: number
  callTime?: number | null
  timing?: {
    stepStartTime: number | null
    firstTokenTime: number | null
    completedTime: number
  }
  usage?: { outputTokens?: number } | null
}

/** deriveStats 的输出,字段名与 sessionStats 投影一致(两者可整体互换)。 */
export interface DerivedStats {
  turns: number
  steps: number
  llmMs: number
  toolMs: number
  ttftMs: number
  ttftSteps: number
  decodeMs: number
  decodeTokens: number
}

export function usageOutputTokens(usage: { outputTokens?: number } | null | undefined): number | null {
  if (typeof usage !== 'object' || usage === null) return null
  const value = usage.outputTokens
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export function assistantStepReading(node: ChatNode): { ttftMs: number | null; decodeMs: number | null; outputTokens: number | null } {
  const timing = node.timing
  return {
    ttftMs: timing !== undefined && timing.stepStartTime !== null && timing.firstTokenTime !== null ? Math.max(0, timing.firstTokenTime - timing.stepStartTime) : null,
    decodeMs: timing !== undefined && timing.firstTokenTime !== null ? Math.max(0, timing.completedTime - timing.firstTokenTime) : null,
    outputTokens: usageOutputTokens(node.usage),
  }
}

/** 窗口内折叠:投影缺失时的回退,字段名与 sessionStats 投影一致。 */
export function deriveStats(nodes: ChatNode[]): DerivedStats {
  const turns = new Set<number>()
  let steps = 0
  let llmMs = 0
  let toolMs = 0
  let ttftMs = 0
  let ttftSteps = 0
  let decodeMs = 0
  let decodeTokens = 0
  for (const node of nodes) {
    if (node.kind === 'tool-result') {
      if (node.callTime !== null && node.callTime !== undefined) toolMs += Math.max(0, node.time - node.callTime)
      continue
    }
    if (node.kind !== 'assistant') continue
    turns.add(node.turn ?? 0)
    steps += 1
    if (node.timing !== undefined && node.timing.stepStartTime !== null) {
      llmMs += Math.max(0, node.timing.completedTime - node.timing.stepStartTime)
    }
    const reading = assistantStepReading(node)
    if (reading.ttftMs !== null) {
      ttftMs += reading.ttftMs
      ttftSteps += 1
    }
    if (reading.decodeMs !== null && reading.outputTokens !== null) {
      decodeMs += reading.decodeMs
      decodeTokens += reading.outputTokens
    }
  }
  return { turns: turns.size, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }
}

/**
 * 最近一轮读数:与官方 thread 末端的 deriveTurnMetrics 完全同构——取最后
 * 一个 assistant node 所在的 turn,该轮全部 step 的 decode 加总成加权速率
 * (tps = Σ outputTokens / Σ decodeMs),TTFT 取该轮首步;流式中未完成的
 * step(completedTime 未定)自然不计入。sessionStats 投影不提供逐步数据,
 * 所以"最近一轮"组件始终从窗口节点读取,与走投影的平均值互不依赖;
 * 字段按指标各自可空(ttft 需要首步 stepStart+firstToken,tps 需要该轮
 * 至少一个完整 step 的 decodeMs + outputTokens)。
 */
export interface LastStepReading {
  ttftMs: number | null
  decodeMs: number | null
  outputTokens: number | null
}

export function lastStepReading(nodes: ChatNode[]): LastStepReading | undefined {
  let lastTurn: number | undefined
  let firstStep = Number.POSITIVE_INFINITY
  let ttftMs: number | null = null
  let decodeMs = 0
  let outputTokens = 0
  let sampled = false
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]
    if (node === undefined || node.kind !== 'assistant') continue
    const turn = node.turn ?? 0
    if (lastTurn === undefined) lastTurn = turn
    if (turn !== lastTurn) break
    const reading = assistantStepReading(node)
    const step = node.step ?? 0
    if (step < firstStep) {
      firstStep = step
      ttftMs = reading.ttftMs
    }
    if (reading.decodeMs !== null && reading.outputTokens !== null) {
      decodeMs += reading.decodeMs
      outputTokens += reading.outputTokens
      sampled = true
    }
  }
  if (lastTurn === undefined) return undefined
  return { ttftMs, decodeMs: sampled ? decodeMs : null, outputTokens: sampled ? outputTokens : null }
}

/** 紧凑 token 计数:517 / 12.2K / 517K / 1.2M。 */
export function formatTokens(n: number): string {
  const scaled = (v: number) => (v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10))
  if (n < 1e3) return String(n)
  if (n < 1e6) return `${scaled(n / 1e3)}K`
  return `${scaled(n / 1e6)}M`
}

/** 紧凑时长:45.2s(<1 分钟)/ 2m42s;秒档舍入到 60 时升入分钟档。 */
export function formatDuration(ms: number): string {
  const s = ms / 1e3
  const tenth = Math.round(s * 10) / 10
  if (tenth < 60) return `${tenth}s`
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

export function formatTokensPerSecond(tps: number): string {
  const clamped = Math.max(0, tps)
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10)
}

/** prompt 侧三个计费桶之和。 */
export function billedInputTokens(usage: TokenUsage): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

/** 缓存命中占比(取整);无输入计费时返回 null。 */
export function cacheHitPercent(usage: TokenUsage): number | null {
  const denominator = billedInputTokens(usage)
  return denominator === 0 ? null : Math.round((usage.cacheReadTokens / denominator) * 100)
}

// ── 会话费用显示(美元成本 → 显示币种) ─────────────────────────────────

export interface Currency {
  symbol: string
  decimals: number
  rate: number
}

/** 内置汇率表:在线查询失败时的兜底(2026-08 参考值,会随时间漂移)。 */
export const CURRENCY_PRESETS: Record<string, Currency> = {
  CNY: { symbol: '¥', decimals: 4, rate: 7.2 },
  USD: { symbol: '$', decimals: 6, rate: 1 },
  EUR: { symbol: '€', decimals: 6, rate: 0.92 },
}

/**
 * loader 行 config 的形状(仅宿主侧可得;浏览器端启动图不携带 config)。
 * currency 为 ISO 4217 币种码;exchangeRate 是显式覆盖(钉死/离线用),
 * 缺省时宿主端在线查询,内置表兜底。
 */
export interface PluginConfig {
  currency?: string
  exchangeRate?: number
  decimals?: number
  symbol?: string
}

/** 币种码归一:缺省 CNY,大写 ISO 4217;非三字母码原样返回(查 preset 用)。 */
export function currencyCode(config: PluginConfig | undefined): string {
  const raw = typeof config?.currency === 'string' && config.currency.length > 0 ? config.currency : 'CNY'
  return /^[a-zA-Z]{3}$/.test(raw) ? raw.toUpperCase() : raw
}

/** 解析币种设置(缺省 CNY;rate 为内置表或显式覆盖,在线刷新由宿主端负责)。 */
export function resolveCurrency(config: PluginConfig | undefined): Currency {
  const kind = currencyCode(config)
  const preset = CURRENCY_PRESETS[kind] ?? { symbol: '$', decimals: 2, rate: 1 }
  const rate = Number(config?.exchangeRate)
  const decimals = Number(config?.decimals)
  return {
    symbol: typeof config?.symbol === 'string' && config.symbol.length > 0 ? config.symbol : preset.symbol,
    rate: Number.isFinite(rate) && rate > 0 ? rate : preset.rate,
    decimals: Math.max(0, Math.min(10, Math.floor(Number.isFinite(decimals) ? decimals : preset.decimals))),
  }
}

/** 美元成本 × 汇率,按币种格式化;数值过小时自动放宽小数位。 */
export function formatMoney(usdCost: number, currency: Currency): string {
  const value = usdCost * (currency.rate > 0 ? currency.rate : 1)
  let effective = currency.decimals
  if (value > 0 && value < Math.pow(10, -effective)) effective = effective + 2
  const fixed = value.toFixed(effective)
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
  return currency.symbol + trimmed
}

/** 模板插值:'{a} x {b}' + {a:1,b:2} → '1 x 2';未知占位符原样保留。 */
export function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match))
}

/**
 * 渲染声明式模板(stats line 自定义组件):'{name}' 占位符取自
 * values(值是预格式化的显示串);引用了缺失值(undefined)的模板返回
 * undefined——这就是声明式的条件显隐;值为空串的占位符(如 {cache})照常渲染。
 */
export function renderTemplate(template: string, values: Record<string, string | undefined>): string | undefined {
  const refs = template.match(/\{(\w+)\}/g) ?? []
  if (refs.some((ref) => values[ref.slice(1, -1)] === undefined)) return undefined
  return interpolate(template, values as Record<string, string>)
}

// ── stats line 组件模型(设置 GUI 的可拖拽单元) ─────────────────────────

/** 组件种类:内置数据组件 + 分隔符 + 自定义模板。 */
export type StatsLineItemKind = 'counts' | 'llm' | 'tools' | 'ttft' | 'tps' | 'ttftLast' | 'tpsLast' | 'tokens' | 'cost' | 'sep' | 'custom'
export type StatsLineSepSize = 'small' | 'big'

/**
 * 组件序列的一项。settings 文档里的完整形态(哨兵:'' = 未设置);
 * 仅 sep 用 size,custom 用 template。cost 组件无属性——币种显示配置
 * 在 session-cost 插件自己的命名空间里(费用数据的 owner)。
 */
export interface StatsLineItem {
  kind: StatsLineItemKind
  size: StatsLineSepSize
  template: string
}

export const ITEM_KINDS: readonly StatsLineItemKind[] = ['counts', 'llm', 'tools', 'ttft', 'tps', 'ttftLast', 'tpsLast', 'tokens', 'cost', 'sep', 'custom']

export function makeItem(kind: StatsLineItemKind, init?: Partial<StatsLineItem>): StatsLineItem {
  return { kind, size: 'small', template: '', ...init }
}

/** 内置默认序列:大组间 '|',组内子项 '·'——与历史内置渲染视觉一致。 */
export const DEFAULT_STATS_LINE_ITEMS: StatsLineItem[] = [
  makeItem('counts'),
  makeItem('sep', { size: 'big' }),
  makeItem('llm'),
  makeItem('sep'),
  makeItem('tools'),
  makeItem('sep', { size: 'big' }),
  makeItem('ttft'),
  makeItem('sep'),
  makeItem('tps'),
  makeItem('sep', { size: 'big' }),
  makeItem('tokens'),
  makeItem('sep', { size: 'big' }),
  makeItem('cost'),
]

/** 防御性归一化任意 JSON 为组件项;非法输入返回 undefined(调用方过滤)。 */
export function normalizeItem(raw: unknown): StatsLineItem | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.kind !== 'string' || !ITEM_KINDS.includes(r.kind as StatsLineItemKind)) return undefined
  return {
    kind: r.kind as StatsLineItemKind,
    size: r.size === 'big' ? 'big' : 'small',
    template: typeof r.template === 'string' ? r.template : '',
  }
}

/** 渲染结果:文本段或分隔符(客户端分别包成 span)。 */
export type StatsLinePiece = { type: 'text'; text: string } | { type: 'sep'; size: StatsLineSepSize }

/**
 * 组件序列 → 渲染片段。数据不可得的组件(parts 无此键)与引用缺失值的
 * 自定义模板直接消失;分隔符随后收敛:边缘分隔符删除,相邻分隔符留大的。
 */
export function renderStatsLineItems(
  items: StatsLineItem[],
  parts: Record<string, string | undefined>,
  values: Record<string, string | undefined>,
): StatsLinePiece[] {
  const pieces: StatsLinePiece[] = []
  for (const item of items) {
    if (item.kind === 'sep') {
      pieces.push({ type: 'sep', size: item.size })
      continue
    }
    const text = item.kind === 'custom' ? (item.template.trim() === '' ? undefined : renderTemplate(item.template, values)) : parts[item.kind]
    if (text !== undefined) pieces.push({ type: 'text', text })
  }
  // 收敛:边缘删除 + 相邻留大(small < big)
  const out: StatsLinePiece[] = []
  for (const piece of pieces) {
    const last = out[out.length - 1]
    if (piece.type === 'sep') {
      if (last === undefined) continue // 前缘
      if (last.type === 'sep') {
        if (piece.size === 'big') out[out.length - 1] = piece // 留大的
        continue
      }
    }
    out.push(piece)
  }
  while (out.length > 0 && out[out.length - 1].type === 'sep') out.pop() // 后缘
  return out
}
