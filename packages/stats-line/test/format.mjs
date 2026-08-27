// 共享纯函数(format.ts → dist/format.js)的测试:格式化、节点折叠、
// 模板组件模型。这些函数被 client bundle 内联使用——这里测的就是线上
// 跑的那份逻辑。
import {
  lastStepReading,
  billedInputTokens,
  cacheHitPercent,
  deriveStats,
  formatDuration,
  formatTokens,
  formatTokensPerSecond,
  parseTemplateTokens,
  serializeTokens,
  resolveTemplate,
  renderStatsLine,
  normalizeSections,
  migrateLegacyItems,
} from '../dist/format.js'

let failures = 0
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
  if (!cond) failures += 1
}

// formatTokens:517 / 12.2K / 517K / 1.2M
check('formatTokens 小数值原样', formatTokens(517) === '517')
check('formatTokens K 档一位小数', formatTokens(12200) === '12.2K')
check('formatTokens K 档三位取整', formatTokens(517000) === '517K')
check('formatTokens M 档', formatTokens(1200000) === '1.2M')

// formatDuration:45.2s / 2m42s
check('formatDuration 秒档', formatDuration(45200) === '45.2s')
check('formatDuration 分钟档', formatDuration(162000) === '2m42s')
check('formatDuration 舍入到 60s 升分钟档', formatDuration(59960) === '1m0s')

// formatTokensPerSecond:<10 保留一位小数
check('tps 高档取整', formatTokensPerSecond(45.4) === '45')
check('tps 低档一位小数', formatTokensPerSecond(8.34) === '8.3')

// 计费桶
const usage = { uncachedInputTokens: 100, outputTokens: 50, cacheReadTokens: 900, cacheWriteTokens: 0 }
check('billedInputTokens 三桶求和', billedInputTokens(usage) === 1000)
check('cacheHitPercent 取整', cacheHitPercent(usage) === 90)
check('cacheHitPercent 零输入为 null', cacheHitPercent({ uncachedInputTokens: 0, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 }) === null)

// ── 模板引擎:$name 插值,$$ 转义,孤立 $ 字面 ──
check('parse 文本与 ref 交替', JSON.stringify(parseTemplateTokens('TTFT $ttft')) === JSON.stringify([{ type: 'text', text: 'TTFT ' }, { type: 'ref', name: 'ttft' }]))
check('parse $$ 为字面 $', JSON.stringify(parseTemplateTokens('$$5')) === JSON.stringify([{ type: 'text', text: '$5' }]))
check('parse 孤立 $ 字面', JSON.stringify(parseTemplateTokens('a$')) === JSON.stringify([{ type: 'text', text: 'a$' }]))
check('parse 紧贴标点', JSON.stringify(parseTemplateTokens('($cache)')) === JSON.stringify([{ type: 'text', text: '(' }, { type: 'ref', name: 'cache' }, { type: 'text', text: ')' }]))
check('serialize 转义 $', serializeTokens([{ type: 'text', text: '$5' }, { type: 'ref', name: 'cost' }]) === '$$5$cost')
check('parse/serialize 幂等', serializeTokens(parseTemplateTokens('avg $tps · $$x')) === 'avg $tps · $$x')
check('resolveTemplate 插值', resolveTemplate('↑$input ($cache)', { input: '8.4M', cache: '97%' }) === '↑8.4M (97%)')
check('resolveTemplate 缺失值整个不解析', resolveTemplate('≈$cost', {}) === undefined)
check('resolveTemplate 空串值照常渲染', resolveTemplate('[$cache]', { cache: '' }) === '[]')

// ── renderStatsLine:消失规则与幽灵连接符 ──
const vals = { turns: '5 轮', steps: '23 步', llm: '2m42s', input: '8.4M', cache: '97%', output: '68.8K' }
const sections = [
  { components: ['$turns', '$steps'] },
  { components: ['LLM $llm', '工具 $tools'] },   // tools 缺失 → 组件消失
  { sep: '', components: ['↑$input', '($cache)', ' ↓$output'] },
  { components: ['$cost'] },                      // cost 缺失 → 整组消失
]
check('渲染序列文本', renderStatsLine(sections, vals).map((p) => p.text).join('') === '5 轮·23 步|LLM 2m42s|↑8.4M(97%) ↓68.8K')
check('渲染:连接符层级标记正确', (() => { const ps = renderStatsLine(sections, vals); return ps[1].type === 'sep' && ps[1].section === false && ps[3].type === 'sep' && ps[3].section === true })())
check('空小组消失且无孤儿 |', renderStatsLine([{ components: ['$cost'] }, { components: ['$turns'] }], vals).map((p) => (p.type === 'sep' ? '|' : p.text)).join('') === '5 轮')
check('行首无连接符', renderStatsLine([{ components: ['$turns'] }], vals)[0].type === 'text')
check('全部缺失为空', renderStatsLine([{ components: ['$cost'] }], vals).length === 0)
check('cache 缺失时括号组件死、两侧贴死保留', renderStatsLine([{ sep: '', components: ['↑$input', '($cache)', ' ↓$output'] }], { input: '8.4M', output: '68.8K' }).map((p) => p.text).join('') === '↑8.4M ↓68.8K')
// hint:独立全有全无;组件可得但 hint 引用缺失 → 仅丢 hint
const hinted = renderStatsLine([{ components: [{ show: '$tpsLast', hint: 'avg $tps' }] }], { tpsLast: '53 tok/s' })
check('hint 缺失时仅丢 hint', hinted.length === 1 && hinted[0].text === '53 tok/s' && hinted[0].hint === undefined)
check('hint 可得时随组件渲染', renderStatsLine([{ components: [{ show: '$tpsLast', hint: 'avg $tps' }] }], { tpsLast: '53 tok/s', tps: '45 tok/s' })[0].hint === 'avg 45 tok/s')
check('组件缺失 hint 连带消失', renderStatsLine([{ components: [{ show: '$nope', hint: 'avg $tps' }] }], { tps: '45' }).length === 0)

