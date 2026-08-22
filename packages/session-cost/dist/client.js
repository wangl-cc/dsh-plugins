window.__ModuleLoader__.load({
	id: "dsh-session-cost",
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
		//#region src/client.ts
		/**
		* dsh-session-cost client half: settings card for the `session-cost`
		* namespace (display currency / exchange rate / decimals / symbol).
		*
		* The card replicates the platform PluginCard/ValueField visual contract
		* (first-party CSS modules are package-private — cross-package import is
		* forbidden by bundle purity checks — so the chrome is rebuilt from the
		* same --dsw-alias-* variables). Draft + Save/Discard model like the
		* first-party cards: edits stay local until Save writes the namespace.
		*
		* classic script, React.createElement only (no JSX at runtime).
		*/
		const h = react.createElement;
		const NS = "dsh-session-cost";
		const zh = {
			cardTitle: "会话费用",
			cardDescription: "费用投影的显示币种与汇率。",
			cardCurrency: "币种(ISO 4217)",
			cardExchangeRate: "汇率(USD → 显示币种)",
			cardDecimals: "小数位(0–10)",
			cardSymbol: "货币符号",
			cardInvalidNumber: "请输入正数",
			cardInvalidDecimals: "请输入 0–10 的整数",
			cardUnsaved: "未保存",
			cardSave: "保存",
			cardDiscard: "放弃"
		};
		const en = {
			cardTitle: "Session cost",
			cardDescription: "Display currency and exchange rate for the cost projection.",
			cardCurrency: "Currency (ISO 4217)",
			cardExchangeRate: "Exchange rate (USD → display)",
			cardDecimals: "Decimals (0–10)",
			cardSymbol: "Currency symbol",
			cardInvalidNumber: "Enter a positive number",
			cardInvalidDecimals: "Enter an integer between 0 and 10",
			cardUnsaved: "Unsaved",
			cardSave: "Save",
			cardDiscard: "Discard"
		};
		const CARD_CSS = [
			"/* session-cost 设置卡片:复刻平台 PluginCard/ValueField 视觉契约 */",
			".scc-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}",
			".scc-card:hover{border-color:var(--dsw-alias-label-dimmed)}",
			".scc-card.scc-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}",
			".scc-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}",
			".scc-headtext{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}",
			".scc-name{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}",
			".scc-desc{font-size:12px;color:var(--dsw-alias-label-secondary)}",
			".scc-pending{font-size:11px;color:var(--dsw-alias-label-tertiary)}",
			".scc-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}",
			".scc-open .scc-chevron{transform:rotate(180deg)}",
			".scc-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding:12px 0 8px;display:flex;flex-direction:column;gap:10px}",
			".scc-field{display:flex;flex-direction:column;gap:6px}",
			".scc-label{font-size:12px;color:var(--dsw-alias-label-secondary)}",
			".scc-input{width:100%;height:34px;padding:0 10px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;outline:none;box-sizing:border-box}",
			".scc-input:focus{border-color:var(--dsw-alias-brand-primary)}",
			".scc-input::placeholder{color:var(--dsw-alias-label-tertiary)}",
			".scc-error{font-size:11px;color:var(--dsw-alias-label-error)}",
			".scc-footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}",
			".scc-save,.scc-discard{appearance:none;font:inherit;font-size:12px;height:28px;padding:0 12px;border-radius:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}",
			".scc-save{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}",
			".scc-save:disabled,.scc-discard:disabled{opacity:.45;cursor:default}"
		].join("\n");
		/** 带标记的幂等样式注入。 */
		function injectCss(id, css) {
			const doc = globalThis.document;
			if (doc === void 0) return;
			if (doc.querySelector(`style[data-plugin-css="${id}"]`) !== null) return;
			const el = doc.createElement("style");
			el.setAttribute("data-plugin-css", id);
			el.textContent = css;
			doc.head.appendChild(el);
		}
		let settingsController = null;
		function useSettingsSnapshot() {
			const ctrl = settingsController;
			return react.useSyncExternalStore((fn) => ctrl !== null ? ctrl.subscribe(fn) : () => {}, () => ctrl !== null ? ctrl.getSnapshot() : null);
		}
		/** 文档(哨兵 ''/0/-1) → 输入框草稿(空串 = 未设置)。 */
		function draftFromDoc(doc) {
			const rate = typeof doc.exchangeRate === "number" && doc.exchangeRate > 0 ? String(doc.exchangeRate) : "";
			const decimals = typeof doc.decimals === "number" && doc.decimals >= 0 ? String(doc.decimals) : "";
			return {
				currency: typeof doc.currency === "string" ? doc.currency : "",
				exchangeRate: rate,
				decimals,
				symbol: typeof doc.symbol === "string" ? doc.symbol : ""
			};
		}
		function SessionCostCard(_props) {
			const snap = useSettingsSnapshot();
			const [open, setOpen] = react.useState(false);
			const [draft, setDraft] = react.useState(null);
			const t = _props.ctx?.t ?? ((key) => en[key]);
			const doc = snap?.value ?? {};
			const value = draft ?? draftFromDoc(doc);
			const dirty = draft !== null;
			const writable = snap?.writable !== false;
			const edit = (patch) => setDraft({
				...value,
				...patch
			});
			const rate = Number(value.exchangeRate);
			const rateValid = value.exchangeRate === "" || Number.isFinite(rate) && rate > 0;
			const dec = Number(value.decimals);
			const decValid = value.decimals === "" || Number.isInteger(dec) && dec >= 0 && dec <= 10;
			const save = () => {
				if (settingsController === null) return;
				settingsController.set({
					currency: value.currency,
					exchangeRate: value.exchangeRate === "" ? 0 : rate,
					decimals: value.decimals === "" ? -1 : dec,
					symbol: value.symbol
				});
				setDraft(null);
			};
			const field = (key, labelKey, errKey, valid) => h("div", {
				className: "scc-field",
				key
			}, [
				h("label", {
					className: "scc-label",
					key: "l"
				}, t(labelKey)),
				h("input", {
					className: "scc-input",
					key: "i",
					type: "text",
					value: value[key],
					placeholder: t(labelKey),
					"aria-invalid": !valid || void 0,
					onChange: (e) => edit({ [key]: e.target.value })
				}),
				!valid && errKey !== null ? h("div", {
					className: "scc-error",
					key: "e"
				}, t(errKey)) : null
			]);
			const body = open ? h("div", {
				className: "scc-body",
				key: "body"
			}, [
				field("currency", "cardCurrency", null, true),
				field("exchangeRate", "cardExchangeRate", "cardInvalidNumber", rateValid),
				field("decimals", "cardDecimals", "cardInvalidDecimals", decValid),
				field("symbol", "cardSymbol", null, true),
				h("div", {
					className: "scc-footer",
					key: "foot"
				}, [h("button", {
					className: "scc-discard",
					key: "d",
					type: "button",
					disabled: !dirty,
					onClick: () => setDraft(null)
				}, t("cardDiscard")), h("button", {
					className: "scc-save",
					key: "s",
					type: "button",
					disabled: !dirty || !rateValid || !decValid || !writable,
					onClick: save
				}, t("cardSave"))])
			]) : null;
			return h("li", { className: open ? "scc-card scc-open" : "scc-card" }, [h("button", {
				className: "scc-header",
				key: "head",
				type: "button",
				"aria-expanded": open,
				onClick: () => setOpen(!open)
			}, [
				h("span", {
					className: "scc-headtext",
					key: "txt"
				}, [h("span", {
					className: "scc-name",
					key: "n"
				}, t("cardTitle")), h("span", {
					className: "scc-desc",
					key: "d"
				}, t("cardDescription"))]),
				dirty ? h("span", {
					className: "scc-pending",
					key: "pd"
				}, t("cardUnsaved")) : null,
				h("svg", {
					className: "scc-chevron",
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
		function apply(ctx) {
			injectCss("dsh-session-cost", CARD_CSS);
			const locale = ctx.get("locale");
			if (locale !== void 0) ctx.effect(() => locale.register(NS, {
				zh,
				en
			}), "dsh-session-cost: dictionaries");
			const settingsScope = ctx.get("settingsScope");
			if (settingsScope !== void 0) settingsController = settingsScope.bind({ namespace: "session-cost" });
			const slots = ctx.get("slots");
			if (slots === void 0) return;
			slots.inject("settings.plugin.item", () => slots.register({
				name: "settings.plugin.item",
				key: "session-cost",
				locale: NS
			}, SessionCostCard));
		}
		//#endregion
		exports.apply = apply;
		return module.exports;
	}
});
