window.__ModuleLoader__.load({
	id: "dsh-stats-compact",
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
		//#region src/client.ts
		/**
		* dsh-stats-compact 浏览器端:紧凑 stats line 组件。
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
		const css = [
			"/* dsh-stats-compact: 紧凑 stats line */",
			".csl-root{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:2px 0;box-sizing:border-box;width:100%;max-width:var(--dsh-chat-content-width,748px);margin:0 auto;padding:4px calc(var(--dsh-composer-side-clearance,16px) + 16px) 0;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}",
			".csl-item{display:inline-flex;align-items:baseline;white-space:nowrap;font-variant-numeric:tabular-nums}",
			".csl-sep{color:var(--dsw-alias-separator-primary);margin:0 6px}"
		].join("\n");
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"dsh-stats-compact\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-stats-compact";
			tag.dataset.pluginCss = "dsh-stats-compact";
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
			estimated: "≈"
		};
		const en = {
			counts: "{turns} turns · {steps} steps",
			llm: "LLM {d}",
			tools: "Tools {d}",
			ttft: "TTFT {d}",
			tps: "{tps} tok/s",
			tokens: "↑{in}{suffix} ↓{out}",
			cacheSuffix: "({p}%)",
			estimated: "≈"
		};
		let CURRENCY = resolveCurrency(void 0);
		function CompactStatsLine(props) {
			const useSession = props.useSession;
			const useProjection = props.useProjection;
			const t = props.t;
			const settledNodes = useSession !== void 0 ? useSession((s) => s.chat.legacy.nodes) : void 0;
			const usage = useProjection !== void 0 ? useProjection("tokenUsage") : void 0;
			const projected = useProjection !== void 0 ? useProjection("sessionStats") : void 0;
			const costUsage = useProjection !== void 0 ? useProjection("costUsage") : void 0;
			const sessionCost = useProjection !== void 0 ? useProjection("sessionCost") : void 0;
			const stats = projected ?? (settledNodes !== void 0 ? deriveStats(settledNodes) : void 0);
			const groups = [];
			if (stats !== void 0 && stats.steps > 0) {
				groups.push(t("counts", {
					turns: stats.turns,
					steps: stats.steps
				}));
				const durations = [];
				if (stats.llmMs > 0) durations.push(t("llm", { d: formatDuration(stats.llmMs) }));
				if (stats.toolMs > 0) durations.push(t("tools", { d: formatDuration(stats.toolMs) }));
				if (durations.length > 0) groups.push(durations.join(" · "));
				const speeds = [];
				if (stats.ttftSteps > 0) speeds.push(t("ttft", { d: formatDuration(stats.ttftMs / stats.ttftSteps) }));
				if (stats.decodeMs > 0) speeds.push(t("tps", { tps: formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1e3)) }));
				if (speeds.length > 0) groups.push(speeds.join(" · "));
			}
			if (usage !== void 0 && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)) {
				const cache = cacheHitPercent(usage);
				const suffix = cache !== null ? t("cacheSuffix", { p: cache }) : "";
				groups.push(t("tokens", {
					in: formatTokens(billedInputTokens(usage)),
					suffix,
					out: formatTokens(usage.outputTokens)
				}));
			}
			const costUsageCost = typeof costUsage?.cost === "number" && costUsage.cost > 0 ? costUsage.cost : null;
			if (costUsageCost !== null) groups.push(formatMoney(costUsageCost, CURRENCY));
			else if (sessionCost !== void 0) {
				const pricing = sessionCost.pricing;
				const cost = typeof sessionCost.cost === "number" ? sessionCost.cost : 0;
				if (pricing === "metered" && cost > 0) groups.push(formatMoney(cost, CURRENCY));
				else if ((pricing === "mixed" || pricing === "subscription") && cost > 0) groups.push(t("estimated") + formatMoney(cost, CURRENCY));
			}
			if (groups.length === 0) return null;
			const children = [];
			groups.forEach((group, i) => {
				if (i > 0) children.push(h("span", {
					className: "csl-sep",
					"aria-hidden": true,
					key: "sep" + i
				}, "|"));
				children.push(h("span", {
					className: "csl-item",
					key: "g" + i
				}, group));
			});
			return h("div", { className: "csl-root" }, children);
		}
		function apply(ctx, config) {
			CURRENCY = resolveCurrency(config);
			const locale = ctx.get("locale");
			if (locale !== void 0) ctx.effect(() => locale.register(NS, {
				zh,
				en
			}), "dsh-stats-compact: dictionaries");
			const slots = ctx.get("slots");
			if (slots === void 0) return;
			slots.inject("conversation.composer.dock", () => slots.register({
				name: "conversation.composer.dock",
				id: "stats",
				order: 0,
				priority: -1,
				locale: NS
			}, CompactStatsLine));
		}
		//#endregion
		exports.apply = apply;
		return module.exports;
	}
});
