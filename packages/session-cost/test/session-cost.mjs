// 测试构建产物(dist/),而非 src——pnpm test 会先跑 pnpm build。
import { makeSessionCostProjection, refreshCurrencyRate, toBaseDoc, currencyConfigFromDoc, sessionCostSettingsSchema, makeCurrencyDriver, SESSION_COST_NS, costOf, tierFor, rateFor, eraFor, PROVIDERS, isPeakHour, toUtcWindows } from '../dist/index.js'

let failures = 0
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) < eps
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
  if (!cond) failures += 1
}

const proj = makeSessionCostProjection()
// 0.1.1 起注册表只把带 wire 的投影视图发给浏览器——回归保护:wire 必须在且通过自身 viewSchema 校验
check('投影带 wire 频道', proj.wire !== undefined && proj.wire.viewSchema.parse(proj.wire.view(proj.init())).pricing === 'none')
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
check('订阅路由 k3 别名(DSH 默认路由上报的模型 id)', rateFor('kimi-coding', 'k3', offPeakAt).tier?.cacheMiss === 3.0)
check('订阅路由 K2.7 Code(官方 id)', rateFor('kimi-coding', 'kimi-k2.7-code', offPeakAt).tier?.cacheMiss === 0.95)
check('订阅路由 K2.7 Code(简写 id)', rateFor('kimi-coding', 'k2.7-code', offPeakAt).tier?.output === 4.0)
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

// 3d) cacheWrite 独立价档(Anthropic 风格写读不同价);缺省按 cacheHit 计
const anthropicStyle = { cacheHit: 0.3, cacheMiss: 3.0, output: 15.0, cacheWrite: 3.75 }
check('cacheWrite 显式价档生效', approx(costOf({ cacheRead: 1000, cacheWrite: 1000 }, anthropicStyle, offPeakAt), (1000 * 0.3 + 1000 * 3.75) / 1e6))
check('cacheWrite 缺省按命中价', approx(costOf({ cacheRead: 1000, cacheWrite: 1000 }, { cacheHit: 0.3, cacheMiss: 3.0, output: 15.0 }, offPeakAt), (2000 * 0.3) / 1e6))
const anthropicPeaked = { ...anthropicStyle, peak: { cacheHit: 0.6, cacheMiss: 6.0, output: 30.0, cacheWrite: 7.5 } }
check('peak 档携带独立 cacheWrite 价', approx(costOf({ cacheWrite: 1000 }, anthropicPeaked, peakAt, eraNew), (1000 * 7.5) / 1e6))

// 3e) OpenAI GPT 5.6:独立 cacheWrite + 272K 长上下文分档(Standard 刊例)
const sol = PROVIDERS['openai'].eras[0].models['gpt-5.6-sol']
check('openai 路由解析', rateFor('openai', 'gpt-5.6-terra', offPeakAt).tier?.cacheWrite === 2.5)
// 短上下文:input 1000×$5 + cached 500×$0.5 + write 200×$6.25 + output 100×$30
check('gpt-5.6-sol 短上下文计费', approx(costOf({ input: 1000, cacheRead: 500, cacheWrite: 200, output: 100 }, sol, offPeakAt), (1000 * 5 + 500 * 0.5 + 200 * 6.25 + 100 * 30) / 1e6))
// prompt = 272000 整 → 长上下文档(阈值含边界)
check('gpt-5.6-sol 长上下文阈值生效', approx(costOf({ input: 271000, cacheRead: 1000, output: 100 }, sol, offPeakAt), (271000 * 10 + 1000 * 1.0 + 100 * 45) / 1e6))
check('gpt-5.6-sol 阈值下仍为短上下文价', approx(costOf({ input: 271999 - 1000, cacheRead: 1000, output: 0 }, sol, offPeakAt), ((271999 - 1000) * 5 + 1000 * 0.5) / 1e6))

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

