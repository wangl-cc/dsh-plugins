/**
 * 共享纯函数:stats 折叠、token/时长格式化、模板组件模型。
 *
 * 被 client bundle(经 rolldown 内联)与 Node 测试(dist/format.js)共用,
 * 杜绝"client 逻辑不可测"的受控重复。零依赖、零副作用、不触碰 DOM/React。
 *
 * 模型:行 = 小组(section)数组;小组 = { sep?, components },小组间固定
 * '|',小组内组件间默认 '·'(sep 可覆盖);组件 = 模板字符串(或
 * { show, hint? }),串内 $name 插值、$$ 转义字面 $。消失规则逐级:
 * ref 无值 → 串不可解析;show 不可解析 → 组件消失;小组全空 → 整组消失;
 * 连接符渲染时按层级生成,无收敛 pass。货币格式化在 dsh-session-cost
 * (费用数据的 owner),本包不认识币种。
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

// ── 模板组件模型 ─────────────────────────────────────────────────────

/** 组件:模板串,或带 tooltip 的对象形态。模板内 $name 引用值,$$ 转义字面 $。 */
export type StatsLineComponent = string | { show: string; hint?: string }

/** 小组:组件数组 + 内部连接符覆盖(sep 缺省 '·';'' = 贴死);小组间固定 '|'。 */
export interface StatsLineSection {
  sep?: string
  components: StatsLineComponent[]
}

/** 模板的 token 化视图(chip 编辑器的编辑模型;存储模型是模板串)。 */
export type StatsLineToken = { type: 'text'; text: string } | { type: 'ref'; name: string }

/**
 * 模板串 → token 序列。$name 为 ref;$$ 为字面 $;孤立 $(后面不跟
 * 字母)按字面文本处理。serializeTokens 是它的逆(规范化后幂等)。
 */
export function parseTemplateTokens(template: string): StatsLineToken[] {
  const tokens: StatsLineToken[] = []
  let text = ''
  let i = 0
  const flush = (): void => {
    if (text !== '') {
      tokens.push({ type: 'text', text })
      text = ''
    }
  }
  while (i < template.length) {
    if (template[i] === '$') {
      const match = /^\$([A-Za-z][A-Za-z0-9]*)/.exec(template.slice(i))
      if (match !== null) {
        flush()
        tokens.push({ type: 'ref', name: match[1] ?? '' })
        i += match[0].length
        continue
      }
      if (template[i + 1] === '$') {
        text += '$'
        i += 2
        continue
      }
      // 孤立 $:字面文本
      text += '$'
      i += 1
      continue
    }
    text += template[i]
    i += 1
  }
  flush()
  return tokens
}

/** token 序列 → 模板串;文本中的 $ 一律转义为 $$,ref 输出 $name。 */
export function serializeTokens(tokens: StatsLineToken[]): string {
  return tokens.map((token) => (token.type === 'ref' ? `$${token.name}` : token.text.replace(/\$/g, () => '$$'))).join('')
}

/**
 * 解析模板:任一 ref 在 values 中缺失(undefined)→ 整个串不可解析,
 * 返回 undefined(这就是声明式的条件显隐);否则返回替换后的文本。
 */
export function resolveTemplate(template: string, values: Record<string, string | undefined>): string | undefined {
  const tokens = parseTemplateTokens(template)
  for (const token of tokens) {
    if (token.type === 'ref' && values[token.name] === undefined) return undefined
  }
  return tokens.map((token) => (token.type === 'ref' ? (values[token.name] ?? '') : token.text)).join('')
}

/** 渲染输出:文本段(可带 hint → span 的 title)或幽灵分隔符段。 */
export type StatsLinePiece = { type: 'text'; text: string; hint?: string } | { type: 'sep'; text: string; section: boolean }

/**
 * sections + 值词表 → 渲染片段。连接符按层级生成:组件前插入其小组的
 * sep('' 则不生成,贴死),小组第一个渲染组件前插入 '|';行首无连接符。
 * 不可解析的组件与全空小组直接消失,没有收敛 pass。
 */
