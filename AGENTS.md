# AGENTS.md — dsh-plugins

DSH web 插件 monorepo。设计决策与架构论证见 DESIGN.md(根)与各包的 DESIGN.md(如 vibeguard);本文件只放基本信息与开发纪律;冲突时以代码为准。

## 包

- `packages/session-cost`(dsh-session-cost):会话费用投影 + 计价表 + 显示币种配置
- `packages/stats-line`(dsh-stats-line):stats line cell + 设置 GUI 组件编排器
- `packages/vibeguard`(dsh-vibeguard):写日志前密钥脱敏 + secret_exec broker 工具(纯 host)

包间纪律:**包不互相 import 代码**,只按投影 key 消费并防御性校验视图形状(stats-line 缺席 session-cost 时 cost 组件自动不渲染);刻意重复的代码(如两边的币种解析)在第三个插件需要时再抽 shared 包。

## 命令

```bash
pnpm build      # 根目录 pnpm -r:各包 rolldown src/*.ts → dist/
pnpm test       # 各包自动先 build;断言见各包 test/*.mjs
pnpm typecheck  # tsc --noEmit,strict,逐包
```

## 纪律

- **测试测 dist/**(import `../dist/*.js`),不测 src;每条的 check 名写明保护的不变量。
- **dist/ 提交进 git**,改 src 必须重新 build,CI 检查 dist 新鲜度。**例外:vibeguard 走 npm 发布路线,dist 不进 git**。
- **host 端外部依赖**(zod、@deepseek-ai/dsh-settings、@deepseek-ai/schemastery)在 rolldown.config.js 声明为 external,由平台供给;不要 bundle。
- client 改动能 HMR(profile 为 link: 时 build 即生效);host/配置改动需重启 `dsh web`。
- session-cost:eras 追加-only,调价 = 追加时代 + bump `stateVersion`;未知 provider/模型一律不计费,禁止跨 provider 价格回退;新投影必须带 `wire`(0.1.1 起无 wire 不下发且不报错)。细节见根 DESIGN.md。
- vibeguard:占位符纯函数、零磁盘状态、映射按会话分桶、还原只有 secret_exec 一个出口。不变量细节见 packages/vibeguard/DESIGN.md 与其包内 AGENTS.md。
- **验证平台行为的正确姿势**:读 pnpm store 里 `@deepseek-ai/*/lib/*.js` 编译产物并引用 file:line;client inspect 目录是手写静态清单,不全。DSH 升级后复查平台假设。
- 文档分工:README(用户面)→ DESIGN.md(设计与否决的备选)→ 本文件(纪律);三者同步更新;Markdown 一段一行。
- 发布 = 每包独立打 tag(`<pkg>-vX.Y.Z`),然后更新 chezmoi 脚本里的安装声明。

## Commit

使用 Conventional Commits:`feat:` / `fix:` / `docs:` / `test:` / `build:` / `ci:` / `chore:`;monorepo 内按包加 scope(如 `feat(vibeguard): …`)。
