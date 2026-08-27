# dsh-session-cost

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web plugin that answers one question: **"how much is this session worth so far?"** It provides the `sessionCost` session projection — pure data, no UI of its own beyond a small settings card.

## What it provides

- **The `sessionCost` projection** — replays the durable session log and bills every model call at its event time against per-provider **era tables** (`PROVIDERS` in `src/index.ts`):
  - `metered` providers (currently `deepseek-official`, with the 2026-08 peak/off-peak schedule, and `openai` — GPT 5.6 Standard-tier list prices with separate cache-write and ≥272K long-context tiers) yield exact figures;
  - `subscription` providers with published API list prices (currently `kimi-coding` / k3, k3-256k, kimi-k2.7-code, k2.7-code) yield an estimate of what the tokens would have cost (`pricing: 'subscription'` / `'mixed'`, plus `partial` when some usage is unbillable);
  - unknown providers/models are never billed at someone else's price sheet — `pricing: 'unknown'`.
  - Price changes are append-only eras with effective dates; historical events always bill at the era in effect at their event time. Billing changes bump `stateVersion`.
- **The view** (sent to the browser via the projection `wire` channel): token totals + `cost` (USD) + `pricing` + `partial` + the resolved display `currency` (`{ symbol, decimals, rate }`) + `display.cost` — a self-describing formatted string (`≈¥0.0082`), so consumers place it verbatim without knowing currency or estimate rules.
- **The `session-cost` settings namespace** — display currency, exchange rate, decimals, symbol. Layering: schema defaults < loader-row config < user layer (Settings → Plugins → session-cost, or `~/.dsh/settings.yaml`). Exchange rates resolve explicit pin → online lookup (frankfurter.dev, at startup + daily) → built-in fallback table. Rates affect display only (applied at view time), so online lookups never compromise replay determinism.

## Install

```bash
dsh plugin --profile web add ./packages/session-cost   # local checkout (pre-release)
```

Restart `dsh web` afterwards. Uninstall: `dsh plugin --profile web remove dsh-session-cost`. A stats-line style display comes from [dsh-stats-line](../stats-line), which consumes this projection by key; anything else can too (`useProjection('sessionCost')` in a client plugin, defensively validated).

## Develop

```bash
pnpm build      # from the repo root; dist/ is committed
pnpm test       # pricing/FX/namespace assertions against the built dist/
pnpm typecheck  # tsc --noEmit, strict
```

See [DESIGN.md](../../DESIGN.md) for era-table discipline, timezone rules, and the projection `wire` requirement.
