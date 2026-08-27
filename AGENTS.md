# AGENTS.md — dsh-plugins

DSH（DeepSeek Harness）web 插件的 pnpm monorepo，包在 `packages/` 下。本文只收基本信息与规范；具体设计见 DESIGN.md（根及各包），冲突时以代码为准。

## 包

- `session-cost`（dsh-session-cost）：会话费用投影 `sessionCost` + 计价表 + `session-cost` settings 命名空间。
- `stats-line`（dsh-stats-line）：stats line cell + 设置 GUI chip 编排器（`stats-line` 命名空间；模板组件模型：组件 = `$name` 插值模板串，行 = 小组数组，连接符自动生成——详见 DESIGN.md）。
- `vibeguard`（dsh-vibeguard）：写日志前密钥脱敏 + `secret_exec` broker 工具；本包另有自己的 AGENTS.md/DESIGN.md。

## 命令

```bash
pnpm install
pnpm build       # 全部包（rolldown → dist/）
pnpm test        # 各包测试，自动先 build
pnpm typecheck   # 各包 tsc --noEmit
```

CI 跑 typecheck + test（测试自动先 build，产物正确性由测试断言兜底）。

## 规范

- 测试测 dist/ 产物，不测 src/；改代码后必须重新 build 再测。
- `dist/` 不进 git；三包统一走 npm 发布，`prepack` 负责构建，`prepublishOnly` 跑 typecheck + test。
- host 产物的外部依赖（zod、`@deepseek-ai/*` 等）在 rolldown 配置里声明 external，不 bundle。
- host/配置改动需重启 `dsh web` 生效；client 改动可 HMR。
- 包间不互相 import 代码；跨包协作走投影 key 等运行时契约。
- 文档分工：README 写用户面（安装/使用），DESIGN.md 写设计与理由，AGENTS.md 只写基本信息与规范；行为变更时同步更新对应文档。
- Markdown 每个自然段/列表项占一行物理行。

## Commit

使用 Conventional Commits，scope 用包名（不带 `dsh-` 前缀）：`feat(session-cost): ...`、`fix(stats-line): ...`、`test(vibeguard): ...`；跨包或仓库级改动用 `ci:` / `chore:` / `docs:` 等、不带包 scope。
