/**
 * dsh-stats-line 浏览器端:紧凑 stats line 组件。
 *
 * 构建时被 rolldown 包装成 __ModuleLoader__ 工厂格式(见 rolldown.config.js
 * 的 banner/footer),react 与 ./format 之外无依赖;运行时由 dsh-client-modules
 * 以 classic script 加载。
 *
 * 替换官方 stats line(conversation.composer.dock 的 id:"stats" 条目):
 * 以 priority:-1 注册同 id 条目完成 cell shadowing(最低 priority 渲染;
 * 本组件崩溃时 abdicate,官方条目自动接管作为回退)。
 *
 * 数据源与官方 StatsLine 完全一致:
 *  - sessionStats / tokenUsage 投影(优先);
 *  - 窗口内节点折叠(投影缺失时的回退,共享自 ./format)。
 *
 * 差异:文案更紧凑(轮/步、工具、TTFT、↑↓),布局 flex-wrap 可换行,
 * 不再单行截断丢内容;行尾追加本会话费用(宿主 sessionCost 投影,
 * 装了 dsh-cost-meter 时自动优先用其 costUsage 投影)。费用按投影的
 * pricing 标记渲染:metered 精确金额;mixed / 有刊例价的 subscription
 * 加 ≈(唯一标记,不再叠加订阅标签);unknown/none/无刊例价订阅隐藏。
 */

import * as React from 'react'
import {
  assistantStepReading,
  billedInputTokens,
  cacheHitPercent,
  deriveStats,
  lastStepReading,
  type LastStepReading,
  formatDuration,
  formatMoney,
  formatTokens,
  formatTokensPerSecond,
  renderStatsLineItems,
  resolveCurrency,
  DEFAULT_STATS_LINE_ITEMS,
  makeItem,
  normalizeItem,
  ITEM_KINDS,
  type ChatNode,
  type Currency,
  type DerivedStats,
  type PluginConfig,
  type StatsLineItem,
  type TokenUsage,
} from './format'

const h = React.createElement

const NS = 'stats-compact'

/** settings 命名空间:按用户面对的功能域命名,不用包名。 */
const STATS_LINE_NS = 'stats-line'

// ── 样式(跟随 --dsw-* 主题变量) ──────────────────────────────────────

const css = [
  '/* dsh-stats-line: 紧凑 stats line */',
  '.csl-root{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:2px 0;box-sizing:border-box;width:100%;max-width:var(--dsh-chat-content-width,748px);margin:0 auto;padding:4px calc(var(--dsh-composer-side-clearance,16px) + 16px) 0;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}',
  '.csl-item{display:inline-flex;align-items:baseline;white-space:nowrap;font-variant-numeric:tabular-nums}',
  '.csl-sep{color:var(--dsw-alias-separator-primary);margin:0 6px}',
  '.csl-sepsm{color:var(--dsw-alias-separator-primary);margin:0 4px}',
  '/* 设置卡片(settings.plugin.item):复刻平台 PluginCard/ValueField 视觉契约 */',
  '.slc-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}',
  '.slc-card:hover{border-color:var(--dsw-alias-label-dimmed)}',
  '.slc-card.slc-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}',
  '.slc-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}',
  '.slc-headtext{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}',
  '.slc-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}',
  '.slc-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}',
  '.slc-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}',
  '.slc-open .slc-chevron{transform:rotate(180deg)}',
  '.slc-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}',
  '.slc-field{flex-direction:column;gap:6px;padding:12px 0;display:flex}',
  '.slc-field+.slc-field{border-top:1px solid var(--dsw-alias-border-l2)}',
  '.slc-label{min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5}',
  '.slc-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}',
  '.slc-row{display:flex;gap:8px;align-items:center}',
  /* flex:1 只用于 .slc-row 横向布局;纵向 .slc-field 里 flex-basis:0 会把 height 顶塌 */
  '.slc-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5;box-sizing:border-box}',
  '.slc-row .slc-input{flex:1;min-width:0}',
  '.slc-field .slc-input{width:100%}',
  '.slc-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}',
  '.slc-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}',
  '.slc-btn{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5;flex:none}',
  '.slc-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary)}',
  '.slc-btn:disabled{cursor:default;opacity:.4}',
  '.slc-add{align-self:flex-start;appearance:none;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}',
  '.slc-add:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}',
  '.slc-add:disabled{opacity:.4;cursor:default}',
  '.slc-pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}',
  '.slc-footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}',
  '.slc-discard,.slc-save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}',
  '.slc-discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}',
  '.slc-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}',
  '.slc-save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}',
  '.slc-discard:disabled,.slc-save:disabled{opacity:.4;cursor:default}',
  '.slc-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
  '.slc-grip{color:var(--dsw-alias-label-tertiary);cursor:grab;user-select:none;flex:none;padding:0 2px;font-size:13px;line-height:1}',
  '.slc-row.slc-dragging{opacity:.45}',
  '.slc-chip{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:5px 10px;font-size:12px;line-height:1.5;flex:none}',
  '.slc-chip:disabled{cursor:default;opacity:.6}',
  '.slc-itemname{color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;flex:1;min-width:0;padding:5px 0}',
  '.slc-preview{border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;padding:8px 12px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;word-break:break-all}',
  '.slc-advanced{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 12px}',
  '.slc-advancedsummary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:500;padding:10px 0;user-select:none}',
  '.slc-advanced[open] .slc-advancedsummary{border-bottom:1px solid var(--dsw-alias-border-l2)}',
].join('\n')
if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="dsh-stats-line"]') === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-stats-line'
  tag.dataset.pluginCss = 'dsh-stats-line'
  tag.textContent = css
  document.head.appendChild(tag)
}

