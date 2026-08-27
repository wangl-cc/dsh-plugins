/**
 * dsh-stats-line 浏览器端:紧凑 stats line 组件 + 设置 GUI(chip 编排器)。
 *
 * 构建时被 rolldown 包装成 __ModuleLoader__ 工厂格式(见 rolldown.config.js
 * 的 banner/footer),react 与 ./format 之外无依赖;运行时由 dsh-client-modules
 * 以 classic script 加载。
 *
 * 替换官方官方 stats line(conversation.composer.dock 的 id:"stats" 条目):
 * 以 priority:-1 注册同 id 条目完成 cell shadowing(最低 priority 渲染;
 * 本组件崩溃时 abdicate,官方条目自动接管作为回退)。
 *
 * 模型(详见 ./format 头注):行 = 小组数组;组件 = 模板串('$name' 插值,
 * '$$' 转义);值是纯数据(单位/≈/¥ 由生产侧携带);连接符渲染时按层级
 * 生成。费用值 $cost 透传 sessionCost 投影的 display 字段(数据 owner
 * dsh-session-cost 负责格式化与 ≈ 标记);平台值(turns/steps/llm/tools/
 * ttft/tps/input/cache/output)在本侧格式化,单位词随 locale 字典。
 */

import * as React from 'react'
import {
  billedInputTokens,
  cacheHitPercent,
  deriveStats,
  lastStepReading,
  formatDuration,
  formatTokens,
  formatTokensPerSecond,
  normalizeSections,
  parseTemplateTokens,
  renderStatsLine,
  serializeTokens,
  type ChatNode,
  type DerivedStats,
  type LastStepReading,
  type StatsLineComponent,
  type StatsLinePiece,
  type StatsLineSection,
  type StatsLineToken,
  type TokenUsage,
} from './format'

const h = React.createElement

const NS = 'stats-line'

/** settings 命名空间:按用户面对的功能域命名,不用包名。 */
const STATS_LINE_NS = 'stats-line'

// ── 样式(dsl- 前缀 = dsh-stats-line,稳定公开锚点;跟随 --dsw-* 主题变量) ──