// 9) 交错步骤:step1 流式 chunk → step2 chunk → step1 最终 message。
// 逐步样本表按 (turn,step) 去重,与事件交错顺序无关——step1 的最终样本
// 必须替换它自己的流式样本,而不是因为"上一个样本是 step2"就重复计费。
let s6 = proj.init()
s6 = proj.apply(s6, {
  type: 'request/header', time: offPeakAt,
  data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } } },
})
s6 = proj.apply(s6, {
  type: 'assistant/chunk', time: offPeakAt, data: { turn: 1, step: 1, chunk: { type: 'usage', usage: usageChunk } },
})
s6 = proj.apply(s6, {
  type: 'assistant/chunk', time: offPeakAt, data: { turn: 1, step: 2, chunk: { type: 'usage', usage: usage2 } },
})
s6 = proj.apply(s6, {
  type: 'assistant/message', time: offPeakAt, data: { turn: 1, step: 1, usage: usageFinal },
})
const v6 = proj.view(s6)
check('交错步骤最终样本仍替换自己的流式样本', approx(v6.cost, expectedOffPeak + costOf({ input: 2000, output: 1000, cacheRead: 0, cacheWrite: 0 }, flash, offPeakAt, eraNew)))
check('交错步骤 token 不重复计', v6.input === 3000 && v6.output === 1500)

// 10) 同 (turn,step) 换路由:chunk 时 metered,最终 message 前切到 kimi。
// 旧样本的 kind 计数必须随替换清掉,pricing 不残留 metered。
let s7 = proj.init()
s7 = proj.apply(s7, {
  type: 'request/header', time: offPeakAt,
  data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } } },
})
s7 = proj.apply(s7, {
  type: 'assistant/chunk', time: offPeakAt, data: { turn: 1, step: 1, chunk: { type: 'usage', usage: usageChunk } },
})
s7 = proj.apply(s7, {
  type: 'request/header', time: offPeakAt,
  data: { header: { config: { provider: 'kimi-coding', model: 'k3-256k' } } },
})
s7 = proj.apply(s7, {
  type: 'assistant/message', time: offPeakAt, data: { turn: 1, step: 1, usage: usageFinal },
})
const v7 = proj.view(s7)
const expectedKimiFinal = (1000 * 3.0 + 500 * 15.0 + 150 * 0.3) / 1e6
check('同 key 换路由后按新路由计费', approx(v7.cost, expectedKimiFinal))
check('被替换样本的 kind 不残留(非 mixed)', v7.pricing === 'subscription')

// 11) metered + unknown 混合:已知部分照显示,partial 标记"只是下限"
let s8 = proj.init()
s8 = proj.apply(s8, {
  type: 'request/header', time: offPeakAt,
  data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } } },
})
s8 = proj.apply(s8, {
  type: 'assistant/message', time: offPeakAt, data: { turn: 1, step: 1, usage: usageFinal },
})
s8 = proj.apply(s8, {
  type: 'request/header', time: offPeakAt,
  data: { header: { config: { provider: 'mystery', model: 'x-1' } } },
})
s8 = proj.apply(s8, {
  type: 'assistant/message', time: offPeakAt, data: { turn: 2, step: 1, usage: { inputTokens: 9999, outputTokens: 888 } },
})
const v8 = proj.view(s8)
check('metered+unknown 不再整体隐藏', v8.pricing === 'metered' && approx(v8.cost, expectedOffPeak))
check('metered+unknown 标 partial', v8.partial === true)
check('纯 unknown 不标 partial(无可显示下限)', proj.view(s3).partial === false)

// 12) 币种随 view 下发(宿主端 config 解析结果,浏览器端没有 config 通道)
const usdProj = makeSessionCostProjection(PROVIDERS, { symbol: '$', decimals: 6, rate: 1 })
const v9 = usdProj.view(usdProj.init())
check('view 携带币种', v9.currency.symbol === '$' && v9.currency.rate === 1)
check('默认币种为 CNY', proj.view(proj.init()).currency.symbol === '¥')
check('schema 接受新 view 字段', usdProj.schema.parse(v9).currency.symbol === '$')

// 13) CurrencyHolder:view 每次读当前值,在线汇率刷新随之生效
const holder = { current: { symbol: '¥', decimals: 4, rate: 7.2 } }
const holderProj = makeSessionCostProjection(PROVIDERS, holder)
check('holder 初始值入 view', holderProj.view(holderProj.init()).currency.rate === 7.2)
holder.current = { ...holder.current, rate: 6.7423 }
check('holder 更新后 view 跟随', holderProj.view(holderProj.init()).currency.rate === 6.7423)

