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
/** 紧凑 token 计数:517 / 12.2K / 517K / 1.2M。 */
function formatTokens(n) {
	const scaled = (v) => v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
	if (n < 1e3) return String(n);
	if (n < 1e6) return `${scaled(n / 1e3)}K`;
	return `${scaled(n / 1e6)}M`;
}
/** 紧凑时长:45.2s(<1 分钟)/ 2m42s。 */
function formatDuration(ms) {
	const s = ms / 1e3;
	if (s < 60) return `${Math.round(s * 10) / 10}s`;
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
/** 解析币种设置(缺省 CNY)。 */
function resolveCurrency(config) {
	const kind = typeof config?.currency === "string" && config.currency.length > 0 ? config.currency : "CNY";
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
//#endregion
export { CURRENCY_PRESETS, assistantStepReading, billedInputTokens, cacheHitPercent, deriveStats, formatDuration, formatMoney, formatTokens, formatTokensPerSecond, resolveCurrency, usageOutputTokens };
