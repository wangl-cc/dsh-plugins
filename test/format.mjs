// 共享纯函数(format.ts → dist/format.js)的测试:格式化、币种解析、节点折叠。
// 这些函数被 client bundle 内联使用——这里测的就是线上跑的那份逻辑。
import {
  billedInputTokens,
  cacheHitPercent,
  deriveStats,
  formatDuration,
  formatMoney,
  formatTokens,
  formatTokensPerSecond,
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

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