// ── 紧凑文案字典(zh/en) ───────────────────────────────────────────────

const zh = {
  counts: '{turns} 轮 · {steps} 步',
  llm: 'LLM {d}',
  tools: '工具 {d}',
  ttft: 'TTFT {d}',
  tps: '{tps} tok/s',
  tokens: '↑{in}{suffix} ↓{out}',
  cacheSuffix: '({p}%)',
  estimated: '≈',
  cardItems: '组件序列',
  cardItemsHint: '按住 ⠿ 拖拽排序;点 ·/| 切换分隔符大小;费用组件的币种设置在 session-cost 卡片里。自定义组件用 {placeholder} 插值:{turns} {steps} {llm} {tools} {ttft} {tps} {input} {output} {cache} {cost} {ttftLast} {tpsLast};引用缺失数据的组件不渲染;清空恢复默认。',
  cardAdd: '添加:',
  compCounts: '计数',
  compLlm: 'LLM 时长',
  compTools: '工具时长',
  compTtft: 'TTFT(平均)',
  compTps: '吐字速度(平均)',
  compTtftLast: 'TTFT(最近一轮)',
  compTpsLast: '吐字速度(最近一轮)',
  compTokens: 'Token 用量',
  compCost: '费用',
  compSepSmall: '小分隔符',
  compSepBig: '大分隔符',
  compCustom: '自定义',
  cardCustomPlaceholder: '{turns} 轮 · {steps} 步 …',
  cardDragHandle: '按住拖拽排序',
  cardSepToggle: '点击切换大小',
  cardRemove: '删除',
  cardCss: '附加 CSS',
  cardTitle: 'Stats line',
  cardDescription: '紧凑统计行的组件编排。',
  cardUnsaved: '未保存',
  cardDiscard: '放弃',
  cardSave: '保存',
  cardPreview: '预览(示例数据)',
  cardAdvanced: '高级',
  cardStartFromDefaults: '从默认组件开始',
}
const en = {
  counts: '{turns} turns · {steps} steps',
  llm: 'LLM {d}',
  tools: 'Tools {d}',
  ttft: 'TTFT {d}',
  tps: '{tps} tok/s',
  tokens: '↑{in} {suffix} ↓{out}',
  cacheSuffix: '({p}%)',
  estimated: '≈',
  cardItems: 'Components',
  cardItemsHint: 'Hold ⠿ to drag and reorder; click ·/| to toggle separator size; currency settings for the cost component live in the session-cost card. Custom components interpolate {placeholders}: {turns} {steps} {llm} {tools} {ttft} {tps} {input} {output} {cache} {cost} {ttftLast} {tpsLast}; components referencing unavailable data are not rendered; clear all to restore defaults.',
  cardAdd: 'Add:',
  compCounts: 'Counts',
  compLlm: 'LLM time',
  compTools: 'Tool time',
  compTtft: 'TTFT (avg)',
  compTps: 'Speed (avg)',
  compTtftLast: 'TTFT (last)',
  compTpsLast: 'Speed (last)',
  compTokens: 'Tokens',
  compCost: 'Cost',
  compSepSmall: 'Small sep',
  compSepBig: 'Big sep',
  compCustom: 'Custom',
  cardCustomPlaceholder: '{turns} turns · {steps} steps …',
  cardDragHandle: 'Drag to reorder',
  cardSepToggle: 'Click to toggle size',
  cardRemove: 'Remove',
  cardCss: 'Extra CSS',
  cardTitle: 'Stats line',
  cardDescription: 'Component composition of the compact stats line.',
  cardUnsaved: 'Unsaved',
  cardDiscard: 'Discard',
  cardSave: 'Save',
  cardPreview: 'Preview (sample data)',
  cardAdvanced: 'Advanced',
  cardStartFromDefaults: 'Start from defaults',
}

