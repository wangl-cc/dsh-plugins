# dsh-stats-line

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web plugin: a compact, fully composable replacement for the conversation stats line.

```text
5 轮 · 23 步 | LLM 2m42s · 工具 45s | TTFT 1.2s · 45 tok/s | ↑8.4M(97%) ↓68.8K | ≈¥0.0082
```

- **Compact stats line** — shadows the official `id:stats` cell in `conversation.composer.dock` (priority -1, lowest wins; on crash the official cell takes back over). Same data sources as the official StatsLine, shorter labels, flex-wrap layout instead of single-line truncation.
- **Composable** — the line is a sequence of components (built-ins `counts` `llm` `tools` `ttft` `tps` `tokens` `cost`, small/big separators, custom template components) you arrange in a drag-and-drop composer in the settings GUI, with live preview.
- **Cost display** — the `cost` component reads the `sessionCost` projection by key (provided by [dsh-session-cost](../session-cost); not installed → the component simply disappears). Currency, exchange rate, decimals and symbol are configured in the `session-cost` settings card.

## Install

```bash
dsh plugin --profile web add github:wangl-cc/dsh-plugins   # subdir installs after first npm release
```

Until then, link a local checkout: `dsh plugin --profile web add ./packages/stats-line` (usually together with `./packages/session-cost` for the cost component). Restart `dsh web` afterwards. Uninstall: `dsh plugin --profile web remove dsh-stats-line`.

## Configure

Settings live in the `stats-line` namespace — edit them in **Settings → Plugins → stats-line** (drag-and-drop composer, live preview, no restart) or directly in `~/.dsh/settings.yaml`:

```yaml
stats-line:
  items:                          # component sequence (order = display order)
    - { kind: counts }            # built-ins: counts llm tools ttft tps tokens cost
    - { kind: sep, size: big }    # separator: small '·' or big '|'
    - { kind: custom, template: '↑{input}{cache} ↓{output}' }
    - { kind: sep, size: big }
    - { kind: cost }              # fed by the sessionCost projection (dsh-session-cost)
  css: '.csl-root{font-size:11px}'
```

A component whose data is unavailable (e.g. `cost` on an unknown provider, or without dsh-session-cost) is not rendered, and separators collapse automatically (edges dropped, adjacent ones keep the bigger). Custom components interpolate pre-formatted placeholders: `{turns}` `{steps}` `{llm}` `{tools}` `{ttft}` `{tps}` `{input}` `{output}` `{cache}` `{cost}`. Empty/absent fields fall back to defaults. Loader-row `config` (e.g. in `cordis.patch.yml`) still works — it becomes the base layer underneath GUI edits.

## Develop

```bash
pnpm build      # from the repo root builds all packages; dist/ is committed
pnpm test       # settings + format assertions
pnpm typecheck  # tsc --noEmit, strict
```

See [DESIGN.md](../../DESIGN.md) for the architecture notes (slot shadowing, component model, settings layering).
