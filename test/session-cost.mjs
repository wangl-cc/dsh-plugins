// 测试构建产物(dist/),而非 src——pnpm test 会先跑 pnpm build。
import { makeSessionCostProjection, costOf, tierFor, rateFor, eraFor, PROVIDERS, isPeakHour, toUtcWindows } from '../dist/index.js'

let failures = 0
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) < eps
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
  if (!cond) failures += 1
}

const proj = makeSessionCostProjection()
let state = proj.init()

const at = (iso) => Date.parse(iso)
// 谷时:2026-08-18T00:00:00Z(UTC hour 0,off-peak)
const offPeakAt = at('2026-08-18T00:00:00Z')
// 峰时:2026-08-18T02:00:00Z(UTC hour 2,peak)
const peakAt = at('2026-08-18T02:00:00Z')
// 峰谷时代前:2026-08-10T00:00:00Z
const legacyAt = at('2026-08-10T00:00:00Z')

const deepseek = PROVIDERS['deepseek-official']
const eraOld = deepseek.eras[0] // 统一价时代
const eraNew = deepseek.eras[1] // 峰谷时代(2026-08-16T16:00Z 起)
const flash = eraNew.models['deepseek-v4-flash']
const flashOld = eraOld.models['deepseek-v4-flash']

// 1) 时代选择(eraFor)
check('峰谷生效时刻进入新时代', eraFor(deepseek, at('2026-08-16T16:00:00Z')) === eraNew)
check('生效前一微秒仍是旧时代', eraFor(deepseek, at('2026-08-16T16:00:00Z') - 1) === eraOld)
check('历史时刻在旧时代', eraFor(deepseek, legacyAt) === eraOld)
check('非法时刻无时代', eraFor(deepseek, NaN) === undefined)

// 2) tier 选择(峰谷时代)
check('谷时用时代基价', tierFor(flash, offPeakAt, eraNew).cacheMiss === 0.22)
check('峰时用 peak 档(2x)', tierFor(flash, peakAt, eraNew).cacheMiss === 0.44)
check('旧时代无峰谷(峰时窗口为空)', tierFor(flashOld, at('2026-08-10T02:00:00Z'), eraOld).cacheMiss === 0.14)
check('isPeakHour 边界:01:00 进入', isPeakHour(at('2026-08-18T01:00:00Z'), eraNew.peakWindows))
check('isPeakHour 边界:04:00 退出', !isPeakHour(at('2026-08-18T04:00:00Z'), eraNew.peakWindows))
check('isPeakHour 第二个窗口 06-10', isPeakHour(at('2026-08-18T09:59:00Z'), eraNew.peakWindows) && !isPeakHour(at('2026-08-18T10:00:00Z'), eraNew.peakWindows))

// 2b) 时区换算助手:北京时间(UTC+8)08:00-12:00 → UTC 00:00-04:00
const utc = toUtcWindows([{ start: 8, end: 12 }], 8)
check('toUtcWindows 北京时间→UTC', utc[0].start === 0 && utc[0].end === 4)
check('toUtcWindows 跨午夜', toUtcWindows([{ start: 20, end: 2 }], 8)[0].start === 12)
check('峰谷窗口换算自北京 09-12/14-18', eraNew.peakWindows[0].start === 1 && eraNew.peakWindows[1].start === 6)

// 3) costOf 数值
// 谷时:input 1000(cacheMiss $0.22/M) + output 500($0.66/M) + cacheRead 100 + cacheWrite 50($0.007/M)
const expectedOffPeak = (1000 * 0.22 + 500 * 0.66 + 150 * 0.007) / 1e6
check('costOf 谷时数值', approx(costOf({ input: 1000, output: 500, cacheRead: 100, cacheWrite: 50 }, flash, offPeakAt, eraNew), expectedOffPeak))
const expectedPeak = (1000 * 0.44 + 500 * 1.32 + 150 * 0.014) / 1e6
check('costOf 峰时数值', approx(costOf({ input: 1000, output: 500, cacheRead: 100, cacheWrite: 50 }, flash, peakAt, eraNew), expectedPeak))
// 旧时代统一价:cacheMiss 0.14 / output 0.28 / cacheHit 0.0028
const expectedLegacy = (1000 * 0.14 + 500 * 0.28 + 150 * 0.0028) / 1e6
check('costOf 旧时代统一价', approx(costOf({ input: 1000, output: 500, cacheRead: 100, cacheWrite: 50 }, flashOld, legacyAt, eraOld), expectedLegacy))