// ── slot cell 契约(slot renderer 注入的最小 props 面) ──────────────────

interface SessionCostView {
  cost?: number
  pricing?: 'none' | 'metered' | 'subscription' | 'mixed' | 'unknown'
  /** 有未知路由用量未计入 cost(金额是已知部分的下限)→ 加 ≈。 */
  partial?: boolean
  /** 宿主端按 loader 行 config 解析的显示币种(浏览器端没有 config 通道)。 */
  currency?: Currency
}

interface CellProps {
  useSession?: <T>(selector: (state: { chat: { legacy: { nodes: ChatNode[] } } }) => T) => T
  useProjection?: {
    (key: 'tokenUsage'): TokenUsage | undefined
    (key: 'sessionStats'): DerivedStats | undefined
    (key: 'costUsage'): { cost?: number } | undefined
    (key: 'sessionCost'): SessionCostView | undefined
  }
  t: (key: keyof typeof zh, params?: Record<string, string | number>) => string
}

/** 声明式 UI 配置(从 settings 命名空间 stats-line 的解析文档提取)。 */
interface UiConfig {
  items?: StatsLineItem[]
  css?: string
}

// ── settings 命名空间客户端(stats-line) ────────────────────────────────

/** settingsScope.bind 返回的命名空间控制器(dsh-client-ui-settings)。 */
interface SettingsSnapshot {
  value?: unknown
  writable?: boolean
}

interface SettingsScopeController {
  getSnapshot: () => SettingsSnapshot
  subscribe: (listener: () => void) => () => void
  set: (field: string, value: unknown) => Promise<unknown>
  unset: (field: string) => Promise<unknown>
}

interface SettingsScopeService {
  bind: (spec: { namespace: string }) => SettingsScopeController
}

let settingsController: SettingsScopeController | undefined

/** useSyncExternalStore 适配器:整个 snapshot(value + writable)。 */
const settingsStore = {
  subscribe: (listener: () => void) => settingsController?.subscribe(listener) ?? (() => {}),
  getSnapshot: () => settingsController?.getSnapshot(),
}

/** 防御性提取 UI 配置:空序列/空串转 undefined(= 内置默认);item 逐个归一化,非法的丢弃。 */
function uiFromDoc(doc: unknown): UiConfig {
  if (typeof doc !== 'object' || doc === null) return {}
  const d = doc as { items?: unknown; css?: unknown }
  const ui: UiConfig = {}
  if (Array.isArray(d.items)) {
    const items = d.items.map(normalizeItem).filter((item): item is StatsLineItem => item !== undefined)
    if (items.length > 0) ui.items = items
  }
  if (typeof d.css === 'string' && d.css !== '') ui.css = d.css
  return ui
}

