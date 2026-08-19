# dsh-stats-compact

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web plugin: a compact replacement for the conversation stats line, plus a per-provider, era-based session cost display.

```text
5 轮 · 23 步 | LLM 2m42s · 工具 45s | TTFT 1.2s · 45 tok/s | ↑8.4M(97%) ↓68.8K | ¥0.0082
```

- **Compact stats line** — shadows the official `id:stats` cell in `conversation.composer.dock` (priority -1, lowest wins; on crash the official cell takes back over). Same data sources as the official StatsLine, shorter labels, flex-wrap layout instead of single-line truncation.
- **Session cost** — a host-side `sessionCost` projection bills every model call at its event time against per-provider **era tables** (`PROVIDERS` in `src/index.ts`):
  - `metered` providers (currently `deepseek-official`, with the 2026-08 peak/off-peak schedule) show exact figures;
  - `subscription` providers with published API list prices (currently `kimi-coding` / k3-256k) show an `≈` estimate of what the tokens would have cost;
  - unknown providers/models are never billed at someone else's price sheet — nothing is shown.
  - Price changes are append-only eras with effective dates; historical events always bill at the era in effect at their event time.

## Install

```bash
dsh plugin --profile web add github:wangl-cc/dsh-stats-compact#v0.2.0
```

Restart `dsh web` afterwards. Uninstall: `dsh plugin --profile web remove dsh-stats-compact`.

For development, link a local checkout instead: `dsh plugin --profile web add ~/Repos/dsh/dsh-stats-compact`.

## Develop

```bash
pnpm install
pnpm build      # rolldown: src/*.ts → dist/ (committed; github: installs need it)
pnpm test       # build + 61 assertions (session-cost + format)
pnpm typecheck  # tsc --noEmit, strict
```

`dist/` is committed on purpose: it is what `github:` installs resolve. CI fails if `dist/` drifts from `src/`.

See [DESIGN.md](./DESIGN.md) for the architecture notes (slot shadowing, projection contract, era tables, timezone rules, release procedure).
