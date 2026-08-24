# DESIGN.md — dsh-plugins 设计

monorepo 里目前三个包:**dsh-session-cost**(host 端 `sessionCost` 投影 + 计价表 + 显示币种的 settings 命名空间)、**dsh-stats-line**(stats line cell + 组件编排器 + `stats-line` 命名空间)与 **dsh-vibeguard**(写日志前密钥脱敏 + `secret_exec` broker 工具;设计独立成文,见 `packages/vibeguard/DESIGN.md`)。前两者按投影 key 解耦:stats-line 只认 `'sessionCost'` 这个 key 和视图形状(防御性校验),不 import session-cost 的代码;session-cost 不知道谁在消费它。本文记录持久的设计决策;临时状态(本机安装、待办)在本地的 HANDOFF.md(不进 git)。与代码冲突时以代码为准。

## Stats line:slot shadowing

官方 StatsLine 注册在 `conversation.composer.dock` 槽位(`id: "stats"`, priority 0)。本插件注册同 id、priority **-1**——"最低 priority 渲染,同 id 同 priority 才冲突";本组件崩溃时 abdicate,官方条目自动接管,shadow 自带回退。数据源与官方一致(`sessionStats`/`tokenUsage` 投影优先,窗口节点折叠兜底),折叠算法复制自 `dsh-client-ui-conversation`,DSH 大版本改节点结构时需同步。

## 会话费用:sessionCost 投影

宿主端注册纯函数投影(init/apply/view,零副作用零网络),注册表(dsh-session-projection)负责实时驱动、冷读折叠、checkpoint 写盘。**0.1.1 起注册表只把带 `wire` 的投影视图发给浏览器**(snapshot/viewCheckpoint/restore/drive 全路径跳过无 wire 的单元)——自定义投影必须显式带 `wire: { viewSchema, view }`,否则 `useProjection` 在浏览器端恒为 undefined(0.1.0 无此闸门,升级到 0.1.1 后曾导致价格不显示)。

- 事件:`request/header` 记 provider/model;`assistant/chunk`(type=usage)与 `assistant/message`(带 usage)取用量;逐步样本表按 `(turn, step)` 去重,同 key 新样本先减旧再加,与事件交错顺序无关。
- view = token 总量 + cost + `pricing` + `partial` + `currency`,客户端据此渲染:**`≈` 是唯一的非精确标记**——metered 精确金额;subscription(有刊例价)/mixed 加 ≈;unknown 只在全无可计费样本时独占 pricing(不显示)。有已知费用同时存在未知路由用量时 `partial: true`,客户端加 ≈(金额是已知部分的下限,不因未知路由整体隐藏真数)。`currency` 由宿主端解析并随 view 下发——浏览器端启动图不携带 config,投影 view 是唯一的下发通道。

## 汇率:显示侧三级解析

汇率只影响显示(view 时换算),不进投影 state,因此在线取数不破坏重放确定性;投影单元本身保持零网络,取数在宿主 `apply` 生命周期里。优先级:**显式 `exchangeRate` 覆盖(钉死/离线)> 在线查询(frankfurter.dev,启动即刷 + 每日,经 `CurrencyHolder` 被 view 实时读取)> 内置表兜底**。非 USD 币种的换算始终是参考汇率口径。

## 声明式配置:两个 settings 命名空间

两个包各拥有一个 settings 命名空间,按用户面对的功能域命名,不用包名:**stats-line**(组件序列 `items` + `css`,dsh-stats-line)与 **session-cost**(`currency`/`exchangeRate`/`decimals`/`symbol`,dsh-session-cost)。共同的机制:值分层 **schemastery schema 默认(哨兵)< loader 行 config(base 层)< 用户层**;用户在 设置 → 插件 的卡片里编辑(`settings.plugin.item`,key = 命名空间),或直接编辑 `settings.yaml`,经 `settingsScope` 实时生效,不落盘重启。哨兵值(空串/0/-1)表示"未设置",回落到下一层。宿主端消费走 `ctx.inject(['settings'])` + **try/catch**(存量段落非法时 register 抛错,回落 base,GUI 卡片自动隐藏)。