/** 客户端插件上下文的最小面(locale/slots/settingsScope 服务 + effect)。 */
interface ClientContext {
  get: (name: string) => unknown
  effect: (fn: () => unknown, label?: string) => void
}

interface LocaleService {
  register: (ns: string, dictionaries: { zh: typeof zh; en: typeof en }) => unknown
}

interface SlotsService {
  inject: (slot: string, callback: () => unknown) => void
  register: (options: { name: string; id?: string; key?: string; order?: number; priority?: number; locale: string }, component: React.ComponentType<CellProps>) => unknown
}

// ── 组件 ───────────────────────────────────────────────────────────────

let CURRENCY: Currency = resolveCurrency(undefined)

/** 防御性校验投影下发的币种;形状不对就用本地缺省。 */
function validCurrency(value: Currency | undefined): Currency | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  if (typeof value.symbol !== 'string' || value.symbol.length === 0) return undefined
  if (typeof value.rate !== 'number' || !Number.isFinite(value.rate) || value.rate <= 0) return undefined
  if (typeof value.decimals !== 'number' || !Number.isFinite(value.decimals)) return undefined
  return value
}

/** 组件文本(parts)+ 自定义模板占位符词表(values);cell 渲染与设置卡片预览共用同一份逻辑。 */
function buildValues(
  stats: DerivedStats | undefined,
  usage: TokenUsage | undefined,
  sessionCost: SessionCostView | undefined,
  costUsage: { cost?: number } | undefined,
  currency: Currency,
  t: CellProps['t'],
  last: LastStepReading | undefined,
): { parts: Record<string, string | undefined>; values: Record<string, string | undefined> } {
  // 数据不可得时该组件键不存在(渲染时整项丢弃);仅 {cache} 在 tokens 可得
  // 但无缓存数据时为空串(括号烘在值里)。
  const parts: Record<string, string | undefined> = {}
  const values: Record<string, string | undefined> = {}
  if (stats !== undefined && stats.steps > 0) {
    parts.counts = t('counts', { turns: stats.turns, steps: stats.steps })
    values.turns = String(stats.turns)
    values.steps = String(stats.steps)
    if (stats.llmMs > 0) {
      parts.llm = t('llm', { d: formatDuration(stats.llmMs) })
      values.llm = formatDuration(stats.llmMs)
    }
    if (stats.toolMs > 0) {
      parts.tools = t('tools', { d: formatDuration(stats.toolMs) })
      values.tools = formatDuration(stats.toolMs)
    }
    if (stats.ttftSteps > 0) {
      parts.ttft = t('ttft', { d: formatDuration(stats.ttftMs / stats.ttftSteps) })
      values.ttft = formatDuration(stats.ttftMs / stats.ttftSteps)
    }
    if (stats.decodeMs > 0) {
      parts.tps = t('tps', { tps: formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1e3)) })
      values.tps = formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1e3))
    }
  }
  // 最近一轮(瞬时):始终从窗口节点读取——sessionStats 投影不含逐步数据。
  if (last !== undefined) {
    if (last.ttftMs !== null) {
      parts.ttftLast = t('ttft', { d: formatDuration(last.ttftMs) })
      values.ttftLast = formatDuration(last.ttftMs)
    }
    if (last.decodeMs !== null && last.decodeMs > 0 && last.outputTokens !== null) {
      parts.tpsLast = t('tps', { tps: formatTokensPerSecond(last.outputTokens / (last.decodeMs / 1e3)) })
      values.tpsLast = formatTokensPerSecond(last.outputTokens / (last.decodeMs / 1e3))
    }
  }
  if (usage !== undefined && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)) {
    // 缓存命中率是输入侧属性:挂在 ↑ 后面(如 ↑8.4M(97%) ↓68.8K)。
    const cache = cacheHitPercent(usage)
    const suffix = cache !== null ? t('cacheSuffix', { p: cache }) : ''
    parts.tokens = t('tokens', { in: formatTokens(billedInputTokens(usage)), suffix, out: formatTokens(usage.outputTokens) })
    values.input = formatTokens(billedInputTokens(usage))
    values.output = formatTokens(usage.outputTokens)
    values.cache = suffix
  }
  // 费用:装了 dsh-cost-meter 优先(多 provider 计费);否则看本插件投影的
  // pricing 标记——metered 精确显示;subscription 有刊例价时显示 ≈ 估算
  // (无则不显示);mixed 加 ≈;partial(有未知路由用量未计入)也加 ≈,因为
  // 金额只是已知部分的下限;unknown/none 不显示(绝不展示按别家价表套出来
  // 的数字)。≈ 是唯一的非精确标记,不再叠加订阅标签。
  const costUsageCost = typeof costUsage?.cost === 'number' && costUsage.cost > 0 ? costUsage.cost : null
  if (costUsageCost !== null) {
    parts.cost = formatMoney(costUsageCost, currency)
  } else if (sessionCost !== undefined) {
    const pricing = sessionCost.pricing
    const cost = typeof sessionCost.cost === 'number' ? sessionCost.cost : 0
    const approximate = pricing === 'mixed' || pricing === 'subscription' || sessionCost.partial === true
    if ((pricing === 'metered' || pricing === 'mixed' || pricing === 'subscription') && cost > 0) {
      parts.cost = (approximate ? t('estimated') : '') + formatMoney(cost, currency)
    }
  }
  values.cost = parts.cost
  return { parts, values }
}

