//#region src/format.ts
function usageOutputTokens(usage) {
	if (typeof usage !== "object" || usage === null) return null;
	const value = usage.outputTokens;
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
function assistantStepReading(node) {
	const timing = node.timing;
	return {
		ttftMs: timing !== void 0 && timing.stepStartTime !== null && timing.firstTokenTime !== null ? Math.max(0, timing.firstTokenTime - timing.stepStartTime) : null,
		decodeMs: timing !== void 0 && timing.firstTokenTime !== null ? Math.max(0, timing.completedTime - timing.firstTokenTime) : null,
		outputTokens: usageOutputTokens(node.usage)
	};
}
/** 窗口内折叠:投影缺失时的回退,字段名与 sessionStats 投影一致。 */
function deriveStats(nodes) {
	const turns = /* @__PURE__ */ new Set();
	let steps = 0;
	let llmMs = 0;
	let toolMs = 0;
	let ttftMs = 0;
	let ttftSteps = 0;
	let decodeMs = 0;
	let decodeTokens = 0;
	for (const node of nodes) {
		if (node.kind === "tool-result") {
			if (node.callTime !== null && node.callTime !== void 0) toolMs += Math.max(0, node.time - node.callTime);
			continue;
		}
		if (node.kind !== "assistant") continue;
		turns.add(node.turn ?? 0);
		steps += 1;
		if (node.timing !== void 0 && node.timing.stepStartTime !== null) llmMs += Math.max(0, node.timing.completedTime - node.timing.stepStartTime);
		const reading = assistantStepReading(node);
		if (reading.ttftMs !== null) {
			ttftMs += reading.ttftMs;
			ttftSteps += 1;
		}
		if (reading.decodeMs !== null && reading.outputTokens !== null) {
			decodeMs += reading.decodeMs;
			decodeTokens += reading.outputTokens;
		}
	}
	return {
		turns: turns.size,
		steps,
		llmMs,
		toolMs,
		ttftMs,
		ttftSteps,
		decodeMs,
		decodeTokens
	};
}
function lastStepReading(nodes) {
	let lastTurn;
	let firstStep = Number.POSITIVE_INFINITY;
	let ttftMs = null;
	let decodeMs = 0;
	let outputTokens = 0;
	let sampled = false;
	for (let i = nodes.length - 1; i >= 0; i--) {
		const node = nodes[i];
		if (node === void 0 || node.kind !== "assistant") continue;
		const turn = node.turn ?? 0;
		if (lastTurn === void 0) lastTurn = turn;
		if (turn !== lastTurn) break;
		const reading = assistantStepReading(node);
		const step = node.step ?? 0;
		if (step < firstStep) {
			firstStep = step;
			ttftMs = reading.ttftMs;
		}
		if (reading.decodeMs !== null && reading.outputTokens !== null) {
			decodeMs += reading.decodeMs;
			outputTokens += reading.outputTokens;
			sampled = true;
		}
	}
	if (lastTurn === void 0) return void 0;
	return {
		ttftMs,
		decodeMs: sampled ? decodeMs : null,
		outputTokens: sampled ? outputTokens : null
	};
}
/** 紧凑 token 计数:517 / 12.2K / 517K / 1.2M。 */
function formatTokens(n) {
	const scaled = (v) => v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
	if (n < 1e3) return String(n);
	if (n < 1e6) return `${scaled(n / 1e3)}K`;
	return `${scaled(n / 1e6)}M`;
}
/** 紧凑时长:45.2s(<1 分钟)/ 2m42s;秒档舍入到 60 时升入分钟档。 */
function formatDuration(ms) {
	const s = ms / 1e3;
	const tenth = Math.round(s * 10) / 10;
	if (tenth < 60) return `${tenth}s`;
	const whole = Math.round(s);
	return `${Math.floor(whole / 60)}m${whole % 60}s`;
}
function formatTokensPerSecond(tps) {
	const clamped = Math.max(0, tps);
	return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10);
}
/** prompt 侧三个计费桶之和。 */
function billedInputTokens(usage) {
	return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}
