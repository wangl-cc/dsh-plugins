/**
 * dsh-stats-line host half: the `stats-line` settings namespace.
 *
 * 声明式 stats line 定制:组件序列(items)——内置数据组件(counts/llm/
 * tools/ttft/tps/tokens/cost)、分隔符(sep:small '·' / big '|')与自定义
 * 模板组件(custom,'{placeholder}' 插值,占位符词表见 format.ts)。数据
 * 不可得的组件不渲染,分隔符自动收敛。
 *
 * 本包只有配置面;渲染在 client 半,会话费用数据来自 `sessionCost` 投影
 * (dsh-session-cost,按 key 消费,无代码依赖;未安装时 cost 组件自动不
 * 渲染)。币种配置在 session-cost 自己的命名空间里。
 */

import { z } from 'zod'
import Schema from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { ITEM_KINDS, normalizeItem, type StatsLineItem } from './format'

export const name = 'stats-line'

/** loader 行 config 全形:仅 ui 块。 */
export interface StatsCompactConfig {
  ui?: unknown
}

/** ui 块:组件序列 + 自定义 css。 */
export interface UiConfig {
  items?: StatsLineItem[]
  css?: string
}

const uiConfigSchema = z
  .object({
    items: z.array(z.unknown()),
    css: z.string(),
  })
  .partial()

/** 非法 ui 配置整体回退为空(全默认),不半个生效;数组简写归一为对象;item 逐个防御性归一化。 */
export function parseUiConfig(raw: unknown): UiConfig {
  const input = z.union([z.array(z.unknown()), uiConfigSchema]).safeParse(raw ?? {})
  if (!input.success) return {}
  const items = (Array.isArray(input.data) ? input.data : input.data.items)?.map(normalizeItem).filter((item): item is StatsLineItem => item !== undefined)
  const css = Array.isArray(input.data) ? undefined : input.data.css
  return { ...(items !== undefined && items.length > 0 ? { items } : {}), ...(typeof css === 'string' && css !== '' ? { css } : {}) }
}

/** settings 命名空间:按用户面对的功能域命名,不用包名。 */
export const STATS_LINE_NS = 'stats-line'

/** 命名空间解析后的完整文档;哨兵值('')表示"未设置"。 */
export interface StatsLineDoc {
  items: StatsLineItem[]
  css: string
}

const itemSchema = Schema.object({
  kind: Schema.union([...ITEM_KINDS]).default('custom'),
  size: Schema.union(['small', 'big']).default('small'),
  template: Schema.string().default(''),
})

/** settings schema:每个字段都有默认值,缺省文档即全哨兵。 */
export const statsLineSettingsSchema = Schema.object({
  items: Schema.array(itemSchema).default([]),
  css: Schema.string().default(''),
})

/** loader 行 config → base 层文档(ui 块拍平)。 */
export function toBaseDoc(config?: StatsCompactConfig): StatsLineDoc {
  const ui = parseUiConfig(config?.ui)
  return { items: ui.items ?? [], css: ui.css ?? '' }
}

// ── 宿主端插件入口 ─────────────────────────────────────────────────────

/** Cordis context 的最小面(settings 服务 + inject)。 */
export interface CordisContext {
  inject(deps: string[], callback: (ctx: CordisContext) => void): void
  settings?: {
    register: (ns: unknown, schema: unknown, opts: { base: unknown }) => unknown
  }
}

/**
 * 挂载 settings 命名空间 stats-line:组件序列与自定义 css 的有效值来自
 * "schema 默认 < loader config(base)< 用户层"的合成。存量 settings.yaml
 * 段落非法时 register 抛错——捕获后回退 base 层,GUI 卡片因命名空间未
 * serve 而自动隐藏。
 */
export function apply(ctx: CordisContext, config?: StatsCompactConfig): void {
  const base = toBaseDoc(config)
  ctx.inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx.settings
    if (settings === undefined) return
    try {
      settings.register(settingsNamespace(STATS_LINE_NS), statsLineSettingsSchema, { base })
    } catch {
      // 存量段落非法:回退 base,GUI 卡片因命名空间未 serve 而自动隐藏
    }
  })
}
