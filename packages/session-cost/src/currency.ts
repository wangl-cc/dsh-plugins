// ── 币种解析(loader config / settings 文档 → 显示币种) ──────────────────

export interface Currency {
  symbol: string
  decimals: number
  rate: number
}

/** 内置汇率表:在线查询失败时的兜底(2026-08 参考值,会随时间漂移)。 */
export const CURRENCY_PRESETS: Record<string, Currency> = {
  CNY: { symbol: '¥', decimals: 4, rate: 7.2 },
  USD: { symbol: '$', decimals: 6, rate: 1 },
  EUR: { symbol: '€', decimals: 6, rate: 0.92 },
}

/**
 * loader 行 config 的形状(仅宿主侧可得;浏览器端启动图不携带 config)。
 * currency 为 ISO 4217 币种码;exchangeRate 是显式覆盖(钉死/离线用),
 * 缺省时宿主端在线查询,内置表兜底。
 */
export interface PluginConfig {
  currency?: string
  exchangeRate?: number
  decimals?: number
  symbol?: string
}

/** 币种码归一:缺省 CNY,大写 ISO 4217;非三字母码原样返回(查 preset 用)。 */
export function currencyCode(config: PluginConfig | undefined): string {
  const raw = typeof config?.currency === 'string' && config.currency.length > 0 ? config.currency : 'CNY'
  return /^[a-zA-Z]{3}$/.test(raw) ? raw.toUpperCase() : raw
}

/** 解析币种设置(缺省 CNY;rate 为内置表或显式覆盖,在线刷新由宿主端负责)。 */
export function resolveCurrency(config: PluginConfig | undefined): Currency {
  const kind = currencyCode(config)
  const preset = CURRENCY_PRESETS[kind] ?? { symbol: '$', decimals: 2, rate: 1 }
  const rate = Number(config?.exchangeRate)
  const decimals = Number(config?.decimals)
  return {
    symbol: typeof config?.symbol === 'string' && config.symbol.length > 0 ? config.symbol : preset.symbol,
    rate: Number.isFinite(rate) && rate > 0 ? rate : preset.rate,
    decimals: Math.max(0, Math.min(10, Math.floor(Number.isFinite(decimals) ? decimals : preset.decimals))),
  }
}

/** 美元成本 × 汇率,按币种格式化;数值过小时自动放宽小数位。 */
export function formatMoney(usdCost: number, currency: Currency): string {
  const value = usdCost * (currency.rate > 0 ? currency.rate : 1)
  let effective = currency.decimals
  if (value > 0 && value < Math.pow(10, -effective)) effective = effective + 2
  const fixed = value.toFixed(effective)
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
  return currency.symbol + trimmed
}