export function renderStatsLine(sections: StatsLineSection[], values: Record<string, string | undefined>): StatsLinePiece[] {
  const pieces: StatsLinePiece[] = []
  let lineStarted = false
  for (const section of sections) {
    const sep = section.sep ?? '·'
    let sectionStarted = false
    for (const component of section.components) {
      const show = typeof component === 'string' ? component : component.show
      const hint = typeof component === 'string' ? undefined : component.hint
      const text = resolveTemplate(show, values)
      if (text === undefined) continue
      const hintText = hint === undefined ? undefined : resolveTemplate(hint, values)
      if (lineStarted) {
        const junction = sectionStarted ? sep : '|'
        if (junction !== '') pieces.push({ type: 'sep', text: junction, section: !sectionStarted })
      }
      pieces.push({ type: 'text', text, ...(hintText !== undefined ? { hint: hintText } : {}) })
      lineStarted = true
      sectionStarted = true
    }
  }
  return pieces
}

/** 防御性归一化任意 JSON 为 sections;非法条目丢弃,空小组丢弃。 */
export function normalizeSections(raw: unknown): StatsLineSection[] {
  if (!Array.isArray(raw)) return []
  const out: StatsLineSection[] = []
  for (const s of raw) {
    if (typeof s !== 'object' || s === null) continue
    const rec = s as Record<string, unknown>
    const comps = Array.isArray(rec.components) ? rec.components : []
    const components: StatsLineComponent[] = []
    for (const c of comps) {
      if (typeof c === 'string') {
        if (c !== '') components.push(c)
        continue
      }
      if (typeof c === 'object' && c !== null) {
        const r = c as Record<string, unknown>
        if (typeof r.show === 'string' && r.show !== '') {
          components.push(typeof r.hint === 'string' && r.hint !== '' ? { show: r.show, hint: r.hint } : { show: r.show })
        }
      }
    }
    if (components.length === 0) continue
    out.push(typeof rec.sep === 'string' ? { sep: rec.sep, components } : { components })
  }
  return out
}

// ── 旧 items 文档迁移(兜底;当前用户配置为干净状态) ────────────────────

const LEGACY_TEMPLATES: Record<string, string[]> = {
  counts: ['$turns', '$steps'],
  llm: ['LLM $llm'],
  tools: ['工具 $tools'],
  ttft: ['TTFT $ttft'],
  tps: ['$tps'],
  ttftLast: ['TTFT $ttftLast'],
  tpsLast: ['$tpsLast'],
  cost: ['$cost'],
}

/**
 * 旧 items 序列(kind/sep/custom,'{name}' 占位)→ 新 sections。
 * big sep = 小组边界;small sep 丢弃(小组内自动生成 '·');tokens 复合
 * 组件展开为独立贴死小组(sep:'');custom 模板的 '{name}' 转 '$name'。
 */
export function migrateLegacyItems(raw: unknown): StatsLineSection[] {
  if (!Array.isArray(raw)) return []
  const sections: StatsLineSection[] = []
  let current: StatsLineComponent[] = []
  const flush = (): void => {
    if (current.length > 0) {
      sections.push({ components: current })
      current = []
    }
  }
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const r = item as Record<string, unknown>
    if (r.kind === 'sep') {
      if (r.size === 'big') flush()
      continue
    }
    if (r.kind === 'tokens') {
      flush()
      sections.push({ sep: '', components: ['↑$input', '($cache)', ' ↓$output'] })
      continue
    }
    if (r.kind === 'custom') {
      if (typeof r.template === 'string' && r.template.trim() !== '') {
        current.push(r.template.replace(/\{(\w+)\}/g, '$$$1'))
      }
      continue
    }
    const templates = typeof r.kind === 'string' ? LEGACY_TEMPLATES[r.kind] : undefined
    if (templates !== undefined) current.push(...templates)
  }
  flush()
  return sections
}