const css = [
  '.dsl-root{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:2px 0;box-sizing:border-box;width:100%;max-width:var(--dsh-chat-content-width,748px);margin:0 auto;padding:4px calc(var(--dsh-composer-side-clearance,16px) + 16px) 0;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}',
  '.dsl-item{display:inline-flex;align-items:baseline;white-space:nowrap;font-variant-numeric:tabular-nums}',
  '.dsl-sep{color:var(--dsw-alias-separator-primary);margin:0 var(--dsl-gap,4px)}',
  '.dsl-sepbig{color:var(--dsw-alias-separator-primary);margin:0 var(--dsl-section-gap,6px)}',
  // 设置卡片(外壳复刻平台 PluginCard/ValueField 的视觉契约)
  '.dsl-card{appearance:none;width:100%;margin:0;border:0;background:0;padding:0;font:inherit;color:inherit;text-align:left;cursor:pointer;list-style:none;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}',
  '.dsl-card:hover{background:var(--dsw-alias-bg-hover)}',
  '.dsl-card::-webkit-details-marker{display:none}',
  '.dsl-headtext{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}',
  '.dsl-title{font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary)}',
  '.dsl-desc{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary)}',
  '.dsl-arrow{flex:none;width:16px;height:16px;color:var(--dsw-alias-label-tertiary);transition:transform .15s ease}',
  'details[open] > .dsl-card .dsl-arrow{transform:rotate(90deg)}',
  '.dsl-body{flex-direction:column;gap:12px;padding:0 16px 14px;display:flex}',
  '.dsl-preview{flex-wrap:wrap;align-items:center;gap:2px 0;padding:8px 10px;border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary);display:flex}',
  '.dsl-strip{flex-direction:column;gap:8px;display:flex}',
  '.dsl-section{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px;display:flex;flex-wrap:wrap;align-items:center;gap:4px}',
  '.dsl-sectionhead{display:flex;align-items:center;gap:4px;margin-right:4px}',
  '.dsl-sepsel{appearance:none;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-primary);color:var(--dsw-alias-label-secondary);font-size:11px;padding:1px 4px;cursor:pointer}',
  '.dsl-sectionx{border:0;background:0;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:11px;padding:0 2px}',
  '.dsl-chip{display:inline-flex;align-items:center;gap:1px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:1px 3px;background:var(--dsw-alias-bg-primary);font-size:12px;line-height:18px}',
  '.dsl-chip.dsl-dragging{opacity:.45}',
  '.dsl-tok{display:inline-flex;align-items:center;white-space:nowrap;padding:0 3px;border-radius:4px}',
  '.dsl-tok-ref{background:var(--dsw-alias-bg-secondary);color:var(--dsw-alias-label-primary)}',
  '.dsl-tok-text{color:var(--dsw-alias-label-secondary);cursor:text}',
  '.dsl-tok-text:hover{background:var(--dsw-alias-bg-hover)}',
  '.dsl-tokx{border:0;background:0;padding:0 0 0 2px;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:10px;line-height:1}',
  '.dsl-tokedit{width:7em;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);background:0;font:inherit;color:inherit;font-size:12px;padding:0 2px;outline:0}',
  '.dsl-chipx{border:0;background:0;padding:0 1px;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:11px}',
  '.dsl-grip{cursor:grab;color:var(--dsw-alias-label-tertiary);padding:0 2px;user-select:none}',
  '.dsl-ghost{color:var(--dsw-alias-separator-primary);opacity:.6;padding:0 2px;font-size:11px;user-select:none}',
  '.dsl-palette{display:flex;flex-wrap:wrap;gap:4px;align-items:center}',
  '.dsl-palgroup{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-right:2px}',
  '.dsl-palbtn{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-primary);color:var(--dsw-alias-label-secondary);font-size:11px;padding:1px 6px;cursor:pointer}',
  '.dsl-palbtn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1)}',
  '.dsl-field{flex-direction:column;gap:6px;padding:4px 0;display:flex}',
  '.dsl-label{font-size:12px;color:var(--dsw-alias-label-secondary)}',
  '.dsl-input{appearance:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-primary);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:6px 8px;outline:0}',
  '.dsl-input:focus{border-color:var(--dsw-alias-border-l1)}',
  '.dsl-stylerow{display:flex;gap:8px;flex-wrap:wrap}',
  '.dsl-stylerow .dsl-field{flex:1;min-width:110px;padding:0}',
  '.dsl-footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}',
  '.dsl-save{border:0;border-radius:8px;background:var(--dsw-alias-btn-primary-bg);color:var(--dsw-alias-btn-primary-fg);font-size:12px;padding:6px 14px;cursor:pointer}',
  '.dsl-save:disabled{opacity:.45;cursor:default}',
  '.dsl-discard{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:0;color:var(--dsw-alias-label-secondary);font-size:12px;padding:6px 14px;cursor:pointer}',
  '.dsl-discard:disabled{opacity:.45;cursor:default}',
  '.dsl-rohint{font-size:11px;color:var(--dsw-alias-label-tertiary)}',
].join('\n')

if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="dsh-stats-line"]') === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-stats-line'
  tag.dataset.pluginCss = 'dsh-stats-line'
  tag.textContent = css
  document.head.appendChild(tag)
}

// ── 文案字典(zh/en) ─────────────────────────────────────────────────

const zh = {
  unitTurns: ' 轮',
  unitSteps: ' 步',
  toolsLabel: '工具 ',
  avgPrefix: '平均 ',
  cardTitle: 'Stats line',
  cardDesc: '自定义输入框上方 stats line 的内容与样式。组件是模板字符串:$name 引用值($$ 写字面 $);值不可得时组件自动消失。',
  preview: '预览',
  paletteSession: '会话:',
  paletteTokens: 'Token:',
  paletteCost: '费用:',
  addText: '+文本',
  addSection: '+新小组',
  deleteSection: '删除小组',
  sepDot: '· 默认',
  sepSpace: '空格',
  sepNone: '无(贴死)',
  styleLabel: '样式',
  styleFontSize: '字号(如 12px)',
  styleColor: '颜色(如 #8a8a8a)',
  styleFontFamily: '字体',
  styleGap: '组件间距',
  styleSectionGap: '小组间距',
  readonly: '此配置由部署管理,只读。',
  cardSave: '保存',
  cardDiscard: '放弃',
}

