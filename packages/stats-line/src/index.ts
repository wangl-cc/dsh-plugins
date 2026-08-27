/**
 * dsh-stats-line host half: the `stats-line` settings namespace.
 *
 * 声明式 stats line 定制:行 = 小组(sections)数组;小组 = { sep?,
 * components },小组间固定 '|',小组内默认 '·';组件 = 模板字符串(或
 * { show, hint? }),串内 $name 插值、$$ 转义。ref 无值 → 组件消失;
 * 小组全空 → 整组消失;连接符渲染时按层级生成。模型与迁移见 format.ts。
 *
 * 本包只有配置面;渲染在 client 半,会话费用值(cost)来自 `sessionCost`
 * 投影的 display 字段(dsh-session-cost,按 key 消费,无代码依赖;未安装
 * 时 $cost 不可解析,引用它的组件自动不渲染)。币种与 ≈ 规则归
 * session-cost 自己的命名空间。
 */

import { z } from 'zod'
import Schema from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { migrateLegacyItems, type StatsLineSection } from './format'

export const name = 'stats-line'

/** loader 行 config 全形:仅 ui 块(旧 items 形态,经迁移进 base 层)。 */
export interface StatsCompactConfig {
  ui?: unknown
}

/** settings 命名空间:按用户面对的功能域命名,不用包名。 */
export const STATS_LINE_NS = 'stats-line'

/** 命名空间解析后的完整文档;空数组/空串哨兵表示"未设置"。 */
export interface StatsLineDoc {
  sections: StatsLineSection[]
  style: {
    fontSize: string
    color: string
    fontFamily: string
    gap: string
    sectionGap: string
  }
}

const componentSchema = Schema.union([
  Schema.string(),
  Schema.object({
    show: Schema.string(),
    hint: Schema.string().default(''),
  }),
])

const sectionSchema = Schema.object({
  // 缺省 '·';显式 '' = 组件贴死(如 tokens 小组)。
  sep: Schema.string().default('·'),
  components: Schema.array(componentSchema).default([]),
})

/** settings schema:每个字段都有默认值,缺省文档即全哨兵。 */
export const statsLineSettingsSchema = Schema.object({
  sections: Schema.array(sectionSchema).default([]),
  style: Schema.object({
    fontSize: Schema.string().default(''),
    color: Schema.string().default(''),
    fontFamily: Schema.string().default(''),
    gap: Schema.string().default(''),
    sectionGap: Schema.string().default(''),
  }).default({ fontSize: '', color: '', fontFamily: '', gap: '', sectionGap: '' }),
})

/**
 * loader 行 config → base 层文档。旧 ui.items(kind/sep/custom)经
 * migrateLegacyItems 展开为新 sections;ui.css 已废弃,忽略。
 * 非法输入整体回退为空(全默认),不半个生效。
 */
export function toBaseDoc(config?: StatsCompactConfig): StatsLineDoc {
  const raw = config?.ui
  const legacy = Array.isArray(raw) ? raw : typeof raw === 'object' && raw !== null && Array.isArray((raw as Record<string, unknown>).items) ? ((raw as Record<string, unknown>).items as unknown[]) : []
  return {
    sections: migrateLegacyItems(legacy),
    style: { fontSize: '', color: '', fontFamily: '', gap: '', sectionGap: '' },
  }
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
 * 挂载 settings 命名空间 stats-line:sections 与 style 的有效值来自
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