function CompactStatsLine(props: CellProps): React.ReactElement | null {
  const useSession = props.useSession
  const useProjection = props.useProjection
  const t = props.t
  const settledNodes = useSession !== undefined ? useSession((s) => s.chat.legacy.nodes) : undefined
  const usage = useProjection !== undefined ? useProjection('tokenUsage') : undefined
  const projected = useProjection !== undefined ? useProjection('sessionStats') : undefined
  const costUsage = useProjection !== undefined ? useProjection('costUsage') : undefined // dsh-cost-meter(多 provider 计费,优先)
  const sessionCost = useProjection !== undefined ? useProjection('sessionCost') : undefined // 本插件自带投影
  // 声明式 UI 配置:settings 命名空间 stats-line(设置 GUI / settings.yaml
  // 编辑,实时生效);loader config 是 base 层,由宿主端合成后持久化。
  const ui = uiFromDoc(React.useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot)?.value)
  const stats: DerivedStats | undefined = projected ?? (settledNodes !== undefined ? deriveStats(settledNodes) : undefined)
  // 币种跟随投影 view(宿主端 settings 解析 + 在线汇率),本地缺省兜底。
  const currency = validCurrency(sessionCost?.currency) ?? CURRENCY
  const last = settledNodes !== undefined ? lastStepReading(settledNodes) : undefined
  const { parts, values } = buildValues(stats, usage, sessionCost, costUsage, currency, t, last)
  const pieces = renderStatsLineItems(ui.items ?? DEFAULT_STATS_LINE_ITEMS, parts, values)
  const css = ui.css ?? null
  if (pieces.length === 0 && css === null) return null
  const children: React.ReactElement[] = pieces.map((piece, i) =>
    piece.type === 'sep'
      ? h('span', { className: piece.size === 'big' ? 'csl-sep' : 'csl-sepsm', 'aria-hidden': true, key: 'p' + i }, piece.size === 'big' ? '|' : '·')
      : h('span', { className: 'csl-item', key: 'p' + i }, piece.text),
  )
  // 声明式 css 逃生舱:随配置响应式更新,随组件卸载消失。
  if (css !== null) children.push(h('style', { key: 'uicss' }, css))
  return h('div', { className: 'csl-root' }, children)
}

// ── 设置卡片(settings.plugin.item,key = stats-line) ────────────────────
// 外壳(可折叠 li + 标题/描述/箭头)与字段样式复刻平台 PluginCard/ValueField
// 的视觉契约(那些 CSS module 与组件是包内私产,不可跨包 import)。

/** 读命名空间文档的某个字段(防御性,缺省给哨兵)。 */
function docField<T>(doc: unknown, key: string, fallback: T): T {
  if (typeof doc !== 'object' || doc === null) return fallback
  const value = (doc as Record<string, unknown>)[key]
  return value === undefined ? fallback : (value as T)
}