// ── normalizeSections:防御性归一化 ──
check('normalize 非法条目丢弃', JSON.stringify(normalizeSections([{ components: ['$a', 3, null, '', { show: '$b', hint: 1 }, { show: '' }] }])) === JSON.stringify([{ components: ['$a', { show: '$b' }] }]))
check('normalize 空小组丢弃', normalizeSections([{ components: [] }, { components: ['$a'] }]).length === 1)
check('normalize 保留 sep', normalizeSections([{ sep: '', components: ['$a'] }])[0].sep === '')
check('normalize 非数组为空', normalizeSections('bogus').length === 0)

// ── 旧 items 迁移 ──
const migrated = migrateLegacyItems([
  { kind: 'counts', size: 'small', template: '' },
  { kind: 'sep', size: 'big', template: '' },
  { kind: 'llm', size: 'small', template: '' },
  { kind: 'sep', size: 'small', template: '' },
  { kind: 'custom', size: 'small', template: 'T={turns}' },
  { kind: 'sep', size: 'big', template: '' },
  { kind: 'tokens', size: 'small', template: '' },
  { kind: 'sep', size: 'big', template: '' },
  { kind: 'cost', size: 'small', template: '' },
])
check('迁移:big sep 分小组', migrated.length === 4)
check('迁移:counts 展开为两组件', JSON.stringify(migrated[0].components) === JSON.stringify(['$turns', '$steps']))
check('迁移:custom 模板 {name} → $name', migrated[1].components[1] === 'T=$turns')
check('迁移:tokens 为贴死小组', migrated[2].sep === '' && JSON.stringify(migrated[2].components) === JSON.stringify(['↑$input', '($cache)', ' ↓$output']))
check('迁移:非数组为空', migrateLegacyItems('bogus').length === 0)

// deriveStats:assistant/tool-result 折叠
const nodes = [
  { kind: 'assistant', turn: 1, time: 2000, timing: { stepStartTime: 1000, firstTokenTime: 1200, completedTime: 2000 }, usage: { outputTokens: 300 } },
  { kind: 'tool-result', time: 2600, callTime: 2100 },
  { kind: 'assistant', turn: 1, time: 4000, timing: { stepStartTime: 3000, firstTokenTime: 3300, completedTime: 4000 }, usage: { outputTokens: 200 } },
  { kind: 'user', time: 500 },
]
const stats = deriveStats(nodes)
check('deriveStats 步数与轮数', stats.steps === 2 && stats.turns === 1)
check('deriveStats LLM 耗时', stats.llmMs === 2000)
check('deriveStats 工具耗时', stats.toolMs === 500)
check('deriveStats TTFT 均值分子', stats.ttftMs === 500 && stats.ttftSteps === 2)
check('deriveStats decode', stats.decodeMs === 1500 && stats.decodeTokens === 500)
check('deriveStats 空窗口', deriveStats([]).steps === 0)

// lastStepReading:与官方 deriveTurnMetrics 同构——最后一个 assistant node
// 所在 turn 的聚合:tps = 该轮 Σ outputTokens / Σ decodeMs(加权),TTFT 取
// 该轮首步;流式未完成的 step 不计入;字段按指标各自可空
const asst = (turn, step, timing, outputTokens) => ({ kind: 'assistant', turn, step, time: 0, timing, usage: outputTokens === null ? null : { outputTokens } })
const done = (turn, step, ttft, decode, out) => asst(turn, step, { stepStartTime: 0, firstTokenTime: ttft, completedTime: ttft + decode }, out)
const streaming = (turn, step) => asst(turn, step, { stepStartTime: 0, firstTokenTime: 500, completedTime: NaN }, null)
// 最后一轮两个 step:加权 tps = 2500/50s = 50;TTFT 取首步 800
const folded = lastStepReading([done(1, 1, 1_000, 10_000, 300), done(2, 1, 800, 10_000, 500), done(2, 2, 600, 40_000, 2_000)])
check('lastStepReading 末轮多 step 加权', folded !== undefined && folded.decodeMs === 50_000 && folded.outputTokens === 2_500)
check('lastStepReading TTFT 取末轮首步', folded !== undefined && folded.ttftMs === 800)
// 末轮正在流式:首步 TTFT 已有,已完成 step 照常计入
const live = lastStepReading([done(1, 1, 900, 10_000, 400), streaming(2, 1)])
check('lastStepReading 流式轮 TTFT 已可用', live !== undefined && live.ttftMs === 500)
check('lastStepReading 流式轮尚无 tps', live !== undefined && live.decodeMs === null && live.outputTokens === null)
const noTtft = lastStepReading([asst(1, 1, { stepStartTime: null, firstTokenTime: 100, completedTime: 10_100 }, 500)])
check('lastStepReading ttft 可空但 tps 可用', noTtft !== undefined && noTtft.ttftMs === null && noTtft.decodeMs === 10_000)
check('lastStepReading 空窗口', lastStepReading([]) === undefined)
check('lastStepReading 无 assistant', lastStepReading([{ kind: 'tool-result', time: 0, callTime: null }]) === undefined)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
