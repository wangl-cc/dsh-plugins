import { z } from "zod";
//#region src/index.ts
/**
* dsh-stats-compact host half: the `sessionCost` session projection.
*
* Replays the durable session log and bills every model call at its event
* time — but ONLY for providers with known per-token pricing. Providers are
* classified in PROVIDERS:
*  - 'metered': per-token billing (currently only deepseek-official). Every
*    metered provider owns an `eras` table: a date-ordered list of price
*    schedules, each with its own `since` (and optional `until`), peak
*    windows, and per-model prices. A price change = APPEND one era; nothing
*    existing is edited, and historical events keep billing at the era that
*    was in effect at their event time;
*  - 'subscription': flat-plan endpoints (kimi-coding, opencode-go) where the
*    per-token figure is NOT a real bill — but when the provider publishes
*    API list prices, the subscription entry carries reference `eras` so the
*    projection can estimate "what these tokens would have cost". The client
*    marks such figures with ≈ plus the plan label;
*  - anything else: 'unknown' — tokens counted, cost is 0, NEVER silently
*    billed at another provider's price sheet.
*
* TIME ZONES: era boundaries (`since`/`until`) are absolute instants (epoch
* ms or ISO strings — timezone-carrying, unambiguous). Peak windows are UTC
* hours, half-open [start, end), because isPeakHour reads getUTCHours().
* When a provider's official sheet states windows in another timezone
* (DeepSeek declares them in Beijing time), write the sheet's own hours and
* convert with toUtcWindows(windows, offsetHours) so the conversion stays
* visible next to the source numbers.
*
* The browser half prefers dsh-cost-meter's `costUsage` projection when that
* plugin is installed (multi-provider billing) and falls back to this unit.
*
* The projection itself is pure (init/apply/view), needs no ledger, and
* makes no network calls. Prices are pinned constants; a provider price
* change is one new era in PROVIDERS plus a stateVersion bump.
*/
const name = "stats-compact";
/**
* 将一个provider价目表声明的窗口换算为 UTC 窗口。
* windows 为该价目表使用的本地时区小时(半开 [start, end)),tzOffset 为
* 该时区相对 UTC 的小时偏移(如北京时间 = 8)。
*/
function toUtcWindows(windows, tzOffset) {
	return windows.map((w) => ({
		start: ((w.start - tzOffset) % 24 + 24) % 24,
		end: ((w.end - tzOffset) % 24 + 24) % 24
	}));
}
/** 时刻归一:ISO 字符串或 epoch ms → epoch ms;非法输入为 NaN。 */
function timeMs(value) {
	if (typeof value === "number") return value;
	if (typeof value === "string") return Date.parse(value);
	return NaN;
}
/**
* 按 provider 组织的计价表。新 provider 支持 = 在此加一条;某 provider
* 调价 = 在其 eras 末尾追加一个时代(since 为生效时刻):
*  - metered:eras 按 since 升序,每个时代 {since, until?, peakWindows,
*    models};models 下每个模型一档 {cacheHit, cacheMiss, output}(即该
*    时代谷时/统一价),可选 peak 细分(峰时价,缺省则峰谷同价)。
*    peakWindows 为 UTC 小时半开区间;空数组 = 该时代无峰谷(统一价)。
*  - subscription:订阅/包月端点,不按 token 产生真实账单;若官方发布了
*    API 刊例价,可带 eras 参考价表(结构与 metered 相同),cost 为
*    "这些 token 按刊例价值多少钱"的估算,客户端以 ≈ 标记展示;
*    不配 eras 则 cost 恒 0,不显示费用。
* 没有 default 回退:不认识的 provider、模型或"无时代覆盖的时刻"一律
* unknown(不计费),绝不套用别家或别时代的价表。
*/
const PROVIDERS = {
	"deepseek-official": {
		kind: "metered",
		eras: [{
			since: 0,
			until: "2026-08-16T16:00:00Z",
			peakWindows: [],
			models: {
				"deepseek-v4-flash": {
					cacheHit: .0028,
					cacheMiss: .14,
					output: .28
				},
				"deepseek-v4-pro": {
					cacheHit: .003625,
					cacheMiss: .435,
					output: .87
				}
			}
		}, {
			since: "2026-08-16T16:00:00Z",
			peakWindows: toUtcWindows([{
				start: 9,
				end: 12
			}, {
				start: 14,
				end: 18
			}], 8),
			models: {
				"deepseek-v4-flash": {
					cacheHit: .007,
					cacheMiss: .22,
					output: .66,
					peak: {
						cacheHit: .014,
						cacheMiss: .44,
						output: 1.32
					}
				},
				"deepseek-v4-pro": {
					cacheHit: .022,
					cacheMiss: .66,
					output: 1.98,
					peak: {
						cacheHit: .044,
						cacheMiss: 1.32,
						output: 3.96
					}
				}
			}
		}]
	},
	"kimi-coding": {
		kind: "subscription",
		label: "Kimi For Coding",
		eras: [{
			since: 0,
			peakWindows: [],
			models: { "k3-256k": {
				cacheHit: .3,
				cacheMiss: 3,
				output: 15
			} }
		}]
	},
	"opencode-go": {
		kind: "subscription",
		label: "opencode-go"
	}
};
/** 某一时刻是否处于峰时段。atMs 为 epoch ms;windows 为 UTC 小时半开区间。 */
function isPeakHour(atMs, windows) {
	if (!Array.isArray(windows) || windows.length === 0) return false;
	const hour = new Date(atMs).getUTCHours();
	return windows.some((w) => {
		const start = Number(w?.start);
		const end = Number(w?.end);
		if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
		if (start < end) return hour >= start && hour < end;
		return hour >= start || hour < end;
	});
}
/**
* 选一个 metered provider 在 atMs 时刻生效的时代。
* eras 按 since 升序;命中的条件是 since <= atMs < until(until 缺省为正无穷)。
* 无覆盖(如早于所有时代)返回 undefined → 调用方按 unknown 处理。
*/
function eraFor(providerEntry, atMs) {
	const eras = providerEntry.eras;
	if (!Array.isArray(eras) || eras.length === 0) return void 0;
	if (!Number.isFinite(atMs)) return void 0;
	for (let i = eras.length - 1; i >= 0; i--) {
		const era = eras[i];
		const since = timeMs(era?.since);
		const until = era?.until === void 0 ? Infinity : timeMs(era.until);
		if (Number.isFinite(since) && atMs >= since && atMs < until) return era;
	}
}
/** 按事件时刻挑选价格档:该时代峰时段内且模型有 peak 细档 → peak;否则时代基价。 */
function tierFor(entry, atMs, era = { peakWindows: [] }) {
	const base = entry ?? {
		cacheHit: 0,
		cacheMiss: 0,
		output: 0
	};
	if (isPeakHour(atMs, era.peakWindows)) {
		const p = base.peak;
		return p === void 0 ? base : p;
	}
	return base;
}
/** 一次用量的美元成本;cache read/write 按命中价,reasoning 不再计。 */
function costOf(tokens, entry, atMs, era = { peakWindows: [] }) {
	const tier = tierFor(entry, atMs, era);
	const input = Math.max(0, Number(tokens?.input) || 0);
	const output = Math.max(0, Number(tokens?.output) || 0);
	const cacheRead = Math.max(0, Number(tokens?.cacheRead) || 0);
	const cacheWrite = Math.max(0, Number(tokens?.cacheWrite) || 0);
	return Math.max(0, (input * tier.cacheMiss + output * tier.output + (cacheRead + cacheWrite) * tier.cacheHit) / 1e6);
}
/**
* 解析一路由 (provider, model) 在某一时刻的计价方式。
* metered 与带刊例价表的 subscription 都带 entry/tier,调用方据此计费
* (subscription 的金额为参考估算,不是真实账单)。不做任何回退:算不出价
* (未知 provider、未知模型、无时代覆盖)就是 unknown 或无估算,绝不套用
* 别家价表或别时代价格。
*/
function rateFor(provider, model, atMs, providers = PROVIDERS) {
	const p = provider === null ? void 0 : providers?.[provider];
	if (p === void 0) return { kind: "unknown" };
	if (p.kind === "subscription") {
		const label = p.label ?? provider;
		const era = eraFor(p, atMs);
		const entry = era !== void 0 && typeof model === "string" && model.length > 0 ? era.models?.[model] : void 0;
		if (era === void 0 || entry === void 0) return {
			kind: "subscription",
			label
		};
		return {
			kind: "subscription",
			label,
			era,
			entry,
			tier: tierFor(entry, atMs, era)
		};
	}
	if (p.kind !== "metered") return { kind: "unknown" };
	const era = eraFor(p, atMs);
	if (era === void 0) return { kind: "unknown" };
	const entry = typeof model === "string" && model.length > 0 ? era.models?.[model] : void 0;
	if (entry === void 0) return { kind: "unknown" };
	return {
		kind: "metered",
		era,
		entry,
		tier: tierFor(entry, atMs, era)
	};
}
const sessionCostSchema = z.object({
	input: z.number(),
	output: z.number(),
	cacheRead: z.number(),
	cacheWrite: z.number(),
	reasoning: z.number(),
	cost: z.number(),
	pricing: z.enum([
		"none",
		"metered",
		"subscription",
		"mixed",
		"unknown"
	])
});
/**
* sessionCost 投影工厂:按事件时刻(event.time)用当时路由、当时时代的
* 计价方式逐次计费;同一 (turn, step) 的最终样本替换流式样本(先减后加)。
* 订阅制路由按刊例价估算参考金额(无刊例价则计 0),未知路由计 0;
* view 的 pricing 字段标注构成,客户端据此渲染精确金额、≈ 估算或隐藏。
*/
function makeSessionCostProjection(providers = PROVIDERS) {
	const zeroBuckets = () => ({
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		reasoning: 0,
		cost: 0
	});
	const zeroKinds = () => ({
		metered: false,
		subscription: false,
		unknown: false
	});
	return {
		key: "sessionCost",
		schema: sessionCostSchema,
		stateVersion: 3,
		init: () => ({
			provider: null,
			model: null,
			totals: zeroBuckets(),
			kinds: zeroKinds(),
			last: null
		}),
		apply(state, event) {
			if (event.type === "request/header") {
				const model = event.data?.header?.config?.model;
				const provider = event.data?.header?.config?.provider;
				const nextModel = typeof model === "string" && model.length > 0 ? model : null;
				const nextProvider = typeof provider === "string" && provider.length > 0 ? provider : null;
				return nextModel === state.model && nextProvider === state.provider ? state : {
					...state,
					model: nextModel,
					provider: nextProvider
				};
			}
			let usage = null;
			let turn = 0;
			let step = 0;
			if (event.type === "assistant/chunk" && event.data?.chunk?.type === "usage" && event.data.chunk.usage !== void 0) {
				usage = event.data.chunk.usage;
				turn = event.data.turn ?? 0;
				step = event.data.step ?? 0;
			} else if (event.type === "assistant/message" && event.data?.usage !== void 0) {
				usage = event.data.usage;
				turn = event.data.turn ?? 0;
				step = event.data.step ?? 0;
			} else return state;
			const buckets = {
				input: usage.inputTokens ?? 0,
				output: usage.outputTokens ?? 0,
				cacheRead: usage.cacheReadTokens ?? 0,
				cacheWrite: usage.cacheWriteTokens ?? 0,
				reasoning: usage.reasoningTokens ?? 0
			};
			const key = `${turn}:${step}`;
			const prev = state.last !== null && state.last.key === key ? state.last : null;
			if (prev !== null && prev.provider === state.provider && prev.model === state.model && prev.buckets.input === buckets.input && prev.buckets.output === buckets.output && prev.buckets.cacheRead === buckets.cacheRead && prev.buckets.cacheWrite === buckets.cacheWrite && prev.buckets.reasoning === buckets.reasoning) return state;
			const atMs = Number.isFinite(Number(event.time)) && Number(event.time) > 0 ? Number(event.time) : Date.now();
			const rate = rateFor(state.provider, state.model, atMs, providers);
			const billed = rate.entry !== void 0 ? costOf(buckets, rate.entry, atMs, rate.era) : 0;
			const totals = { ...state.totals };
			const kinds = { ...state.kinds };
			const shift = (bucket, cost, sign, kind) => {
				totals.input += sign * bucket.input;
				totals.output += sign * bucket.output;
				totals.cacheRead += sign * bucket.cacheRead;
				totals.cacheWrite += sign * bucket.cacheWrite;
				totals.reasoning += sign * bucket.reasoning;
				totals.cost += sign * cost;
				if (sign > 0) kinds[kind] = true;
			};
			if (prev !== null) shift(prev.buckets, prev.cost, -1, prev.kind);
			shift(buckets, billed, 1, rate.kind);
			return {
				provider: state.provider,
				model: state.model,
				totals,
				kinds,
				last: {
					key,
					provider: state.provider,
					model: state.model,
					kind: rate.kind,
					buckets,
					cost: billed
				}
			};
		},
		view(state) {
			const kinds = state.kinds ?? zeroKinds();
			const pricing = kinds.unknown ? "unknown" : kinds.metered && kinds.subscription ? "mixed" : kinds.metered ? "metered" : kinds.subscription ? "subscription" : "none";
			return {
				...state.totals,
				pricing
			};
		}
	};
}
/** 注册投影;无 sessionProjections 的装配(如 headless)不受影响。 */
function apply(ctx) {
	ctx.inject(["sessionProjections"], (projectionCtx) => {
		projectionCtx.sessionProjections?.register(makeSessionCostProjection());
	});
}
//#endregion
export { PROVIDERS, apply, costOf, eraFor, isPeakHour, makeSessionCostProjection, name, rateFor, tierFor, toUtcWindows };