/** 预览用示例数据(固定值,与真实格式化同路径)。 */
const SAMPLE_STATS: DerivedStats = { turns: 5, steps: 23, llmMs: 162_000, toolMs: 45_000, ttftMs: 1_200, ttftSteps: 1, decodeTokens: 2_025, decodeMs: 45_000 }
const SAMPLE_USAGE: TokenUsage = { uncachedInputTokens: 252_000, cacheReadTokens: 8_148_000, cacheWriteTokens: 0, outputTokens: 68_800 }
const SAMPLE_COST: SessionCostView = { cost: 0.0082 / 7.2, pricing: 'subscription' }
const SAMPLE_LAST: LastStepReading = { ttftMs: 980, decodeMs: 38_000, outputTokens: 1_862 }

/** 草稿里的组件项与文档同形(组件已无带校验的数值属性)。 */
type DraftItem = StatsLineItem

/** 卡片草稿:组件序列 + css;Save 时才过滤落盘。 */
interface CardDraft {
  items: DraftItem[]
  css: string
}

const toDraftItem = (item: StatsLineItem): DraftItem => item

/** 草稿项 → 文档项(空模板自定义组件丢弃)。 */
function fromDraftItem(item: DraftItem): StatsLineItem {
  return { kind: item.kind, size: item.size, template: item.template.trim() }
}

/** 命名空间文档 → 草稿。 */
function draftFromDoc(doc: unknown): CardDraft {
  const items = docField<unknown[]>(doc, 'items', [])
    .map(normalizeItem)
    .filter((item): item is StatsLineItem => item !== undefined)
    .map(toDraftItem)
  return { items, css: docField(doc, 'css', '') }
}

/** 组件 kind → 文案键。 */
function itemLabelKey(item: { kind: StatsLineItem['kind']; size: StatsLineItem['size'] }): keyof typeof zh {
  switch (item.kind) {
    case 'counts':
      return 'compCounts'
    case 'llm':
      return 'compLlm'
    case 'tools':
      return 'compTools'
    case 'ttft':
      return 'compTtft'
    case 'tps':
      return 'compTps'
    case 'ttftLast':
      return 'compTtftLast'
    case 'tpsLast':
      return 'compTpsLast'
    case 'tokens':
      return 'compTokens'
    case 'cost':
      return 'compCost'
    case 'sep':
      return item.size === 'big' ? 'compSepBig' : 'compSepSmall'
    default:
      return 'compCustom'
  }
}

/** 调色板:可添加的内置组件;分隔符与自定义单独给。 */
const PALETTE_KINDS = ['counts', 'llm', 'tools', 'ttft', 'tps', 'ttftLast', 'tpsLast', 'tokens', 'cost'] as const

/**
 * 设置 GUI 卡片:可拖拽的组件编排器。组件序列 = 内置数据组件 + 大小分隔符
 * + 自定义模板组件;币种设置在 session-cost 插件的卡片里。编辑模型
 * 与第一方卡片一致:全部进本地草稿(dirty 显示未保存徽标),Save 一次性
 * 落盘,Discard 放弃。拖拽:按住手柄(⠿)拖动,dragover 实时换位。
 * 非 loopback 浏览器 writable=false:只读展示。
 */