// 3b) rateFor 路由解析(含时刻维度)
check('metered 路由解析(峰谷时代)', rateFor('deepseek-official', 'deepseek-v4-flash', offPeakAt).tier.cacheMiss === 0.22)
check('metered 路由解析(旧时代)', rateFor('deepseek-official', 'deepseek-v4-flash', legacyAt).tier.cacheMiss === 0.14)
check('订阅路由解析', rateFor('kimi-coding', 'k3-256k', offPeakAt).kind === 'subscription')
check('未知 provider 为 unknown', rateFor('some-other', 'x', offPeakAt).kind === 'unknown')
check('已知 provider 未知模型为 unknown(不回退别家价)', rateFor('deepseek-official', 'deepseek-v9-ultra', offPeakAt).kind === 'unknown')

// 3c) 未来调价 = 追加时代:克隆一份 provider,2027-01-01 起新价,验证切换
const futureProviders = structuredClone(PROVIDERS)
const era2027 = {
  since: '2027-01-01T00:00:00Z',
  peakWindows: eraNew.peakWindows,
  models: { 'deepseek-v4-flash': { cacheHit: 0.01, cacheMiss: 0.3, output: 0.9, peak: { cacheHit: 0.02, cacheMiss: 0.6, output: 1.8 } } },
}
futureProviders['deepseek-official'].eras.push(era2027)
check('未来时代生效后按新价', rateFor('deepseek-official', 'deepseek-v4-flash', at('2027-01-02T00:00:00Z'), futureProviders).tier.cacheMiss === 0.3)
check('未来时代生效前仍按现价', rateFor('deepseek-official', 'deepseek-v4-flash', offPeakAt, futureProviders).tier.cacheMiss === 0.22)
check('追加时代不影响历史计费', approx(costOf({ input: 1000, output: 500, cacheRead: 100, cacheWrite: 50 }, rateFor('deepseek-official', 'deepseek-v4-flash', legacyAt, futureProviders).entry, legacyAt, eraOld), expectedLegacy))

// 4) 投影折叠:流式 usage chunk 后被最终 message 替换,不重复计数
const usageChunk = { inputTokens: 800, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 50 }
const usageFinal = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 100, cacheWriteTokens: 50, reasoningTokens: 80 }

state = proj.apply(state, {
  type: 'request/header', time: offPeakAt,
  data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } } },
})
// 流式 usage chunk(step 1)
state = proj.apply(state, {
  type: 'assistant/chunk', time: offPeakAt, data: { turn: 1, step: 1, chunk: { type: 'usage', usage: usageChunk } },
})
let view = proj.view(state)
const chunkCost = costOf({ input: 800, output: 300, cacheRead: 0, cacheWrite: 0 }, flash, offPeakAt, eraNew)
check('流式 chunk 计入', approx(view.cost, chunkCost) && view.input === 800)
// 同 (1,1) 的最终 message:替换而非叠加
state = proj.apply(state, {
  type: 'assistant/message', time: offPeakAt, data: { turn: 1, step: 1, usage: usageFinal },
})
view = proj.view(state)
check('最终样本替换流式样本(不重复计数)', approx(view.cost, expectedOffPeak) && view.input === 1000 && view.output === 500)
// 相同的最终样本再次出现:幂等,不重复计费
state = proj.apply(state, {
  type: 'assistant/message', time: offPeakAt, data: { turn: 1, step: 1, usage: usageFinal },
})
view = proj.view(state)
check('同样本幂等', approx(view.cost, expectedOffPeak))
// 新 step(1,2)峰时调用
const usage2 = { inputTokens: 2000, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }
state = proj.apply(state, {
  type: 'assistant/message', time: peakAt, data: { turn: 1, step: 2, usage: usage2 },
})
view = proj.view(state)
const cost2 = (2000 * 0.44 + 1000 * 1.32) / 1e6
check('峰时第二步累计', approx(view.cost, expectedOffPeak + cost2) && view.input === 3000 && view.output === 1500)
// reasoning 桶单独记录但不重复计费
check('reasoning 桶记录', view.reasoning === 80)
check('全 metered 会话 pricing=metered', view.pricing === 'metered')

