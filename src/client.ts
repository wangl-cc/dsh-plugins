/**
 * dsh-stats-compact 浏览器端:紧凑 stats line 组件。
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
  formatDuration,
  formatMoney,
  formatTokens,
  formatTokensPerSecond,
  resolveCurrency,
  type ChatNode,
  type Currency,
  type DerivedStats,
  type PluginConfig,
  type TokenUsage,
} from './format'

const h = React.createElement

const NS = 'stats-compact'

// ── 样式(跟随 --dsw-* 主题变量) ──────────────────────────────────────

const css = [
  '/* dsh-stats-compact: 紧凑 stats line */',
  '.csl-root{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:2px 0;box-sizing:border-box;width:100%;max-width:var(--dsh-chat-content-width,748px);margin:0 auto;padding:4px calc(var(--dsh-composer-side-clearance,16px) + 16px) 0;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}',
  '.csl-item{display:inline-flex;align-items:baseline;white-space:nowrap;font-variant-numeric:tabular-nums}',
  '.csl-sep{color:var(--dsw-alias-separator-primary);margin:0 6px}',
].join('\n')
if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="dsh-stats-compact"]') === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-stats-compact'
  tag.dataset.pluginCss = 'dsh-stats-compact'
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
}
const en = {
  counts: '{turns} turns · {steps} steps',
  llm: 'LLM {d}',
  tools: 'Tools {d}',
  ttft: 'TTFT {d}',
  tps: '{tps} tok/s',
  tokens: '↑{in}{suffix} ↓{out}',
  cacheSuffix: '({p}%)',
  estimated: '≈',
}

// ── slot cell 契约(slot renderer 注入的最小 props 面) ──────────────────

interface SessionCostView {
  cost?: number
  pricing?: 'none' | 'metered' | 'subscription' | 'mixed' | 'unknown'
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

/** 客户端插件上下文的最小面(locale/slots 服务 + effect)。 */
interface ClientContext {
  get: (name: 'locale' | 'slots') => unknown
  effect: (fn: () => unknown, label?: string) => void
}

interface LocaleService {
  register: (ns: string, dictionaries: { zh: typeof zh; en: typeof en }) => unknown
}

interface SlotsService {
  inject: (slot: string, callback: () => unknown) => void
  register: (options: { name: string; id: string; order: number; priority: number; locale: string }, component: React.ComponentType<CellProps>) => unknown
}

// ── 组件 ───────────────────────────────────────────────────────────────

let CURRENCY: Currency = resolveCurrency(undefined)

function CompactStatsLine(props: CellProps): React.ReactElement | null {
  const useSession = props.useSession
  const useProjection = props.useProjection
  const t = props.t
  const settledNodes = useSession !== undefined ? useSession((s) => s.chat.legacy.nodes) : undefined
  const usage = useProjection !== undefined ? useProjection('tokenUsage') : undefined
  const projected = useProjection !== undefined ? useProjection('sessionStats') : undefined
  const costUsage = useProjection !== undefined ? useProjection('costUsage') : undefined // dsh-cost-meter(多 provider 计费,优先)
  const sessionCost = useProjection !== undefined ? useProjection('sessionCost') : undefined // 本插件自带投影
  const stats: DerivedStats | undefined = projected ?? (settledNodes !== undefined ? deriveStats(settledNodes) : undefined)
  const groups: string[] = []
  if (stats !== undefined && stats.steps > 0) {
    groups.push(t('counts', { turns: stats.turns, steps: stats.steps }))
    const durations: string[] = []
    if (stats.llmMs > 0) durations.push(t('llm', { d: formatDuration(stats.llmMs) }))
    if (stats.toolMs > 0) durations.push(t('tools', { d: formatDuration(stats.toolMs) }))
    if (durations.length > 0) groups.push(durations.join(' · '))
    const speeds: string[] = []
    if (stats.ttftSteps > 0) speeds.push(t('ttft', { d: formatDuration(stats.ttftMs / stats.ttftSteps) }))
    if (stats.decodeMs > 0) speeds.push(t('tps', { tps: formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1e3)) }))
    if (speeds.length > 0) groups.push(speeds.join(' · '))
  }
  if (usage !== undefined && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)) {
    // 缓存命中率是输入侧属性:挂在 ↑ 后面(如 ↑8.4M(97%) ↓68.8K)。
    const cache = cacheHitPercent(usage)
    const suffix = cache !== null ? t('cacheSuffix', { p: cache }) : ''
    groups.push(t('tokens', { in: formatTokens(billedInputTokens(usage)), suffix, out: formatTokens(usage.outputTokens) }))
  }
  // 费用:装了 dsh-cost-meter 优先(多 provider 计费);否则看本插件投影的
  // pricing 标记——metered 精确显示;subscription 有刊例价时显示 ≈ 估算
  // (无则不显示);mixed 加 ≈;unknown/none 不显示(绝不展示按别家价表
  // 套出来的数字)。≈ 是唯一的非精确标记,不再叠加订阅标签。
  const costUsageCost = typeof costUsage?.cost === 'number' && costUsage.cost > 0 ? costUsage.cost : null
  if (costUsageCost !== null) {
    groups.push(formatMoney(costUsageCost, CURRENCY))
  } else if (sessionCost !== undefined) {
    const pricing = sessionCost.pricing
    const cost = typeof sessionCost.cost === 'number' ? sessionCost.cost : 0
    if (pricing === 'metered' && cost > 0) {
      groups.push(formatMoney(cost, CURRENCY))
    } else if ((pricing === 'mixed' || pricing === 'subscription') && cost > 0) {
      groups.push(t('estimated') + formatMoney(cost, CURRENCY))
    }
  }
  if (groups.length === 0) return null
  const children: React.ReactElement[] = []
  groups.forEach((group, i) => {
    if (i > 0) children.push(h('span', { className: 'csl-sep', 'aria-hidden': true, key: 'sep' + i }, '|'))
    children.push(h('span', { className: 'csl-item', key: 'g' + i }, group))
  })
  return h('div', { className: 'csl-root' }, children)
}

// ── 插件入口 ───────────────────────────────────────────────────────────

export function apply(ctx: ClientContext, config?: PluginConfig): void {
  CURRENCY = resolveCurrency(config)
  const locale = ctx.get('locale') as LocaleService | undefined
  if (locale !== undefined) {
    ctx.effect(() => locale.register(NS, { zh, en }), 'dsh-stats-compact: dictionaries')
  }
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
}
