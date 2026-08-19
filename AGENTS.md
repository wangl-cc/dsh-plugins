# AGENTS.md — dsh-stats-compact

DSH web 插件:紧凑 stats line + 会话费用投影。架构与设计决策见 DESIGN.md;冲突时以代码为准。

## 命令

```bash
pnpm build      # src/*.ts → dist/
pnpm test       # 自动先 build
pnpm typecheck  # tsc --noEmit
```

## 关键规则

- **eras 追加-only**,不改历史时代;计费变更要 bump `stateVersion`。
- 未知 provider/模型一律不计费,禁止跨 provider 价格回退。
- 峰谷窗口用 UTC 小时,官方按其他时区声明时用 `toUtcWindows` 换算。
- **dist/ 提交进 git**(github: 安装源的产物),改 src 必须重新 build;CI 会检查。
- client 改动能 HMR(profile 为 link: 时 build 即生效);host/配置改动需重启 `dsh web`。
- 发布 = 打 tag 推送,然后更新 chezmoi 脚本里的 tag。

## Commit

使用 Conventional Commits:`feat:` / `fix:` / `docs:` / `test:` / `build:` / `ci:` / `chore:`。