/** 缓存命中占比(取整);无输入计费时返回 null。 */
function cacheHitPercent(usage) {
	const denominator = billedInputTokens(usage);
	return denominator === 0 ? null : Math.round(usage.cacheReadTokens / denominator * 100);
}
/** 内置汇率表:在线查询失败时的兜底(2026-08 参考值,会随时间漂移)。 */
const CURRENCY_PRESETS = {
	CNY: {
		symbol: "¥",
		decimals: 4,
		rate: 7.2
	},
	USD: {
		symbol: "$",
		decimals: 6,
		rate: 1
	},
	EUR: {
		symbol: "€",
		decimals: 6,
		rate: .92
	}
};
/** 币种码归一:缺省 CNY,大写 ISO 4217;非三字母码原样返回(查 preset 用)。 */
function currencyCode(config) {
	const raw = typeof config?.currency === "string" && config.currency.length > 0 ? config.currency : "CNY";
	return /^[a-zA-Z]{3}$/.test(raw) ? raw.toUpperCase() : raw;
}
/** 解析币种设置(缺省 CNY;rate 为内置表或显式覆盖,在线刷新由宿主端负责)。 */
function resolveCurrency(config) {
	const kind = currencyCode(config);
	const preset = CURRENCY_PRESETS[kind] ?? {
		symbol: "$",
		decimals: 2,
		rate: 1
	};
	const rate = Number(config?.exchangeRate);
	const decimals = Number(config?.decimals);
	return {
		symbol: typeof config?.symbol === "string" && config.symbol.length > 0 ? config.symbol : preset.symbol,
		rate: Number.isFinite(rate) && rate > 0 ? rate : preset.rate,
		decimals: Math.max(0, Math.min(10, Math.floor(Number.isFinite(decimals) ? decimals : preset.decimals)))
	};
}
/** 美元成本 × 汇率,按币种格式化;数值过小时自动放宽小数位。 */
function formatMoney(usdCost, currency) {
	const value = usdCost * (currency.rate > 0 ? currency.rate : 1);
	let effective = currency.decimals;
	if (value > 0 && value < Math.pow(10, -effective)) effective = effective + 2;
	const fixed = value.toFixed(effective);
	const trimmed = fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
	return currency.symbol + trimmed;
}
/** 模板插值:'{a} x {b}' + {a:1,b:2} → '1 x 2';未知占位符原样保留。 */
function interpolate(template, params) {
	return template.replace(/\{(\w+)\}/g, (match, key) => key in params ? String(params[key]) : match);
}
/**
* 渲染声明式模板(stats line 自定义组件):'{name}' 占位符取自
* values(值是预格式化的显示串);引用了缺失值(undefined)的模板返回
* undefined——这就是声明式的条件显隐;值为空串的占位符(如 {cache})照常渲染。
*/
function renderTemplate(template, values) {
	if ((template.match(/\{(\w+)\}/g) ?? []).some((ref) => values[ref.slice(1, -1)] === void 0)) return void 0;
	return interpolate(template, values);
}
const ITEM_KINDS = [
	"counts",
	"llm",
	"tools",
	"ttft",
	"tps",
	"ttftLast",
	"tpsLast",
	"tokens",
	"cost",
	"sep",
	"custom"
];
function makeItem(kind, init) {
	return {
		kind,
		size: "small",
		template: "",
		...init
	};
}
/** 内置默认序列:大组间 '|',组内子项 '·'——与历史内置渲染视觉一致。 */
const DEFAULT_STATS_LINE_ITEMS = [
	makeItem("counts"),
	makeItem("sep", { size: "big" }),
	makeItem("llm"),
	makeItem("sep"),
	makeItem("tools"),
	makeItem("sep", { size: "big" }),
	makeItem("ttft"),
	makeItem("sep"),
	makeItem("tps"),
	makeItem("sep", { size: "big" }),
	makeItem("tokens"),
	makeItem("sep", { size: "big" }),
	makeItem("cost")
];
/** 防御性归一化任意 JSON 为组件项;非法输入返回 undefined(调用方过滤)。 */
function normalizeItem(raw) {
	if (typeof raw !== "object" || raw === null) return void 0;
	const r = raw;
	if (typeof r.kind !== "string" || !ITEM_KINDS.includes(r.kind)) return void 0;
	return {
		kind: r.kind,
		size: r.size === "big" ? "big" : "small",
		template: typeof r.template === "string" ? r.template : ""
	};
}
/**
* 组件序列 → 渲染片段。数据不可得的组件(parts 无此键)与引用缺失值的
* 自定义模板直接消失;分隔符随后收敛:边缘分隔符删除,相邻分隔符留大的。
*/
function renderStatsLineItems(items, parts, values) {
	const pieces = [];
	for (const item of items) {
		if (item.kind === "sep") {
			pieces.push({
				type: "sep",
				size: item.size
			});
			continue;
		}
		const text = item.kind === "custom" ? item.template.trim() === "" ? void 0 : renderTemplate(item.template, values) : parts[item.kind];
		if (text !== void 0) pieces.push({
			type: "text",
			text
		});
	}
	const out = [];
	for (const piece of pieces) {
		const last = out[out.length - 1];
		if (piece.type === "sep") {
			if (last === void 0) continue;
			if (last.type === "sep") {
				if (piece.size === "big") out[out.length - 1] = piece;
				continue;
			}
		}
		out.push(piece);
	}
	while (out.length > 0 && out[out.length - 1].type === "sep") out.pop();
	return out;
}
//#endregion
export { CURRENCY_PRESETS, DEFAULT_STATS_LINE_ITEMS, ITEM_KINDS, assistantStepReading, billedInputTokens, cacheHitPercent, currencyCode, deriveStats, formatDuration, formatMoney, formatTokens, formatTokensPerSecond, interpolate, lastStepReading, makeItem, normalizeItem, renderStatsLineItems, renderTemplate, resolveCurrency, usageOutputTokens };
