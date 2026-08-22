window.__ModuleLoader__.load({
	id: "dsh-stats-line",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
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
		//#region src/client.ts
		/**
		* dsh-stats-line 浏览器端:紧凑 stats line 组件。
		*
		* 构建时被 rolldown 包装成 __ModuleLoader__ 工厂格式(见 rolldown.config.js
		* 的 banner/footer),react 与 ./format 之外无依赖;运行时由 dsh-client-modules
		* 以 classic script 加载。
		*
		* 替换官方 stats line(conversation.composer.dock 的 id:"stats" 条目):
		* 以 priority:-1 注册同 id 条目完成 cell shadowing(最低 priority 渲染;
		* 本组件崩溃时 abdicate,官方条目自动接管作为回退)。
		*
		* 数据源与官方 StatsLine 完全一致:
		*  - sessionStats / tokenUsage 投影(优先);
		*  - 窗口内节点折叠(投影缺失时的回退,共享自 ./format)。
		*
		* 差异:文案更紧凑(轮/步、工具、TTFT、↑↓),布局 flex-wrap 可换行,
		* 不再单行截断丢内容;行尾追加本会话费用(宿主 sessionCost 投影,
		* 装了 dsh-cost-meter 时自动优先用其 costUsage 投影)。费用按投影的
		* pricing 标记渲染:metered 精确金额;mixed / 有刊例价的 subscription
		* 加 ≈(唯一标记,不再叠加订阅标签);unknown/none/无刊例价订阅隐藏。
		*/
		const h = react.createElement;
		const NS = "stats-compact";
		/** settings 命名空间:按用户面对的功能域命名,不用包名。 */
		const STATS_LINE_NS = "stats-line";
		const css = [
			"/* dsh-stats-line: 紧凑 stats line */",
			".csl-root{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:2px 0;box-sizing:border-box;width:100%;max-width:var(--dsh-chat-content-width,748px);margin:0 auto;padding:4px calc(var(--dsh-composer-side-clearance,16px) + 16px) 0;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}",
			".csl-item{display:inline-flex;align-items:baseline;white-space:nowrap;font-variant-numeric:tabular-nums}",
			".csl-sep{color:var(--dsw-alias-separator-primary);margin:0 6px}",
			".csl-sepsm{color:var(--dsw-alias-separator-primary);margin:0 4px}",
			"/* 设置卡片(settings.plugin.item):复刻平台 PluginCard/ValueField 视觉契约 */",
			".slc-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}",
			".slc-card:hover{border-color:var(--dsw-alias-label-dimmed)}",
			".slc-card.slc-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}",
			".slc-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}",
			".slc-headtext{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}",
			".slc-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}",
			".slc-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}",
			".slc-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}",
			".slc-open .slc-chevron{transform:rotate(180deg)}",
			".slc-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}",
			".slc-field{flex-direction:column;gap:6px;padding:12px 0;display:flex}",
			".slc-field+.slc-field{border-top:1px solid var(--dsw-alias-border-l2)}",
			".slc-label{min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5}",
			".slc-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}",
			".slc-row{display:flex;gap:8px;align-items:center}",
			".slc-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5;box-sizing:border-box}",
			".slc-row .slc-input{flex:1;min-width:0}",
			".slc-field .slc-input{width:100%}",
			".slc-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}",
			".slc-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}",
			".slc-btn{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5;flex:none}",
			".slc-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary)}",
			".slc-btn:disabled{cursor:default;opacity:.4}",
			".slc-add{align-self:flex-start;appearance:none;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}",
			".slc-add:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}",
			".slc-add:disabled{opacity:.4;cursor:default}",
			".slc-pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}",
			".slc-footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}",
			".slc-discard,.slc-save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}",
			".slc-discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}",
			".slc-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}",
			".slc-save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}",
			".slc-discard:disabled,.slc-save:disabled{opacity:.4;cursor:default}",
			".slc-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}",
			".slc-grip{color:var(--dsw-alias-label-tertiary);cursor:grab;user-select:none;flex:none;padding:0 2px;font-size:13px;line-height:1}",
			".slc-row.slc-dragging{opacity:.45}",
			".slc-chip{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:5px 10px;font-size:12px;line-height:1.5;flex:none}",
			".slc-chip:disabled{cursor:default;opacity:.6}",
			".slc-itemname{color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;flex:1;min-width:0;padding:5px 0}",
			".slc-preview{border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;padding:8px 12px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;word-break:break-all}",
			".slc-advanced{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 12px}",
			".slc-advancedsummary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:500;padding:10px 0;user-select:none}",
			".slc-advanced[open] .slc-advancedsummary{border-bottom:1px solid var(--dsw-alias-border-l2)}"
		].join("\n");
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"dsh-stats-line\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-stats-line";
			tag.dataset.pluginCss = "dsh-stats-line";
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		const zh = {
			counts: "{turns} 轮 · {steps} 步",
			llm: "LLM {d}",
			tools: "工具 {d}",
			ttft: "TTFT {d}",
			tps: "{tps} tok/s",
			tokens: "↑{in}{suffix} ↓{out}",
			cacheSuffix: "({p}%)",
			estimated: "≈",
			cardItems: "组件序列",
			cardItemsHint: "按住 ⠿ 拖拽排序;点 ·/| 切换分隔符大小;费用组件的币种设置在 session-cost 卡片里。自定义组件用 {placeholder} 插值:{turns} {steps} {llm} {tools} {ttft} {tps} {input} {output} {cache} {cost};引用缺失数据的组件不渲染;清空恢复默认。",
			cardAdd: "添加:",
			compCounts: "计数",
			compLlm: "LLM 时长",
			compTools: "工具时长",
			compTtft: "TTFT",
			compTps: "吐字速度",
			compTokens: "Token 用量",
			compCost: "费用",
			compSepSmall: "小分隔符",
			compSepBig: "大分隔符",
			compCustom: "自定义",
			cardCustomPlaceholder: "{turns} 轮 · {steps} 步 …",
			cardDragHandle: "按住拖拽排序",
			cardSepToggle: "点击切换大小",
			cardRemove: "删除",
			cardCss: "附加 CSS",
			cardTitle: "Stats line",
			cardDescription: "紧凑统计行的组件编排。",
			cardUnsaved: "未保存",
			cardDiscard: "放弃",
			cardSave: "保存",
			cardPreview: "预览(示例数据)",
			cardAdvanced: "高级",
			cardStartFromDefaults: "从默认组件开始"
		};
		const en = {
			counts: "{turns} turns · {steps} steps",
			llm: "LLM {d}",
			tools: "Tools {d}",
			ttft: "TTFT {d}",
			tps: "{tps} tok/s",
			tokens: "↑{in} {suffix} ↓{out}",
			cacheSuffix: "({p}%)",
			estimated: "≈",
			cardItems: "Components",
			cardItemsHint: "Hold ⠿ to drag and reorder; click ·/| to toggle separator size; currency settings for the cost component live in the session-cost card. Custom components interpolate {placeholders}: {turns} {steps} {llm} {tools} {ttft} {tps} {input} {output} {cache} {cost}; components referencing unavailable data are not rendered; clear all to restore defaults.",
			cardAdd: "Add:",
			compCounts: "Counts",
			compLlm: "LLM time",
			compTools: "Tool time",
			compTtft: "TTFT",
			compTps: "Speed",
			compTokens: "Tokens",
			compCost: "Cost",
			compSepSmall: "Small sep",
			compSepBig: "Big sep",
			compCustom: "Custom",
			cardCustomPlaceholder: "{turns} turns · {steps} steps …",
			cardDragHandle: "Drag to reorder",
			cardSepToggle: "Click to toggle size",
			cardRemove: "Remove",
			cardCss: "Extra CSS",
			cardTitle: "Stats line",
			cardDescription: "Component composition of the compact stats line.",
			cardUnsaved: "Unsaved",
			cardDiscard: "Discard",
			cardSave: "Save",
			cardPreview: "Preview (sample data)",
			cardAdvanced: "Advanced",
			cardStartFromDefaults: "Start from defaults"
		};
		let settingsController;
		/** useSyncExternalStore 适配器:整个 snapshot(value + writable)。 */
		const settingsStore = {
			subscribe: (listener) => settingsController?.subscribe(listener) ?? (() => {}),
			getSnapshot: () => settingsController?.getSnapshot()
		};
		/** 防御性提取 UI 配置:空序列/空串转 undefined(= 内置默认);item 逐个归一化,非法的丢弃。 */
		function uiFromDoc(doc) {
			if (typeof doc !== "object" || doc === null) return {};
			const d = doc;
			const ui = {};
			if (Array.isArray(d.items)) {
				const items = d.items.map(normalizeItem).filter((item) => item !== void 0);
				if (items.length > 0) ui.items = items;
			}
			if (typeof d.css === "string" && d.css !== "") ui.css = d.css;
			return ui;
		}
		let CURRENCY = resolveCurrency(void 0);
		/** 防御性校验投影下发的币种;形状不对就用本地缺省。 */
		function validCurrency(value) {
			if (typeof value !== "object" || value === null) return void 0;
			if (typeof value.symbol !== "string" || value.symbol.length === 0) return void 0;
			if (typeof value.rate !== "number" || !Number.isFinite(value.rate) || value.rate <= 0) return void 0;
			if (typeof value.decimals !== "number" || !Number.isFinite(value.decimals)) return void 0;
			return value;
		}
		/** 组件文本(parts)+ 自定义模板占位符词表(values);cell 渲染与设置卡片预览共用同一份逻辑。 */
		function buildValues(stats, usage, sessionCost, costUsage, currency, t) {
			const parts = {};
			const values = {};
			if (stats !== void 0 && stats.steps > 0) {
				parts.counts = t("counts", {
					turns: stats.turns,
					steps: stats.steps
				});
				values.turns = String(stats.turns);
				values.steps = String(stats.steps);
				if (stats.llmMs > 0) {
					parts.llm = t("llm", { d: formatDuration(stats.llmMs) });
					values.llm = formatDuration(stats.llmMs);
				}
				if (stats.toolMs > 0) {
					parts.tools = t("tools", { d: formatDuration(stats.toolMs) });
					values.tools = formatDuration(stats.toolMs);
				}
				if (stats.ttftSteps > 0) {
					parts.ttft = t("ttft", { d: formatDuration(stats.ttftMs / stats.ttftSteps) });
					values.ttft = formatDuration(stats.ttftMs / stats.ttftSteps);
				}
				if (stats.decodeMs > 0) {
					parts.tps = t("tps", { tps: formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1e3)) });
					values.tps = formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1e3));
				}
			}
			if (usage !== void 0 && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)) {
				const cache = cacheHitPercent(usage);
				const suffix = cache !== null ? t("cacheSuffix", { p: cache }) : "";
				parts.tokens = t("tokens", {
					in: formatTokens(billedInputTokens(usage)),
					suffix,
					out: formatTokens(usage.outputTokens)
				});
				values.input = formatTokens(billedInputTokens(usage));
				values.output = formatTokens(usage.outputTokens);
				values.cache = suffix;
			}
			const costUsageCost = typeof costUsage?.cost === "number" && costUsage.cost > 0 ? costUsage.cost : null;
			if (costUsageCost !== null) parts.cost = formatMoney(costUsageCost, currency);
			else if (sessionCost !== void 0) {
				const pricing = sessionCost.pricing;
				const cost = typeof sessionCost.cost === "number" ? sessionCost.cost : 0;
				const approximate = pricing === "mixed" || pricing === "subscription" || sessionCost.partial === true;
				if ((pricing === "metered" || pricing === "mixed" || pricing === "subscription") && cost > 0) parts.cost = (approximate ? t("estimated") : "") + formatMoney(cost, currency);
			}
			values.cost = parts.cost;
			return {
				parts,
				values
			};
		}
		function CompactStatsLine(props) {
			const useSession = props.useSession;
			const useProjection = props.useProjection;
			const t = props.t;
			const settledNodes = useSession !== void 0 ? useSession((s) => s.chat.legacy.nodes) : void 0;
			const usage = useProjection !== void 0 ? useProjection("tokenUsage") : void 0;
			const projected = useProjection !== void 0 ? useProjection("sessionStats") : void 0;
			const costUsage = useProjection !== void 0 ? useProjection("costUsage") : void 0;
			const sessionCost = useProjection !== void 0 ? useProjection("sessionCost") : void 0;
			const ui = uiFromDoc(react.useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot)?.value);
			const { parts, values } = buildValues(projected ?? (settledNodes !== void 0 ? deriveStats(settledNodes) : void 0), usage, sessionCost, costUsage, validCurrency(sessionCost?.currency) ?? CURRENCY, t);
			const pieces = renderStatsLineItems(ui.items ?? DEFAULT_STATS_LINE_ITEMS, parts, values);
			const css = ui.css ?? null;
			if (pieces.length === 0 && css === null) return null;
			const children = pieces.map((piece, i) => piece.type === "sep" ? h("span", {
				className: piece.size === "big" ? "csl-sep" : "csl-sepsm",
				"aria-hidden": true,
				key: "p" + i
			}, piece.size === "big" ? "|" : "·") : h("span", {
				className: "csl-item",
				key: "p" + i
			}, piece.text));
			if (css !== null) children.push(h("style", { key: "uicss" }, css));
			return h("div", { className: "csl-root" }, children);
		}
		/** 读命名空间文档的某个字段(防御性,缺省给哨兵)。 */
		function docField(doc, key, fallback) {
			if (typeof doc !== "object" || doc === null) return fallback;
			const value = doc[key];
			return value === void 0 ? fallback : value;
		}
		/** 预览用示例数据(固定值,与真实格式化同路径)。 */
		const SAMPLE_STATS = {
			turns: 5,
			steps: 23,
			llmMs: 162e3,
			toolMs: 45e3,
			ttftMs: 1200,
			ttftSteps: 1,
			decodeTokens: 2025,
			decodeMs: 45e3
		};
		const SAMPLE_USAGE = {
			uncachedInputTokens: 252e3,
			cacheReadTokens: 8148e3,
			cacheWriteTokens: 0,
			outputTokens: 68800
		};
		const SAMPLE_COST = {
			cost: .0082 / 7.2,
			pricing: "subscription"
		};
		const toDraftItem = (item) => item;
		/** 草稿项 → 文档项(空模板自定义组件丢弃)。 */
		function fromDraftItem(item) {
			return {
				kind: item.kind,
				size: item.size,
				template: item.template.trim()
			};
		}
		/** 命名空间文档 → 草稿。 */
		function draftFromDoc(doc) {
			return {
				items: docField(doc, "items", []).map(normalizeItem).filter((item) => item !== void 0).map(toDraftItem),
				css: docField(doc, "css", "")
			};
		}
		/** 组件 kind → 文案键。 */
		function itemLabelKey(item) {
			switch (item.kind) {
				case "counts": return "compCounts";
				case "llm": return "compLlm";
				case "tools": return "compTools";
				case "ttft": return "compTtft";
				case "tps": return "compTps";
				case "tokens": return "compTokens";
				case "cost": return "compCost";
				case "sep": return item.size === "big" ? "compSepBig" : "compSepSmall";
				default: return "compCustom";
			}
		}
		/** 调色板:可添加的内置组件;分隔符与自定义单独给。 */
		const PALETTE_KINDS = [
			"counts",
			"llm",
			"tools",
			"ttft",
			"tps",
			"tokens",
			"cost"
		];
		/**
		* 设置 GUI 卡片:可拖拽的组件编排器。组件序列 = 内置数据组件 + 大小分隔符
		* + 自定义模板组件;币种设置在 session-cost 插件的卡片里。编辑模型
		* 与第一方卡片一致:全部进本地草稿(dirty 显示未保存徽标),Save 一次性
		* 落盘,Discard 放弃。拖拽:按住手柄(⠿)拖动,dragover 实时换位。
		* 非 loopback 浏览器 writable=false:只读展示。
		*/
		function StatsLineCard(props) {
			const t = props.t;
			const snap = react.useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
			const [open, setOpen] = react.useState(false);
			const [draft, setDraft] = react.useState(null);
			const [dragFrom, setDragFrom] = react.useState(null);
			const [gripActive, setGripActive] = react.useState(null);
			if (settingsController === void 0) return null;
			const controller = settingsController;
			const writable = snap?.writable !== false;
			const stored = draftFromDoc(snap?.value);
			const value = draft ?? stored;
			const dirty = draft !== null;
			const edit = (patch) => setDraft({
				...value,
				...patch
			});
			const editItem = (i, patch) => edit({ items: value.items.map((item, j) => j === i ? {
				...item,
				...patch
			} : item) });
			const moveItem = (from, to) => {
				const next = value.items.slice();
				const [moved] = next.splice(from, 1);
				next.splice(to, 0, moved);
				edit({ items: next });
			};
			const save = () => {
				const items = value.items.map(fromDraftItem).filter((item) => item.kind !== "custom" || item.template !== "");
				if (JSON.stringify(items) !== JSON.stringify(stored.items.map(fromDraftItem))) {
					if (items.length === 0) controller.unset("items");
					else controller.set("items", items);
				}
				if (value.css !== stored.css) {
					if (value.css === "") controller.unset("css");
					else controller.set("css", value.css);
				}
				setDraft(null);
			};
			const sample = buildValues(SAMPLE_STATS, SAMPLE_USAGE, SAMPLE_COST, void 0, CURRENCY, t);
			const previewText = renderStatsLineItems((value.items.length > 0 ? value.items : DEFAULT_STATS_LINE_ITEMS.map(toDraftItem)).map(fromDraftItem), sample.parts, sample.values).map((piece) => piece.type === "sep" ? piece.size === "big" ? "|" : "·" : piece.text).join(" ");
			const body = open ? h("div", {
				className: "slc-body",
				key: "body"
			}, [
				h("div", {
					className: "slc-field",
					key: "preview"
				}, [h("label", {
					className: "slc-label",
					key: "l"
				}, t("cardPreview")), h("div", {
					className: "slc-preview",
					key: "box"
				}, previewText)]),
				h("div", {
					className: "slc-field",
					key: "items"
				}, [
					h("label", {
						className: "slc-label",
						key: "l"
					}, t("cardItems")),
					h("p", {
						className: "slc-hint",
						key: "hint"
					}, t("cardItemsHint")),
					...value.items.map((item, i) => h("div", {
						className: dragFrom === i ? "slc-row slc-dragging" : "slc-row",
						key: "r" + i,
						draggable: gripActive === i,
						onDragStart: (e) => {
							e.dataTransfer.effectAllowed = "move";
							e.dataTransfer.setData("text/plain", String(i));
							setDragFrom(i);
						},
						onDragOver: (e) => {
							e.preventDefault();
							e.dataTransfer.dropEffect = "move";
							if (dragFrom !== null && dragFrom !== i) {
								moveItem(dragFrom, i);
								setDragFrom(i);
							}
						},
						onDragEnd: () => {
							setDragFrom(null);
							setGripActive(null);
						}
					}, [
						h("span", {
							className: "slc-grip",
							key: "grip",
							title: t("cardDragHandle"),
							"aria-hidden": true,
							onMouseDown: () => setGripActive(i),
							onMouseUp: () => setGripActive(null)
						}, "⠿"),
						item.kind === "sep" ? h("button", {
							className: "slc-chip",
							key: "c",
							type: "button",
							disabled: !writable,
							title: t("cardSepToggle"),
							onClick: () => editItem(i, { size: item.size === "small" ? "big" : "small" })
						}, (item.size === "small" ? "·" : "|") + " " + t(itemLabelKey(item))) : item.kind === "custom" ? h("input", {
							className: "slc-input",
							key: "c",
							type: "text",
							value: item.template,
							placeholder: t("cardCustomPlaceholder"),
							disabled: !writable,
							onChange: (e) => editItem(i, { template: e.target.value })
						}) : h("span", {
							className: "slc-itemname",
							key: "c"
						}, t(itemLabelKey(item))),
						h("button", {
							className: "slc-btn",
							key: "rm",
							type: "button",
							disabled: !writable,
							onClick: () => edit({ items: value.items.filter((_, j) => j !== i) })
						}, t("cardRemove"))
					])),
					h("div", {
						className: "slc-actions",
						key: "palette"
					}, [
						h("span", {
							className: "slc-hint",
							key: "pl"
						}, t("cardAdd")),
						...PALETTE_KINDS.map((kind) => h("button", {
							className: "slc-add",
							key: kind,
							type: "button",
							disabled: !writable,
							onClick: () => edit({ items: [...value.items, toDraftItem(makeItem(kind))] })
						}, t(itemLabelKey(makeItem(kind))))),
						h("button", {
							className: "slc-add",
							key: "seps",
							type: "button",
							disabled: !writable,
							onClick: () => edit({ items: [...value.items, toDraftItem(makeItem("sep"))] })
						}, "·"),
						h("button", {
							className: "slc-add",
							key: "sepb",
							type: "button",
							disabled: !writable,
							onClick: () => edit({ items: [...value.items, toDraftItem(makeItem("sep", { size: "big" }))] })
						}, "|"),
						h("button", {
							className: "slc-add",
							key: "custom",
							type: "button",
							disabled: !writable,
							onClick: () => edit({ items: [...value.items, toDraftItem(makeItem("custom"))] })
						}, t("compCustom")),
						value.items.length === 0 ? h("button", {
							className: "slc-add",
							key: "defaults",
							type: "button",
							disabled: !writable,
							onClick: () => edit({ items: DEFAULT_STATS_LINE_ITEMS.map(toDraftItem) })
						}, t("cardStartFromDefaults")) : null
					])
				]),
				h("details", {
					className: "slc-advanced",
					key: "adv"
				}, [h("summary", {
					className: "slc-advancedsummary",
					key: "s"
				}, t("cardAdvanced")), h("div", {
					className: "slc-field",
					key: "css"
				}, [h("label", {
					className: "slc-label",
					key: "l"
				}, t("cardCss")), h("input", {
					className: "slc-input",
					key: "in",
					type: "text",
					value: value.css,
					disabled: !writable,
					onChange: (e) => edit({ css: e.target.value })
				})])]),
				h("div", {
					className: "slc-footer",
					key: "foot"
				}, [h("button", {
					className: "slc-discard",
					key: "d",
					type: "button",
					disabled: !dirty,
					onClick: () => setDraft(null)
				}, t("cardDiscard")), h("button", {
					className: "slc-save",
					key: "s",
					type: "button",
					disabled: !dirty || !writable,
					onClick: save
				}, t("cardSave"))])
			]) : null;
			return h("li", { className: open ? "slc-card slc-open" : "slc-card" }, [h("button", {
				className: "slc-header",
				key: "head",
				type: "button",
				"aria-expanded": open,
				onClick: () => setOpen(!open)
			}, [
				h("span", {
					className: "slc-headtext",
					key: "txt"
				}, [h("span", {
					className: "slc-name",
					key: "n"
				}, t("cardTitle")), h("span", {
					className: "slc-desc",
					key: "d"
				}, t("cardDescription"))]),
				dirty ? h("span", {
					className: "slc-pending",
					key: "pd"
				}, t("cardUnsaved")) : null,
				h("svg", {
					className: "slc-chevron",
					key: "ch",
					width: 14,
					height: 14,
					viewBox: "0 0 14 14",
					fill: "none",
					"aria-hidden": true
				}, h("path", {
					d: "M3.5 5.25 7 8.75l3.5-3.5",
					stroke: "currentColor",
					strokeWidth: 1.5,
					strokeLinecap: "round",
					strokeLinejoin: "round"
				}))
			]), body]);
		}
		function apply(ctx, config) {
			CURRENCY = resolveCurrency(config);
			const locale = ctx.get("locale");
			if (locale !== void 0) ctx.effect(() => locale.register(NS, {
				zh,
				en
			}), "dsh-stats-line: dictionaries");
			const settingsScope = ctx.get("settingsScope");
			if (settingsScope !== void 0) settingsController = settingsScope.bind({ namespace: STATS_LINE_NS });
			const slots = ctx.get("slots");
			if (slots === void 0) return;
			slots.inject("conversation.composer.dock", () => slots.register({
				name: "conversation.composer.dock",
				id: "stats",
				order: 0,
				priority: -1,
				locale: NS
			}, CompactStatsLine));
			slots.inject("settings.plugin.item", () => slots.register({
				name: "settings.plugin.item",
				key: STATS_LINE_NS,
				locale: NS
			}, StatsLineCard));
		}
		//#endregion
		exports.apply = apply;
		return module.exports;
	}
});