const en: typeof zh = {
  unitTurns: ' turns',
  unitSteps: ' steps',
  toolsLabel: 'Tools ',
  avgPrefix: 'avg ',
  cardTitle: 'Stats line',
  cardDesc: 'Customize the stats line above the composer. A component is a template string: $name references a value ($$ for a literal $); a component whose values are unavailable disappears.',
  preview: 'Preview',
  paletteSession: 'Session:',
  paletteTokens: 'Tokens:',
  paletteCost: 'Cost:',
  addText: '+Text',
  addSection: '+Section',
  deleteSection: 'Delete section',
  sepDot: '· default',
  sepSpace: 'space',
  sepNone: 'none (tight)',
  styleLabel: 'Style',
  styleFontSize: 'Font size (e.g. 12px)',
  styleColor: 'Color (e.g. #8a8a8a)',
  styleFontFamily: 'Font family',
  styleGap: 'Component gap',
  styleSectionGap: 'Section gap',
  readonly: 'Managed by deployment; read-only.',
  cardSave: 'Save',
  cardDiscard: 'Discard',
}

// ── settings plumbing ────────────────────────────────────────────────

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

// ── 文档解析 ─────────────────────────────────────────────────────────

interface StyleDoc {
  fontSize?: string
  color?: string
  fontFamily?: string
  gap?: string
  sectionGap?: string
}

/** 防御性提取 sections:空数组 → undefined(= 内置默认)。 */
function sectionsFromDoc(doc: unknown): StatsLineSection[] | undefined {
  if (typeof doc !== 'object' || doc === null) return undefined
  const sections = normalizeSections((doc as Record<string, unknown>).sections)
  return sections.length > 0 ? sections : undefined
}

/** 防御性提取 style:空串哨兵转 undefined。 */
function styleFromDoc(doc: unknown): StyleDoc {
  if (typeof doc !== 'object' || doc === null) return {}
  const s = (doc as Record<string, unknown>).style
  if (typeof s !== 'object' || s === null) return {}
  const r = s as Record<string, unknown>
  const pick = (key: keyof StyleDoc): string | undefined => (typeof r[key] === 'string' && (r[key] as string) !== '' ? (r[key] as string) : undefined)
  return { fontSize: pick('fontSize'), color: pick('color'), fontFamily: pick('fontFamily'), gap: pick('gap'), sectionGap: pick('sectionGap') }
}

// ── 值词表与默认序列 ──────────────────────────────────────────────────

/** sessionCost 投影 view 的消费面:只要数据 owner 格式化好的显示串。 */
interface SessionCostView {
  display?: { cost?: unknown }
}

/** 值 = 纯数据:单位由生产侧携带(轮/步随 locale;s/tok/s/% 烘死)。 */
function buildVocabulary(
  stats: DerivedStats | undefined,
  usage: TokenUsage | undefined,
  sessionCost: SessionCostView | undefined,
  last: LastStepReading | undefined,
  t: (key: keyof typeof zh) => string,
): Record<string, string | undefined> {
  const v: Record<string, string | undefined> = {}
  if (stats !== undefined && stats.steps > 0) {
    v.turns = `${stats.turns}${t('unitTurns')}`
    v.steps = `${stats.steps}${t('unitSteps')}`
    if (stats.llmMs > 0) v.llm = formatDuration(stats.llmMs)
    if (stats.toolMs > 0) v.tools = formatDuration(stats.toolMs)
    if (stats.ttftSteps > 0) v.ttft = formatDuration(stats.ttftMs / stats.ttftSteps)
    if (stats.decodeMs > 0) v.tps = `${formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1e3))} tok/s`
  }
  // 最近一轮:始终从窗口节点读取(sessionStats 投影不含逐步数据)。
  if (last !== undefined) {
    if (last.ttftMs !== null) v.ttftLast = formatDuration(last.ttftMs)
    if (last.decodeMs !== null && last.decodeMs > 0 && last.outputTokens !== null) {
      v.tpsLast = `${formatTokensPerSecond(last.outputTokens / (last.decodeMs / 1e3))} tok/s`
    }
  }
  if (usage !== undefined && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)) {
    v.input = formatTokens(billedInputTokens(usage))
    v.output = formatTokens(usage.outputTokens)
    const pct = cacheHitPercent(usage)
    if (pct !== null) v.cache = `${pct}%`
  }
  const cost = sessionCost?.display?.cost
  if (typeof cost === 'string' && cost !== '') v.cost = cost
  return v
}

