# dsh-plugins

A monorepo of plugins for the [DeepSeek Harness](https://github.com/deepseek-ai/dsh) web UI.

## Packages

| Package | What it provides |
| --- | --- |
| [`dsh-session-cost`](packages/session-cost) | The `sessionCost` session projection: era-based per-provider cost accounting (metered / subscription / unknown, UTC peak windows, cache-write pricing, long-context tiers) plus the `session-cost` settings namespace for the display currency. Host-side data only — no UI of its own beyond a settings card. |
| [`dsh-stats-line`](packages/stats-line) | A compact replacement for the shipped stats line (shadows `id: stats` in `conversation.composer.dock`) with a drag-and-drop component composer in the settings GUI (`stats-line` namespace). The `cost` component is fed by the `sessionCost` projection and disappears gracefully when dsh-session-cost is not installed. |

The two packages are decoupled by design: `dsh-stats-line` consumes the projection **by key** (`useProjection('sessionCost')`) and defensively validates the view shape — no code imports cross the package boundary.

## Install

```bash
dsh plugin --profile web add <path-or-spec>   # per package, e.g. both of:
dsh plugin --profile web add github:wangl-cc/dsh-plugins   # (npm specs after first release)
```

Until the first npm release, install from a local checkout: `dsh plugin --profile web add ./packages/session-cost` (and likewise for `stats-line`). Each package's `cordis.patch.yml` documents its loader-row config; the recommended way to configure is the settings GUI (Settings → Plugins).

## Develop

```bash
pnpm install
pnpm build      # all packages (rolldown; dist/ is committed — CI checks freshness)
pnpm test       # per-package Node test files (test the built dist/, not src/)
pnpm typecheck  # tsc --noEmit per package
```

Client halves hot-reload when the profile links the checkout; host halves and config changes need a `dsh web` restart. Conventional Commits; per-package tags after release. Design rationale lives in [DESIGN.md](DESIGN.md); agent-facing conventions in [AGENTS.md](AGENTS.md).
