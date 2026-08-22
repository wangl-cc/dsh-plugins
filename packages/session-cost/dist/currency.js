//#region src/currency.ts
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
//#endregion
export { CURRENCY_PRESETS, currencyCode, resolveCurrency };
