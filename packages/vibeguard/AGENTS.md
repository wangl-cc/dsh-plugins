# AGENTS.md — dsh-vibeguard

DSH 宿主端插件:写日志前密钥脱敏。架构与设计决策见 DESIGN.md;冲突时以代码为准。

## 命令

```bash
pnpm build      # src/*.ts → dist/
pnpm test       # 自动先 build
pnpm typecheck  # tsc --noEmit
```

## 关键规则

- **占位符是内容的纯函数**:禁止引入会话/env/计数器等上下文依赖。
- **不做运行期还原**:不改写工具参数,不对抗深冻结。
- 内置规则只收结构性前缀规则;kv 规则必须 `group` 只脱敏值 + `minLength` 降噪;改规则必须同步 test/engine.mjs 的 fixture。
- 私钥规则必须吃到 `-----END-----`;已是占位符的值不得二次脱敏(引擎幂等)。
- **dist/ 不进 git**;发布 = npm scoped 包,prepack 构建。
- host/配置改动需重启 `dsh web` 生效(无 HMR)。

## Commit

使用 Conventional Commits:`feat:` / `fix:` / `docs:` / `test:` / `build:` / `ci:` / `chore:`。