/** 内置默认序列(label 随 locale);sections 空数组哨兵时使用。 */
function makeDefaultSections(t: (key: keyof typeof zh) => string): StatsLineSection[] {
  return [
    { components: ['$turns', '$steps'] },
    { components: ['LLM $llm', `${t('toolsLabel')}$tools`] },
    {
      components: [
        { show: 'TTFT $ttftLast', hint: `${t('avgPrefix')}$ttft` },
        { show: '$tpsLast', hint: `${t('avgPrefix')}$tps` },
      ],
    },
    { sep: '', components: ['↑$input', '($cache)', ' ↓$output'] },
    { components: ['$cost'] },
  ]
}

// ── cell 渲染 ────────────────────────────────────────────────────────

/** pieces → span 列表(cell 与卡片预览共用);hint 落在 title 属性上。 */
function renderPieces(pieces: StatsLinePiece[], keyPrefix: string): React.ReactElement[] {
  return pieces.map((piece, i) =>
    piece.type === 'sep'
      ? h('span', { className: piece.section ? 'dsl-sepbig' : 'dsl-sep', 'aria-hidden': true, key: `${keyPrefix}${i}` }, piece.text)
      : h('span', { className: 'dsl-item', title: piece.hint, key: `${keyPrefix}${i}` }, piece.text),
  )
}

interface CellProps {
  useSession?: <T>(selector: (state: { chat: { legacy: { nodes: ChatNode[] } } }) => T) => T
  useProjection?: {
    (key: 'tokenUsage'): TokenUsage | undefined
    (key: 'sessionStats'): DerivedStats | undefined
    (key: 'sessionCost'): SessionCostView | undefined
  }
  t: (key: keyof typeof zh, params?: Record<string, string | number>) => string
}

function CompactStatsLine(props: CellProps): React.ReactElement | null {
  const useSession = props.useSession
  const useProjection = props.useProjection
  const t = props.t
  const settledNodes = useSession !== undefined ? useSession((s) => s.chat.legacy.nodes) : undefined
  const usage = useProjection !== undefined ? useProjection('tokenUsage') : undefined
  const projected = useProjection !== undefined ? useProjection('sessionStats') : undefined
  const sessionCost = useProjection !== undefined ? useProjection('sessionCost') : undefined
  // 声明式 UI 配置:settings 命名空间 stats-line(设置 GUI / settings.yaml
  // 编辑,实时生效);loader config 是 base 层,由宿主端合成后持久化。
  const doc = React.useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot)?.value
  const stats: DerivedStats | undefined = projected ?? (settledNodes !== undefined ? deriveStats(settledNodes) : undefined)
  const last = settledNodes !== undefined ? lastStepReading(settledNodes) : undefined
  const sections = sectionsFromDoc(doc) ?? makeDefaultSections(t)
  const values = buildVocabulary(stats, usage, sessionCost, last, t)
  const pieces = renderStatsLine(sections, values)
  const style = styleFromDoc(doc)
  if (pieces.length === 0) return null
  const rootStyle: Record<string, string> = {}
  if (style.fontSize !== undefined) rootStyle.fontSize = style.fontSize
  if (style.color !== undefined) rootStyle.color = style.color
  if (style.fontFamily !== undefined) rootStyle.fontFamily = style.fontFamily
  if (style.gap !== undefined) rootStyle['--dsl-gap'] = style.gap
  if (style.sectionGap !== undefined) rootStyle['--dsl-section-gap'] = style.sectionGap
  return h('div', { className: 'dsl-root', style: rootStyle as React.CSSProperties }, renderPieces(pieces, 'p'))
}

