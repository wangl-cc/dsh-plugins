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

/** 紧凑 token 计数:517 / 12.2K / 517K / 1.2M。 */
export function formatTokens(n: number): string {
  const scaled = (v: number) => (v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10))
  if (n < 1e3) return String(n)
  if (n < 1e6) return `${scaled(n / 1e3)}K`
  return `${scaled(n / 1e6)}M`
}

/** 紧凑时长:45.2s(<1 分钟)/ 2m42s。 */
export function formatDuration(ms: number): string {
  const s = ms / 1e3
  if (s < 60) return `${Math.round(s * 10) / 10}s`
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

export const CURRENCY_PRESETS: Record<string, Currency> = {
  CNY: { symbol: '¥', decimals: 4, rate: 7.2 },
  USD: { symbol: '$', decimals: 6, rate: 1 },
  EUR: { symbol: '€', decimals: 6, rate: 0.92 },
}

/** loader 行 config 的形状(仅宿主侧可得;浏览器端启动图不携带 config)。 */
export interface PluginConfig {
  currency?: string
  exchangeRate?: number
  decimals?: number
  symbol?: string
}

/** 解析币种设置(缺省 CNY)。 */
export function resolveCurrency(config: PluginConfig | undefined): Currency {
  const kind = typeof config?.currency === 'string' && config.currency.length > 0 ? config.currency : 'CNY'
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
