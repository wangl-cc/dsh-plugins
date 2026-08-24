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
- **映射只活在本会话内存里**:按会话分桶(engine.ts),不落盘、不跨会话解析;磁盘上唯一持久的是 HMAC key。禁止重新引入任何形式的持久映射。
- **还原只有一个出口**:`secret_exec` broker 工具(src/broker.ts)在子进程内存里替换;不改写别的工具的参数,不对抗深冻结,不注册任何"占位符→真值"的通用查询通道。
- deny 匹配是字段感知的(src/guard.ts):只查目标参数,不扫全参数 JSON;加新工具字段时同步 PATHISH_FIELDS 与 test/guard.mjs。
- 内置规则只收结构性前缀规则;kv 规则必须 `group` 只脱敏值 + `minLength` 降噪;改规则必须同步 test/engine.mjs 的 fixture。
- 私钥规则必须吃到 `-----END-----`;已是占位符的值不得二次脱敏(引擎幂等)。
- **dist/ 不进 git**(本包与 monorepo 惯例不同:npm 发布路线,prepack 构建)。
- host/配置改动需重启 `dsh web` 生效(无 HMR)。

## Commit

使用 Conventional Commits:`feat:` / `fix:` / `docs:` / `test:` / `build:` / `ci:` / `chore:`。
