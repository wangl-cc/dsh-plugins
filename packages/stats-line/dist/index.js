import { z } from "zod";
import Schema from "@deepseek-ai/schemastery";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
//#region src/format.ts
const ITEM_KINDS = [
	"counts",
	"llm",
	"tools",
	"ttft",
	"tps",
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
makeItem("counts"), makeItem("sep", { size: "big" }), makeItem("llm"), makeItem("sep"), makeItem("tools"), makeItem("sep", { size: "big" }), makeItem("ttft"), makeItem("sep"), makeItem("tps"), makeItem("sep", { size: "big" }), makeItem("tokens"), makeItem("sep", { size: "big" }), makeItem("cost");
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
//#endregion
//#region src/index.ts
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
const name = "stats-line";
const uiConfigSchema = z.object({
	items: z.array(z.unknown()),
	css: z.string()
}).partial();
/** 非法 ui 配置整体回退为空(全默认),不半个生效;数组简写归一为对象;item 逐个防御性归一化。 */
function parseUiConfig(raw) {
	const input = z.union([z.array(z.unknown()), uiConfigSchema]).safeParse(raw ?? {});
	if (!input.success) return {};
	const items = (Array.isArray(input.data) ? input.data : input.data.items)?.map(normalizeItem).filter((item) => item !== void 0);
	const css = Array.isArray(input.data) ? void 0 : input.data.css;
	return {
		...items !== void 0 && items.length > 0 ? { items } : {},
		...typeof css === "string" && css !== "" ? { css } : {}
	};
}
/** settings 命名空间:按用户面对的功能域命名,不用包名。 */
const STATS_LINE_NS = "stats-line";
const itemSchema = Schema.object({
	kind: Schema.union([...ITEM_KINDS]).default("custom"),
	size: Schema.union(["small", "big"]).default("small"),
	template: Schema.string().default("")
});
/** settings schema:每个字段都有默认值,缺省文档即全哨兵。 */
const statsLineSettingsSchema = Schema.object({
	items: Schema.array(itemSchema).default([]),
	css: Schema.string().default("")
});
/** loader 行 config → base 层文档(ui 块拍平)。 */
function toBaseDoc(config) {
	const ui = parseUiConfig(config?.ui);
	return {
		items: ui.items ?? [],
		css: ui.css ?? ""
	};
}
/**
* 挂载 settings 命名空间 stats-line:组件序列与自定义 css 的有效值来自
* "schema 默认 < loader config(base)< 用户层"的合成。存量 settings.yaml
* 段落非法时 register 抛错——捕获后回退 base 层,GUI 卡片因命名空间未
* serve 而自动隐藏。
*/
function apply(ctx, config) {
	const base = toBaseDoc(config);
	ctx.inject(["settings"], (settingsCtx) => {
		const settings = settingsCtx.settings;
		if (settings === void 0) return;
		try {
			settings.register(settingsNamespace(STATS_LINE_NS), statsLineSettingsSchema, { base });
		} catch {}
	});
}
//#endregion
export { STATS_LINE_NS, apply, name, parseUiConfig, statsLineSettingsSchema, toBaseDoc };
