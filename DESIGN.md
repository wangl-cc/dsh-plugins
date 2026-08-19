# DESIGN.md — dsh-stats-compact 设计

插件做两件事:替换官方 stats line(更紧凑、可换行),以及在行尾显示会话费用。本文记录持久的设计决策;临时状态(本机安装、待办)在本地的 HANDOFF.md(不进 git)。与代码冲突时以代码为准。

## Stats line:slot shadowing

官方 StatsLine 注册在 `conversation.composer.dock` 槽位(`id: "stats"`, priority 0)。本插件注册同 id、priority **-1**——"最低 priority 渲染,同 id 同 priority 才冲突";本组件崩溃时 abdicate,官方条目自动接管,shadow 自带回退。数据源与官方一致(`sessionStats`/`tokenUsage` 投影优先,窗口节点折叠兜底),折叠算法复制自 `dsh-client-ui-conversation`,DSH 大版本改节点结构时需同步。

## 会话费用:sessionCost 投影

宿主端注册纯函数投影(init/apply/view,零副作用零网络),注册表(dsh-session-projection)负责实时驱动、冷读折叠、checkpoint 写盘。

- 事件:`request/header` 记 provider/model;`assistant/chunk`(type=usage)与 `assistant/message`(带 usage)取用量;按 `(turn, step)` 去重,新样本先减旧再加。
- view = token 总量 + cost + `pricing` 标记,客户端按 pricing 渲染:**`≈` 是唯一的非精确标记**——metered 精确金额;subscription(有刊例价)/mixed 加 ≈;unknown/none/无刊例价订阅不显示。

## 计价模型:provider + 时代(eras)

`PROVIDERS` 表(src/index.ts)按 provider 分类:

- **metered**(如 deepseek-official):按 token 计费,`cost = (input×cacheMiss + output×output + (cacheRead+cacheWrite)×cacheHit) / 1M`,reasoning 不重复计,cache write 按命中价。
- **subscription**(如 kimi-coding、opencode-go):包月端点;官方有 API 刊例价的配参考价表,cost 是"按刊例价值多少"的估算,不是真实账单。
- **unknown**:不认识的 provider/模型/无时代覆盖的时刻,cost 恒 0。**禁止跨 provider 价格回退**——宁可不显示,不算错数。

**价格带日期**:每个 provider 的 `eras` 按 `since` 升序,历史事件永远按事件发生时刻生效的时代计费。官方调价 = 末尾追加一个时代(不改旧时代)+ bump `stateVersion`(否则旧 checkpoint 带旧价续算)。

## 时区纪律

时代边界(`since`/`until`)用绝对时刻(ISO 带时区或 epoch ms)。峰谷窗口是 **UTC 小时**半开区间(比较走 `getUTCHours()`,与运行机器时区无关)。官方价目表按其他时区声明时(DeepSeek 用北京时间),源码写官方小时数并用 `toUtcWindows(windows, offset)` 显式换算,注释保留原始声明。

## 构建与分发

- rolldown 三产物:host ESM(zod 外置)、format ESM(共享纯函数,client 内联 + Node 测试复用)、client CJS(`__ModuleLoader__` 工厂包装由 banner/footer 生成,react 外置)。
- **dist/ 提交进 git**:`github:` 安装源没有构建环节,dist 就是安装产物。CI 用 `git diff --exit-code dist/` 防漂移;`.gitattributes` 标 generated 折叠 diff。若将来发 npm,则撤回此策略(dist 改进 npm 包)。
- 发布 = 打 tag。chezmoi 脚本(dotfiles 仓库)钉 tag,是唯一安装声明层;升级以 dotfiles commit 形式接受审查。
- client 改动可 HMR(profile 为 link: 时 build 即生效);host/配置改动需重启 `dsh web`。

## 已知限制

- 价表硬编码,无官方同步;装了 dsh-cost-meter 时客户端自动优先其 `costUsage` 投影。
- 汇率静态(默认 7.2)。loader 行 config 不到达浏览器端,币种配置目前是死开关(客户端始终 CNY/7.2/4)。
- 单槽 `(turn,step)` 去重依赖事件顺序(agent-loop append 顺序保证)。