function StatsLineCard(props: CellProps): React.ReactElement | null {
  const t = props.t
  const snap = React.useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot)
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<CardDraft | null>(null)
  const [dragFrom, setDragFrom] = React.useState<number | null>(null)
  const [gripActive, setGripActive] = React.useState<number | null>(null)
  if (settingsController === undefined) return null
  const controller = settingsController
  const writable = snap?.writable !== false
  const stored = draftFromDoc(snap?.value)
  const value = draft ?? stored
  const dirty = draft !== null
  const edit = (patch: Partial<CardDraft>) => setDraft({ ...value, ...patch })
  const editItem = (i: number, patch: Partial<DraftItem>) => edit({ items: value.items.map((item, j) => (j === i ? { ...item, ...patch } : item)) })
  const moveItem = (from: number, to: number) => {
    const next = value.items.slice()
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    edit({ items: next })
  }
  const save = (): void => {
    const items = value.items.map(fromDraftItem).filter((item) => item.kind !== 'custom' || item.template !== '')
    if (JSON.stringify(items) !== JSON.stringify(stored.items.map(fromDraftItem))) {
      if (items.length === 0) void controller.unset('items')
      else void controller.set('items', items)
    }
    if (value.css !== stored.css) {
      if (value.css === '') void controller.unset('css')
      else void controller.set('css', value.css)
    }
    setDraft(null)
  }
  // 预览:示例数据走与 cell 完全相同的渲染路径(组件可得性/分隔符收敛都真实)。
  const sample = buildValues(SAMPLE_STATS, SAMPLE_USAGE, SAMPLE_COST, undefined, CURRENCY, t, SAMPLE_LAST)
  const previewItems: StatsLineItem[] = (value.items.length > 0 ? value.items : DEFAULT_STATS_LINE_ITEMS.map(toDraftItem)).map(fromDraftItem)
  const previewText = renderStatsLineItems(previewItems, sample.parts, sample.values)
    .map((piece) => (piece.type === 'sep' ? (piece.size === 'big' ? '|' : '·') : piece.text))
    .join(' ')
  const body = open
    ? h('div', { className: 'slc-body', key: 'body' }, [
        h('div', { className: 'slc-field', key: 'preview' }, [
          h('label', { className: 'slc-label', key: 'l' }, t('cardPreview')),
          h('div', { className: 'slc-preview', key: 'box' }, previewText),
        ]),
        h('div', { className: 'slc-field', key: 'items' }, [
          h('label', { className: 'slc-label', key: 'l' }, t('cardItems')),
          h('p', { className: 'slc-hint', key: 'hint' }, t('cardItemsHint')),
          ...value.items.map((item, i) =>
            h(
              'div',
              {
                className: dragFrom === i ? 'slc-row slc-dragging' : 'slc-row',
                key: 'r' + i,
                draggable: gripActive === i,
                onDragStart: (e: React.DragEvent<HTMLDivElement>) => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', String(i))
                  setDragFrom(i)
                },
                onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (dragFrom !== null && dragFrom !== i) {
                    moveItem(dragFrom, i)
                    setDragFrom(i)
                  }
                },
                onDragEnd: () => {
                  setDragFrom(null)
                  setGripActive(null)
                },
              },
              [
                h(
                  'span',
                  {
                    className: 'slc-grip',
                    key: 'grip',
                    title: t('cardDragHandle'),
                    'aria-hidden': true,
                    onMouseDown: () => setGripActive(i),
                    onMouseUp: () => setGripActive(null),
                  },
                  '⠿',
                ),
                item.kind === 'sep'
                  ? h('button', { className: 'slc-chip', key: 'c', type: 'button', disabled: !writable, title: t('cardSepToggle'), onClick: () => editItem(i, { size: item.size === 'small' ? 'big' : 'small' }) }, (item.size === 'small' ? '·' : '|') + ' ' + t(itemLabelKey(item)))
                  : item.kind === 'custom'
                    ? h('input', {
                        className: 'slc-input',
                        key: 'c',
                        type: 'text',
                        value: item.template,
                        placeholder: t('cardCustomPlaceholder'),
                        disabled: !writable,
                        onChange: (e: React.ChangeEvent<HTMLInputElement>) => editItem(i, { template: e.target.value }),
                      })
                    : h('span', { className: 'slc-itemname', key: 'c' }, t(itemLabelKey(item))),
                h('button', { className: 'slc-btn', key: 'rm', type: 'button', disabled: !writable, onClick: () => edit({ items: value.items.filter((_, j) => j !== i) }) }, t('cardRemove')),
              ],
            ),
          ),
          h('div', { className: 'slc-actions', key: 'palette' }, [
            h('span', { className: 'slc-hint', key: 'pl' }, t('cardAdd')),
            ...PALETTE_KINDS.map((kind) =>
              h('button', { className: 'slc-add', key: kind, type: 'button', disabled: !writable, onClick: () => edit({ items: [...value.items, toDraftItem(makeItem(kind))] }) }, t(itemLabelKey(makeItem(kind)))),
            ),
            h('button', { className: 'slc-add', key: 'seps', type: 'button', disabled: !writable, onClick: () => edit({ items: [...value.items, toDraftItem(makeItem('sep'))] }) }, '·'),
            h('button', { className: 'slc-add', key: 'sepb', type: 'button', disabled: !writable, onClick: () => edit({ items: [...value.items, toDraftItem(makeItem('sep', { size: 'big' }))] }) }, '|'),
            h('button', { className: 'slc-add', key: 'custom', type: 'button', disabled: !writable, onClick: () => edit({ items: [...value.items, toDraftItem(makeItem('custom'))] }) }, t('compCustom')),
            value.items.length === 0
              ? h('button', { className: 'slc-add', key: 'defaults', type: 'button', disabled: !writable, onClick: () => edit({ items: DEFAULT_STATS_LINE_ITEMS.map(toDraftItem) }) }, t('cardStartFromDefaults'))
              : null,
          ]),
        ]),
        h('details', { className: 'slc-advanced', key: 'adv' }, [
          h('summary', { className: 'slc-advancedsummary', key: 's' }, t('cardAdvanced')),
          h('div', { className: 'slc-field', key: 'css' }, [
            h('label', { className: 'slc-label', key: 'l' }, t('cardCss')),
            h('input', {
              className: 'slc-input',
              key: 'in',
              type: 'text',
              value: value.css,
              disabled: !writable,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => edit({ css: e.target.value }),
            }),
          ]),
        ]),
        h('div', { className: 'slc-footer', key: 'foot' }, [
          h('button', { className: 'slc-discard', key: 'd', type: 'button', disabled: !dirty, onClick: () => setDraft(null) }, t('cardDiscard')),
          h('button', { className: 'slc-save', key: 's', type: 'button', disabled: !dirty || !writable, onClick: save }, t('cardSave')),
        ]),
      ])
    : null
  return h('li', { className: open ? 'slc-card slc-open' : 'slc-card' }, [
    h(
      'button',
      { className: 'slc-header', key: 'head', type: 'button', 'aria-expanded': open, onClick: () => setOpen(!open) },
      [
        h('span', { className: 'slc-headtext', key: 'txt' }, [
          h('span', { className: 'slc-name', key: 'n' }, t('cardTitle')),
          h('span', { className: 'slc-desc', key: 'd' }, t('cardDescription')),
        ]),
        dirty ? h('span', { className: 'slc-pending', key: 'pd' }, t('cardUnsaved')) : null,
        h(
          'svg',
          { className: 'slc-chevron', key: 'ch', width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': true },
          h('path', { d: 'M3.5 5.25 7 8.75l3.5-3.5', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        ),
      ],
    ),
    body,
  ])
}

// ── 插件入口 ───────────────────────────────────────────────────────────

export function apply(ctx: ClientContext, config?: PluginConfig): void {
  CURRENCY = resolveCurrency(config)
  const locale = ctx.get('locale') as LocaleService | undefined
  if (locale !== undefined) {
    ctx.effect(() => locale.register(NS, { zh, en }), 'dsh-stats-line: dictionaries')
  }
  const settingsScope = ctx.get('settingsScope') as SettingsScopeService | undefined
  if (settingsScope !== undefined) settingsController = settingsScope.bind({ namespace: STATS_LINE_NS })
  const slots = ctx.get('slots') as SlotsService | undefined
  if (slots === undefined) return
  slots.inject('conversation.composer.dock', () =>
    slots.register(
      {
        name: 'conversation.composer.dock',
        id: 'stats',
        order: 0,
        priority: -1,
        locale: NS,
      },
      CompactStatsLine,
    ),
  )
  slots.inject('settings.plugin.item', () =>
    slots.register(
      {
        name: 'settings.plugin.item',
        key: STATS_LINE_NS,
        locale: NS,
      },
      StatsLineCard,
    ),
  )
}
