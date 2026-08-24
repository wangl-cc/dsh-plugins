// 共享纯函数(format.ts → dist/format.js)的测试:格式化、币种解析、节点折叠。
// 这些函数被 client bundle 内联使用——这里测的就是线上跑的那份逻辑。
import {
  lastStepReading,
  billedInputTokens,
  cacheHitPercent,
  deriveStats,
  formatDuration,
  formatMoney,
  formatTokens,
  formatTokensPerSecond,
  interpolate,
  renderTemplate,
  renderStatsLineItems,
  normalizeItem,
  makeItem,
  DEFAULT_STATS_LINE_ITEMS,
  resolveCurrency,
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

// resolveCurrency:缺省 CNY;汇率非法回退 preset;custom 币种用 symbol
check('缺省 CNY', resolveCurrency(undefined).symbol === '¥' && resolveCurrency(undefined).rate === 7.2)
check('非法汇率回退', resolveCurrency({ currency: 'USD', exchangeRate: -1 }).rate === 1)
check('custom 符号', resolveCurrency({ currency: 'custom', symbol: '€', exchangeRate: 0.9, decimals: 2 }).symbol === '€')
check('币种码小写归一化为大写', resolveCurrency({ currency: 'eur' }).symbol === '€')

// interpolate:占位符替换;未知占位符保留
check('interpolate 替换', interpolate('{turns} 轮 · {steps} 步', { turns: 5, steps: 23 }) === '5 轮 · 23 步')
check('interpolate 未知占位符保留', interpolate('{a}/{b}', { a: 1 }) === '1/{b}')

// renderTemplate:引用缺失值的模板返回 undefined;空串占位符照常渲染
const vals = { turns: '5', steps: '23', input: '8.4M', output: '68.8K', cache: '(97%)', cost: undefined }
check('renderTemplate 缺失值丢弃', renderTemplate('费用 {cost}', vals) === undefined)
check('renderTemplate 正常插值', renderTemplate('{turns} turns · {steps} steps', vals) === '5 turns · 23 steps')
check('renderTemplate 空串占位符渲染', renderTemplate('↑{input}{cache}', { input: '8.4M', cache: '' }) === '↑8.4M')

// renderStatsLineItems:不可得组件消失 + 分隔符收敛(边缘删除,相邻留大)
const parts = { counts: '5 turns', llm: 'LLM 2m42s', tps: '45 tok/s', tokens: '↑8.4M ↓68.8K' }
const pieceText = (p) => (p.type === 'sep' ? `sep:${p.size}` : p.text)
const seq = [makeItem('counts'), makeItem('sep', { size: 'big' }), makeItem('llm'), makeItem('sep'), makeItem('tools'), makeItem('sep', { size: 'big' }), makeItem('tps')]
check('缺失组件消失且小分隔符被大分隔符吸收', renderStatsLineItems(seq, parts, {}).map(pieceText).join(',') === '5 turns,sep:big,LLM 2m42s,sep:big,45 tok/s')
check('边缘分隔符删除', renderStatsLineItems([makeItem('sep'), makeItem('counts'), makeItem('sep', { size: 'big' })], parts, {}).map(pieceText).join(',') === '5 turns')
check('自定义模板插值', renderStatsLineItems([makeItem('custom', { template: 'T={turns}' })], {}, { turns: '5' })[0].text === 'T=5')
check('自定义模板引用缺失值丢弃', renderStatsLineItems([makeItem('custom', { template: 'T={nope}' }), makeItem('counts')], parts, {}).length === 1)
check('空模板自定义组件丢弃', renderStatsLineItems([makeItem('custom'), makeItem('counts')], parts, {}).length === 1)
check('全部不可达为空', renderStatsLineItems([makeItem('cost'), makeItem('sep')], {}, {}).length === 0)

// normalizeItem:非法输入丢弃,字段哨兵归一
check('normalizeItem 非法 kind 丢弃', normalizeItem({ kind: 'bogus' }) === undefined && normalizeItem('x') === undefined)
check('normalizeItem 字段归一', JSON.stringify(normalizeItem({ kind: 'cost', size: 'bogus', template: 3 })) === JSON.stringify(makeItem('cost')))
check('默认序列首尾', DEFAULT_STATS_LINE_ITEMS[0].kind === 'counts' && DEFAULT_STATS_LINE_ITEMS.at(-1).kind === 'cost' && DEFAULT_STATS_LINE_ITEMS.length === 13)

// formatMoney:汇率换算、小数裁剪、过小自动放宽
check('formatMoney 换汇', formatMoney(0.5, { symbol: '¥', rate: 7.2, decimals: 4 }) === '¥3.6')
check('formatMoney 尾零裁剪', formatMoney(1 / 8, { symbol: '$', rate: 1, decimals: 4 }) === '$0.125')
check('formatMoney 过小放宽', formatMoney(0.000001, { symbol: '$', rate: 1, decimals: 4 }) === '$0.000001')

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