// 4b) 跨时代会话:同一一步前在旧时代、一步后在新时代,各按各价
let sX = proj.init()
sX = proj.apply(sX, {
  type: 'request/header', time: legacyAt,
  data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } } },
})
sX = proj.apply(sX, {
  type: 'assistant/message', time: legacyAt, data: { turn: 1, step: 1, usage: usageFinal },
})
sX = proj.apply(sX, {
  type: 'assistant/message', time: offPeakAt, data: { turn: 1, step: 2, usage: usageFinal },
})
check('跨时代会话各按各价', approx(proj.view(sX).cost, expectedLegacy + expectedOffPeak))

// 5) schema 校验 view 输出
const parsed = proj.schema.parse(view)
check('schema 通过', parsed.cost === view.cost && parsed.pricing === 'metered')

// 6) 订阅制 provider:token 照计,按刊例价估算参考金额,pricing=subscription
let s2 = proj.init()
s2 = proj.apply(s2, {
  type: 'request/header', time: offPeakAt,
  data: { header: { config: { provider: 'kimi-coding', model: 'k3-256k' } } },
})
s2 = proj.apply(s2, {
  type: 'assistant/message', time: offPeakAt,
  data: { turn: 1, step: 1, usage: { inputTokens: 70213, outputTokens: 17520, cacheReadTokens: 2299648 } },
})
const v2 = proj.view(s2)
// Kimi K3 刊例价:input 70213×$3.0/M + output 17520×$15/M + cacheRead 2299648×$0.30/M
const expectedKimi = (70213 * 3.0 + 17520 * 15.0 + 2299648 * 0.30) / 1e6
check('订阅制按刊例价估算', approx(v2.cost, expectedKimi) && v2.pricing === 'subscription')
check('订阅制 token 照计', v2.input === 70213 && v2.cacheRead === 2299648)

// 6b) 无刊例价的订阅端点:cost 恒 0,只显示订阅标签
let s5 = proj.init()
s5 = proj.apply(s5, {
  type: 'request/header', time: offPeakAt,
  data: { header: { config: { provider: 'opencode-go', model: 'whatever' } } },
})
s5 = proj.apply(s5, {
  type: 'assistant/message', time: offPeakAt,
  data: { turn: 1, step: 1, usage: { inputTokens: 100000, outputTokens: 50000 } },
})
const v5 = proj.view(s5)
check('无刊例价订阅不计费', v5.cost === 0 && v5.pricing === 'subscription')

// 7) 未知 provider:绝不套用 deepseek 价
let s3 = proj.init()
s3 = proj.apply(s3, {
  type: 'request/header', time: offPeakAt,
  data: { header: { config: { provider: 'mystery', model: 'x-1' } } },
})
s3 = proj.apply(s3, {
  type: 'assistant/message', time: offPeakAt,
  data: { turn: 1, step: 1, usage: { inputTokens: 100000, outputTokens: 50000 } },
})
const v3 = proj.view(s3)
check('未知 provider 不计费', v3.cost === 0 && v3.pricing === 'unknown')

// 8) 混合会话(deepseek + kimi):metered 部分照算,pricing=mixed
let s4 = proj.init()
s4 = proj.apply(s4, {
  type: 'request/header', time: offPeakAt,
  data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } } },
})
s4 = proj.apply(s4, {
  type: 'assistant/message', time: offPeakAt, data: { turn: 1, step: 1, usage: usageFinal },
})
s4 = proj.apply(s4, {
  type: 'request/header', time: offPeakAt,
  data: { header: { config: { provider: 'kimi-coding', model: 'k3-256k' } } },
})
s4 = proj.apply(s4, {
  type: 'assistant/message', time: offPeakAt,
  data: { turn: 2, step: 1, usage: { inputTokens: 5000, outputTokens: 1000 } },
})
const v4 = proj.view(s4)
check('混合会话 pricing=mixed', v4.pricing === 'mixed')
// metered 精确 + 订阅刊例估算(5000×$3.0 + 1000×$15)/1e6
const expectedMixed = expectedOffPeak + (5000 * 3.0 + 1000 * 15.0) / 1e6
check('混合会话金额 = metered + 订阅估算', approx(v4.cost, expectedMixed) && v4.input === 6000)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