// 14) refreshCurrencyRate:成功更新 / 失败保持 / 非 ISO 码与 USD 跳过
const fakeOk = async () => ({ ok: true, json: async () => ({ base: 'USD', rates: { CNY: 6.7 } }) })
const fakeBad = async () => ({ ok: false, json: async () => ({}) })
const fakeGarbage = async () => ({ ok: true, json: async () => ({ rates: { CNY: 'x' } }) })
const h1 = { current: { symbol: '¥', decimals: 4, rate: 7.2 } }
check('在线查询成功更新 holder', await refreshCurrencyRate(h1, 'CNY', fakeOk) === true && h1.current.rate === 6.7)
const h2 = { current: { symbol: '¥', decimals: 4, rate: 7.2 } }
check('HTTP 失败保持原值', await refreshCurrencyRate(h2, 'CNY', fakeBad) === false && h2.current.rate === 7.2)
check('垃圾数据保持原值', await refreshCurrencyRate(h2, 'CNY', fakeGarbage) === false && h2.current.rate === 7.2)
check('网络异常保持原值', await refreshCurrencyRate(h2, 'CNY', async () => { throw new Error('offline') }) === false && h2.current.rate === 7.2)
check('USD 与非 ISO 码跳过', await refreshCurrencyRate(h2, 'USD', fakeOk) === false && await refreshCurrencyRate(h2, 'custom', fakeOk) === false)

// 15) settings 命名空间 session-cost:loader config → base 文档;哨兵值回退;schema 给全缺省
check('命名空间按功能域命名', SESSION_COST_NS === 'session-cost')
const base = toBaseDoc({ currency: 'EUR', exchangeRate: 0.92 })
check('loader 币种进 base 层', base.currency === 'EUR' && base.exchangeRate === 0.92)
const baseEmpty = toBaseDoc(undefined)
check('空 config 全哨兵', baseEmpty.currency === '' && baseEmpty.exchangeRate === 0 && baseEmpty.decimals === -1 && baseEmpty.symbol === '')
const cc = currencyConfigFromDoc({ ...baseEmpty, currency: 'usd' })
check('哨兵转 undefined', cc.currency === 'usd' && cc.exchangeRate === undefined && cc.decimals === undefined && cc.symbol === undefined)
check('钉死汇率透出', currencyConfigFromDoc({ ...baseEmpty, exchangeRate: 7.5 }).exchangeRate === 7.5)
const resolved = sessionCostSettingsSchema({})
check('schema 缺省文档全哨兵', resolved.currency === '' && resolved.exchangeRate === 0 && resolved.decimals === -1 && resolved.symbol === '')

// 16) CurrencyDriver:币种字段去重(无关设置变化不重置汇率、不重发请求);
// 钉死汇率不发请求;换币种重发
const driverFetches = []
const driverHolder = { current: { symbol: '¥', decimals: 4, rate: 7.2 } }
const driver = makeCurrencyDriver(async (url) => { driverFetches.push(url); return { ok: true, json: async () => ({ rates: { CNY: 6.7, EUR: 0.85 } }) } }, driverHolder)
driver.adopt({ ...baseEmpty, currency: 'CNY' })
driver.adopt({ ...baseEmpty, currency: 'CNY' }) // 完全相同的文档
check('币种字段不变不重发', driverFetches.length === 1 && driverHolder.current.rate === 7.2) // 刷新是异步的,holder 尚未更新
for (let i = 0; i < 100 && driverHolder.current.rate !== 6.7; i++) await new Promise((r) => setTimeout(r, 5))
check('首次 adopt 触发在线刷新', driverHolder.current.rate === 6.7)
driver.adopt({ ...baseEmpty, currency: 'EUR' })
check('换币种重发请求', driverFetches.length === 2)
const pinned = makeCurrencyDriver(async () => { throw new Error('should not fetch') }, { current: { symbol: '$', decimals: 4, rate: 1 } })
pinned.adopt({ ...baseEmpty, currency: 'USD', exchangeRate: 7.5 })
check('钉死汇率不发请求且生效', pinned.pinned === true && pinned.holder.current.rate === 7.5)
check('driver code 归一化', pinned.code === 'USD')

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