// ── 设置卡片(settings.plugin.item,key = stats-line) ────────────────────
// 外壳(可折叠 li + 标题/描述/箭头)与字段样式复刻平台 PluginCard/ValueField
// 的视觉契约(那些 CSS module 与组件是包内私产,不可跨包 import)。
// 编辑模型:chip = 模板串 parse 出的 token 视图;存储 = 模板串,两者经
// parseTemplateTokens/serializeTokens 无损互转。

const SAMPLE_STATS: DerivedStats = { turns: 5, steps: 23, llmMs: 162_000, toolMs: 45_000, ttftMs: 1_200, ttftSteps: 1, decodeTokens: 2_025, decodeMs: 45_000 }
const SAMPLE_USAGE: TokenUsage = { uncachedInputTokens: 252_000, cacheReadTokens: 8_148_000, cacheWriteTokens: 0, outputTokens: 68_800 }
const SAMPLE_COST: SessionCostView = { display: { cost: '≈¥0.0082' } }
const SAMPLE_LAST: LastStepReading = { ttftMs: 980, decodeMs: 38_000, outputTokens: 1_862 }

/** 调色板:按领域分组的值清单。 */
const PALETTE: { group: 'paletteSession' | 'paletteTokens' | 'paletteCost'; refs: string[] }[] = [
  { group: 'paletteSession', refs: ['turns', 'steps', 'llm', 'tools', 'ttft', 'tps', 'ttftLast', 'tpsLast'] },
  { group: 'paletteTokens', refs: ['input', 'cache', 'output'] },
  { group: 'paletteCost', refs: ['cost'] },
]

interface StyleDraft {
  fontSize: string
  color: string
  fontFamily: string
  gap: string
  sectionGap: string
}

interface CardDraft {
  sections: StatsLineSection[]
  style: StyleDraft
}

function draftFromDoc(doc: unknown, t: (key: keyof typeof zh) => string): CardDraft {
  const style = styleFromDoc(doc)
  return {
    sections: structuredClone(sectionsFromDoc(doc) ?? makeDefaultSections(t)),
    style: {
      fontSize: style.fontSize ?? '',
      color: style.color ?? '',
      fontFamily: style.fontFamily ?? '',
      gap: style.gap ?? '',
      sectionGap: style.sectionGap ?? '',
    },
  }
}

/** 组件 show 模板 → tokens;对象形态保留 hint。 */
function componentTokens(component: StatsLineComponent): StatsLineToken[] {
  return parseTemplateTokens(typeof component === 'string' ? component : component.show)
}

/** tokens 写回组件(保留 hint)。 */
function withTokens(component: StatsLineComponent, tokens: StatsLineToken[]): StatsLineComponent {
  const show = serializeTokens(tokens)
  return typeof component === 'string' ? show : { show, ...(component.hint !== undefined ? { hint: component.hint } : {}) }
}