stats-line 的用户面是**组件序列**:内置数据组件(`counts`/`llm`/`tools`/`ttft`/`tps`/`ttftLast`/`tpsLast`/`tokens`/`cost`)。`ttft`/`tps` 显示**最近一轮为主、括号带窗口平均**(`0.9s (1.2s)`)——最近值反映当前服务状况,平均值当基线;最近读数不可得(投影路径/窗口折叠)退回纯平均。`*Last` 是纯最近变体。最近读数始终从窗口节点读取——sessionStats 投影不含逐步数据)、分隔符(`sep`,small '·' / big '|')与自定义模板组件(`custom`,`{placeholder}` 插值,占位符为预格式化显示值)。数据不可得的组件不渲染(包括未装 session-cost 时的 cost),**分隔符自动收敛**(边缘删除、相邻留大)——这就是声明式的条件显隐;设置 GUI 里的卡片是可拖拽编排器(拖动排序、点分隔符切大小),带示例数据实时预览。`css` 是高级区逃生舱。边界纪律:自定义模板只插值、无逻辑语法;新组件种类去改 client。

币种曾是 stats-line cost 组件项的属性;拆包后归还给费用数据的 owner(session-cost 命名空间)——消费方(stats-line)不该拥有数据源的显示配置。session-cost 宿主端从自己的命名空间驱动汇率解析(scope.watch → 即时重解析,见上节),解析结果随 view 下发,消费方无需 config 通道。

## 计价模型:provider + 时代(eras)

`PROVIDERS` 表(src/index.ts)按 provider 分类:

- **metered**(如 deepseek-official、openai):按 token 计费,`cost = (input×cacheMiss + output×output + cacheRead×cacheHit + cacheWrite×cacheWrite) / 1M`,reasoning 不重复计;`cacheWrite` 价档缺省 = `cacheHit`(DeepSeek/Kimi 口径:写缓存不另收费),OpenAI/Anthropic 风格"写读不同价"的价表必须显式给出该档。可选 `longContext` 档:单次请求 prompt ≥ threshold 时整档换价(OpenAI ≥272K);服务档(Batch/Flex/Fast)事件流不可见,metered 一律按 Standard 刊例。
- **subscription**(如 kimi-coding、opencode-go):包月端点;官方有 API 刊例价的配参考价表,cost 是"按刊例价值多少"的估算,不是真实账单。
- **unknown**:不认识的 provider/模型/无时代覆盖的时刻,cost 恒 0。**禁止跨 provider 价格回退**——宁可不显示,不算错数。

**价格带日期**:每个 provider 的 `eras` 按 `since` 升序,历史事件永远按事件发生时刻生效的时代计费。官方调价 = 末尾追加一个时代(不改旧时代)+ bump `stateVersion`(否则旧 checkpoint 带旧价续算)。

## 时区纪律

时代边界(`since`/`until`)用绝对时刻(ISO 带时区或 epoch ms)。峰谷窗口是 **UTC 小时**半开区间(比较走 `getUTCHours()`,与运行机器时区无关)。官方价目表按其他时区声明时(DeepSeek 用北京时间),源码写官方小时数并用 `toUtcWindows(windows, offset)` 显式换算,注释保留原始声明。

## 构建与分发

- pnpm workspace(`packages/*`),每包独立 rolldown 三产物:host ESM(zod 等外置)、共享纯函数 ESM(session-cost 的 currency / stats-line 的 format,client 内联 + Node 测试复用)、client CJS(`__ModuleLoader__` 工厂包装由 banner/footer 生成,react 外置)。
- **dist/ 提交进 git**:`github:` 安装源没有构建环节,dist 就是安装产物。CI 用 `git diff --exit-code 'packages/*/dist/'` 防漂移;`.gitattributes` 标 generated 折叠 diff。若将来发 npm,则撤回此策略(dist 改进 npm 包)。注意:`github:` spec 不支持子目录——monorepo 后正式分发走 npm(或 gitpkg),pre-release 期继续 `link:` 本地安装。
- 发布 = 打 tag(每包独立:`<pkg>-vX.Y.Z`)。chezmoi 脚本(dotfiles 仓库)钉安装声明,是唯一安装声明层;升级以 dotfiles commit 形式接受审查。
- client 改动可 HMR(profile 为 link: 时 build 即生效);host/配置改动需重启 `dsh web`。

## 已知限制

- 价表硬编码,无官方同步;stats-line 客户端装了 dsh-cost-meter 时仍自动优先其 `costUsage` 投影。
- 在线汇率刷新后,客户端要到下一次投影变更/刷新页面才看到新汇率(view 无独立推送);离线时回退内置表(2026-08 参考值,会漂移)。
- 远期方向:provider registry——第三方插件向 stats-line 注册自己的投影组件(服务注册表 + items 的 provider 逃生种类),stats-line 从"一个显示条"变成"迷你平台";session-cost 是它的第一个 provider 形态。