function StatsLineCard(props: CellProps): React.ReactElement | null {
  const t = props.t
  const snapshot = React.useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot)
  const writable = snapshot?.writable !== false
  const [draft, setDraft] = React.useState<CardDraft | null>(null)
  // 行内文本 token 编辑:{ 小组, 组件, token } 位置;value 为编辑中的文本。
  const [editing, setEditing] = React.useState<{ si: number; ci: number; ti: number; value: string } | null>(null)
  // 调色板插入目标:选中的 chip;无则追加到末尾小组的新组件。
  const [selected, setSelected] = React.useState<{ si: number; ci: number } | null>(null)
  const [gripActive, setGripActive] = React.useState<{ si: number; ci: number } | null>(null)
  const [dragFrom, setDragFrom] = React.useState<{ si: number; ci: number } | null>(null)
  if (snapshot === undefined) return null

  const effective = draft ?? draftFromDoc(snapshot.value, t)
  const edit = (fn: (d: CardDraft) => void): void => {
    const next = draft ?? draftFromDoc(snapshot.value, t)
    fn(next)
    setDraft({ ...next })
  }
  const editComponent = (si: number, ci: number, tokens: StatsLineToken[]): void =>
    edit((d) => {
      const section = d.sections[si]
      if (section === undefined) return
      section.components = section.components.map((c, i) => (i === ci ? withTokens(c, tokens) : c))
    })

  const dirty = draft !== null
  const save = (): void => {
    if (draft === null || settingsController === undefined) return
    const sections = normalizeSections(draft.sections)
    if (sections.length === 0) void settingsController.unset('sections')
    else void settingsController.set('sections', sections)
    for (const key of ['fontSize', 'color', 'fontFamily', 'gap', 'sectionGap'] as const) {
      const value = draft.style[key]
      if (value === '') void settingsController.unset(`style.${key}`)
      else void settingsController.set(`style.${key}`, value)
    }
    setDraft(null)
    setSelected(null)
    setEditing(null)
  }

  // 预览与线上 cell 走同一条 renderStatsLine 代码路径(示例数据)。
  const sampleValues = buildVocabulary(SAMPLE_STATS, SAMPLE_USAGE, SAMPLE_COST, SAMPLE_LAST, t)
  const preview = renderStatsLine(effective.sections, sampleValues)

  const addRef = (name: string): void => {
    if (!writable) return
    edit((d) => {
      const target = selected !== null ? d.sections[selected.si]?.components[selected.ci] : undefined
      if (selected !== null && target !== undefined) {
        const tokens = [...componentTokens(target), { type: 'ref' as const, name }]
        d.sections[selected.si]!.components[selected.ci] = withTokens(target, tokens)
        return
      }
      // 无选中:追加到末尾小组(无小组则新建)。
      if (d.sections.length === 0) d.sections.push({ components: [] })
      d.sections[d.sections.length - 1]!.components.push(`$${name}`)
    })
  }
  const addText = (): void => {
    if (!writable) return
    let target: { si: number; ci: number; ti: number } | null = null
    edit((d) => {
      if (d.sections.length === 0) d.sections.push({ components: [] })
      const si = selected !== null && d.sections[selected.si] !== undefined ? selected.si : d.sections.length - 1
      const section = d.sections[si]!
      let ci = selected !== null && selected.si === si && section.components[selected.ci] !== undefined ? selected.ci : section.components.length
      if (ci === section.components.length) section.components.push('')
      const comp = section.components[ci]!
      const tokens = [...componentTokens(comp), { type: 'text' as const, text: '' }]
      section.components[ci] = withTokens(comp, tokens)
      target = { si, ci, ti: tokens.length - 1 }
    })
    if (target !== null) setEditing({ ...(target as { si: number; ci: number; ti: number }), value: '' })
  }
  const addSection = (): void => {
    if (!writable) return
    edit((d) => {
      d.sections.push({ components: [''] })
    })
    setEditing(null)
  }

  const commitEditing = (cancel: boolean): void => {
    if (editing === null) return
    const { si, ci, ti, value } = editing
    setEditing(null)
    if (cancel) return
    edit((d) => {
      const comp = d.sections[si]?.components[ci]
      if (comp === undefined) return
      const tokens = componentTokens(comp)
      if (value === '') tokens.splice(ti, 1)
      else tokens[ti] = { type: 'text', text: value }
      d.sections[si]!.components[ci] = withTokens(comp, tokens)
    })
  }

  const moveComponent = (from: { si: number; ci: number }, to: { si: number; ci: number }): void => {
    if (from.si === to.si && from.ci === to.ci) return
    edit((d) => {
      const comp = d.sections[from.si]?.components[from.ci]
      if (comp === undefined) return
      d.sections[from.si]!.components.splice(from.ci, 1)
      const toCi = to.si === from.si && to.ci > from.ci ? to.ci - 1 : to.ci
      d.sections[to.si]!.components.splice(toCi, 0, comp)
    })
  }

  const sectionEls: React.ReactElement[] = []
  effective.sections.forEach((section, si) => {
    const chips: React.ReactElement[] = []
    section.components.forEach((component, ci) => {
      const tokens = componentTokens(component)
      const pos = { si, ci }
      const isSelected = selected !== null && selected.si === si && selected.ci === ci
      const isDragging = dragFrom !== null && dragFrom.si === si && dragFrom.ci === ci
      chips.push(
        h(
          'span',
          {
            className: isDragging ? 'dsl-chip dsl-dragging' : 'dsl-chip',
            key: `c${si}.${ci}`,
            style: isSelected ? { borderColor: 'var(--dsw-alias-border-l1)' } : undefined,
            draggable: gripActive !== null && gripActive.si === si && gripActive.ci === ci,
            onClick: () => setSelected(pos),
            onDragStart: () => setDragFrom(pos),
            onDragEnd: () => setDragFrom(null),
            onDragOver: (e: React.DragEvent<HTMLSpanElement>) => {
              if (dragFrom === null) return
              e.preventDefault()
              moveComponent(dragFrom, pos)
              setDragFrom(pos)
            },
          },
          [
            h(
              'span',
              {
                className: 'dsl-grip',
                key: 'g',
                onMouseDown: () => setGripActive(pos),
                onMouseUp: () => setGripActive(null),
              },
              '⠿',
            ),
            ...tokens.map((token, ti) => {
              if (token.type === 'ref') {
                return h('span', { className: 'dsl-tok dsl-tok-ref', key: `t${ti}` }, [
                  token.name,
                  h(
                    'button',
                    {
                      className: 'dsl-tokx',
                      key: 'x',
                      type: 'button',
                      'aria-label': 'remove',
                      onClick: (e: React.MouseEvent) => {
                        e.stopPropagation()
                        editComponent(si, ci, tokens.filter((_, i) => i !== ti))
                      },
                    },
                    '✕',
                  ),
                ])
              }
              const isEditing = editing !== null && editing.si === si && editing.ci === ci && editing.ti === ti
              if (isEditing) {
                return h('input', {
                  className: 'dsl-tokedit',
                  key: `t${ti}`,
                  autoFocus: true,
                  value: editing.value,
                  disabled: !writable,
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEditing({ ...editing, value: e.target.value }),
                  onBlur: () => commitEditing(false),
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === 'Enter') commitEditing(false)
                    if (e.key === 'Escape') commitEditing(true)
                  },
                  onClick: (e: React.MouseEvent) => e.stopPropagation(),
                })
              }
              return h(
                'span',
                {
                  className: 'dsl-tok dsl-tok-text',
                  key: `t${ti}`,
                  onClick: (e: React.MouseEvent) => {
                    e.stopPropagation()
                    if (writable) setEditing({ si, ci, ti, value: token.text })
                  },
                },
                token.text === '' ? ' ' : token.text,
              )
            }),
            h(
              'button',
              {
                className: 'dsl-chipx',
                key: 'x',
                type: 'button',
                'aria-label': 'remove component',
                onClick: (e: React.MouseEvent) => {
                  e.stopPropagation()
                  edit((d) => {
                    d.sections[si]?.components.splice(ci, 1)
                  })
                },
              },
              '✕',
            ),
          ],
        ),
      )
      // 幽灵连接符:展示用,不可编辑(生成规则见 renderStatsLine)。
      if (ci < section.components.length - 1) chips.push(h('span', { className: 'dsl-ghost', key: `s${si}.${ci}`, 'aria-hidden': true }, section.sep ?? '·'))
    })
    sectionEls.push(
      h('div', { className: 'dsl-section', key: `sec${si}` }, [
        h('span', { className: 'dsl-sectionhead', key: 'head' }, [
          h(
            'select',
            {
              className: 'dsl-sepsel',
              key: 'sep',
              value: section.sep === undefined ? 'default' : section.sep === '' ? 'none' : section.sep === ' ' ? 'space' : 'default',
              disabled: !writable,
              onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
                edit((d) => {
                  const s = d.sections[si]
                  if (s === undefined) return
                  if (e.target.value === 'default') delete s.sep
                  else if (e.target.value === 'none') s.sep = ''
                  else s.sep = ' '
                }),
            },
            [h('option', { key: 'd', value: 'default' }, t('sepDot')), h('option', { key: 's', value: 'space' }, t('sepSpace')), h('option', { key: 'n', value: 'none' }, t('sepNone'))],
          ),
          h(
            'button',
            {
              className: 'dsl-sectionx',
              key: 'x',
              type: 'button',
              'aria-label': t('deleteSection'),
              disabled: !writable,
              onClick: () =>
                edit((d) => {
                  d.sections.splice(si, 1)
                }),
            },
            '✕',
          ),
        ]),
        ...chips,
      ]),
    )
    // 小组间幽灵 '|'
    if (si < effective.sections.length - 1) sectionEls.push(h('span', { className: 'dsl-ghost', key: `big${si}`, 'aria-hidden': true }, '|'))
  })

  const styleField = (key: keyof StyleDraft, label: string): React.ReactElement =>
    h('div', { className: 'dsl-field', key }, [
      h('label', { className: 'dsl-label', key: 'l' }, label),
      h('input', {
        className: 'dsl-input',
        key: 'in',
        type: 'text',
        value: effective.style[key],
        disabled: !writable,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => edit((d) => void (d.style[key] = e.target.value)),
      }),
    ])

  return h('li', { className: 'dsl-itemcard' }, [
    h('details', { key: 'det' }, [
      h('summary', { className: 'dsl-card', key: 's' }, [
        h('div', { className: 'dsl-headtext', key: 'ht' }, [
          h('span', { className: 'dsl-title', key: 't' }, t('cardTitle')),
          h('span', { className: 'dsl-desc', key: 'd' }, t('cardDesc')),
        ]),
        h('svg', { className: 'dsl-arrow', key: 'a', viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': true }, [
          h('path', { d: 'M5.25 3.5 8.75 7l-3.5 3.5', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        ]),
      ]),
      h('div', { className: 'dsl-body', key: 'b' }, [
        h('div', { className: 'dsl-preview', key: 'p' }, preview.length > 0 ? renderPieces(preview, 'v') : t('preview')),
        h('div', { className: 'dsl-strip', key: 'strip' }, sectionEls),
        h('div', { className: 'dsl-palette', key: 'pal' }, [
          ...PALETTE.flatMap((g) => [
            h('span', { className: 'dsl-palgroup', key: `g-${g.group}` }, t(g.group)),
            ...g.refs.map((name) =>
              h('button', { className: 'dsl-palbtn', key: name, type: 'button', disabled: !writable, onClick: () => addRef(name) }, name),
            ),
          ]),
          h('button', { className: 'dsl-palbtn', key: 'add-text', type: 'button', disabled: !writable, onClick: addText }, t('addText')),
          h('button', { className: 'dsl-palbtn', key: 'add-sec', type: 'button', disabled: !writable, onClick: addSection }, t('addSection')),
        ]),
        h('div', { className: 'dsl-field', key: 'style' }, [
          h('label', { className: 'dsl-label', key: 'l' }, t('styleLabel')),
          h('div', { className: 'dsl-stylerow', key: 'r' }, [
            styleField('fontSize', t('styleFontSize')),
            styleField('color', t('styleColor')),
            styleField('fontFamily', t('styleFontFamily')),
            styleField('gap', t('styleGap')),
            styleField('sectionGap', t('styleSectionGap')),
          ]),
        ]),
        writable ? null : h('div', { className: 'dsl-rohint', key: 'ro' }, t('readonly')),
        h('div', { className: 'dsl-footer', key: 'foot' }, [
          h('button', { className: 'dsl-discard', key: 'd', type: 'button', disabled: !dirty, onClick: () => { setDraft(null); setSelected(null); setEditing(null) } }, t('cardDiscard')),
          h('button', { className: 'dsl-save', key: 's', type: 'button', disabled: !dirty || !writable, onClick: save }, t('cardSave')),
        ]),
      ]),
    ]),
  ])
}

// ── 入口 ─────────────────────────────────────────────────────────────

export function apply(ctx: ClientContext): void {
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
