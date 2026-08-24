# AGENTS.md

DSH web 插件 monorepo:会话费用投影(session-cost)+ 紧凑 stats line(stats-line,含设置 GUI 的可拖拽组件编排器)。设计决策的完整论证在 DESIGN.md;本文件是架构地图与开发纪律;冲突时以代码为准。

## 仓库布局

```text
packages/
  session-cost/   # dsh-session-cost:计价表 + sessionCost 投影 + 汇率 + session-cost 命名空间 + 设置卡片
    src/index.ts    # host 半(ESM)
    src/currency.ts # 币种解析(resolveCurrency/presets/PluginConfig)
    src/client.ts   # 设置卡片(currency/exchangeRate/decimals/symbol)
  stats-line/     # dsh-stats-line:stats line cell + 组件编排器 + stats-line 命名空间
    src/index.ts    # host 半:settings 命名空间注册(只有配置面)
    src/format.ts   # 共享纯函数:格式化、组件模型(items/renderStatsLineItems)、节点折叠、币种显示
    src/client.ts   # client 半(classic script,React.createElement,无 JSX):cell + 编排卡片
  vibeguard/      # dsh-vibeguard:写日志前密钥脱敏 + secret_exec broker 工具(纯 host,无 client 半)
    src/engine.ts   # 规则编译 + redact(顺序应用)+ 占位符映射(resolve 供 broker)
    src/patterns.ts # 内置规则 + OPTIONAL_RULES(PII 可选层,默认关)
    src/broker.ts   # secret_exec ToolDefinition:占位符→子进程内存替换,输出双脱敏
    src/guard.ts    # 字段感知的敏感路径 deny(findDeniedPath)
    src/store.ts    # ~/.dsh/redaction/ 密钥与 map.jsonl
    src/index.ts    # 接线:5 个 hook + 工具注册 + 提示词段
每包:test/*.mjs 测 dist/ 构建产物,不测 src;dist/ 提交进 git(vibeguard 例外:npm 发布路线,dist 不进 git);cordis.patch.yml 是 loader 行(附 config 文档注释)
根:pnpm-workspace.yaml、共享 CI、DESIGN.md(设计)、本文件(纪律)
```

包间纪律:**stats-line 不 import session-cost 的代码**,只按 key 消费 `sessionCost` 投影并防御性校验视图形状——session-cost 缺席时 cost 组件自动不渲染。两边各自持有的币种解析(currency.ts vs format.ts 显示端)刻意重复;第三个插件需要时再抽 shared 包。

## 架构

两个包四块:**session-cost host**(投影 + 计价 + 汇率)、**session-cost client**(币种设置卡片)、**stats-line host**(配置命名空间)、**stats-line client**(cell + 编排器)。下面按职责分节;配置的两个面(loader config 通道与 settings 命名空间)在最后。

### 会话费用:sessionCost 投影(session-cost host)

回答一个问题:**"这个会话到目前为止值多少钱"**。纯函数投影(init/apply/view,零副作用零网络),注册表(dsh-session-projection)负责实时驱动、冷读折叠、checkpoint 写盘;view 把内部 state(逐步 samples、分类计数)折算成下发表面的 `SessionCostView`(token 总量 + cost + pricing + partial + currency),客户端据此渲染精确金额、≈ 估算或不显示。用哪个价表由 PROVIDERS 表决定(见下节)。

```text
会话事件流 ──drive──> sessionCost 投影(init/apply,纯函数)
                          │ state(provider/model/totals/kinds/samples)
                          ▼ view(state) 每次重算,currency 读 CurrencyHolder
                     SessionCostView = totals + pricing + partial + currency
                          │ wire: { viewSchema, view }(必需,见下)
                          ▼ websocket
                     client useProjection('sessionCost') → 渲染 cost 组件
```

- **wire 是硬要求**:dsh-session-projection 0.1.1 起,注册表只把带 `wire` 的投影视图发给浏览器(snapshot/viewCheckpoint/restore/drive 全路径跳过无 wire 单元)。新加投影不带 wire,客户端 `useProjection` 恒为 undefined,且不报错。回归测试:test/session-cost.mjs 第一条。
- 汇率只影响显示(view 时换算),不进投影 state → 在线取数不破坏重放确定性;投影单元零网络,取数在 host `apply` 生命周期里。
- 计价纪律:**未知 provider/模型一律不计费,禁止跨 provider 价格回退**;subscription 按刊例价估算并加 ≈;`partial`(有未知路由用量)也加 ≈;≈ 是唯一的非精确标记。

### 计价模型:PROVIDERS 表(session-cost host)

```text
PROVIDERS: Record<provider, ProviderEntry>
ProviderEntry = metered(eras) | subscription(label, eras?)
Era         = { since, until?, peakWindows(UTC 小时), models: Record<model, PriceEntry> }   # 追加-only
PriceEntry  = PriceTier { cacheHit, cacheMiss, output, cacheWrite? } + peak? + longContext?  # 整档替换,不叠加
```

- 选择链:`eraFor(provider, 时刻)` → `tierFor(model, 时刻, prompt 大小)` → `rateFor` → `costOf`;计费四桶 input/cacheRead/cacheWrite/output,reasoning 只展示不重复计费。
- `cacheWrite` 缺省 = `cacheHit`(DeepSeek/Kimi 口径:写缓存不另收费);OpenAI/Anthropic 风格写读不同价的价表必须显式给出该档。
- `longContext`(如 OpenAI ≥272K)是单次请求 prompt 超阈值时**整档换价**,与 peak 不组合——目前声明 longContext 的价表没有峰谷,并存需扩展模型。
- subscription 的 eras 是官方 API **刊例价参考表**:cost 是"这些 token 值多少钱"的估算(≈),不是真实账单;无刊例价不计 0 显示。
- 事件侧:`request/header` 记 provider/model;usage(chunk/message)按 `(turn, step)` 样本去重,同 key 新样本先减后加,与流式交错顺序无关。

### loader config 通道(各包 host)

每包 cordis.patch.yml 行 `config`(全可选)是该包 settings 命名空间的 **base 层**:session-cost 收 `PluginConfig`(currency / exchangeRate / decimals / symbol),stats-line 收 `ui` 块(items 数组简写或 `{ items, css }`)。`toBaseDoc` 把 config 合成 base 文档,用户在 GUI/settings.yaml 的编辑覆盖其上,实时生效。每层解析各有一个 schema:zod 解析 loader config(`parseUiConfig` 非法整体回退默认,不半个生效),schemastery 注册 settings(平台 settings 服务只接受 schemastery schema);哨兵值(''/0/-1)表示"未设置",回落到下一层。

### 配置:两个 settings 命名空间

**stats-line** 命名空间的用户定制是**组件序列 items**(内置组件 counts/llm/tools/ttft/tps/tokens/cost + sep 大小分隔符 + custom 模板),不是模板字符串列表;**session-cost** 命名空间持有显示币种(currency/exchangeRate/decimals/symbol——数据源的显示配置归数据 owner,消费方不持有),host 端从它驱动汇率解析(显式钉死 > 在线 frankfurter.dev > 内置表),结果随 view 下发。两命名空间同一机制:值分层 schema 默认(哨兵 ''/0/-1)< loader config(base)< 用户层(GUI/settings.yaml)。

- 渲染规则:数据不可得的组件不渲染;分隔符自动收敛(边缘删除、相邻留大)——声明式条件显隐,无逻辑语法。
- client 读配置走 `settingsScope.bind({namespace:'stats-line'})` + useSyncExternalStore;host 消费走 `settings.register`(**必须 try/catch**:存量段落非法会抛,回退 base,GUI 卡片自动隐藏)。
- 设置卡片(settings.plugin.item,key=命名空间)与第一方卡片同模型:编辑进本地草稿、Save/Discard、卡片自带外壳与样式(第一方 CSS module 是包内私产,不可跨包 import,只能复刻视觉契约)。

### stats line cell

注册在 `conversation.composer.dock`,`id: 'stats'`,priority -1(shadow 官方条目,崩溃 abdicate 时官方自动接管)。组件渲染与卡片预览共用 `buildValues`/`renderStatsLineItems` 同一条代码路径——预览所见即所得。

## 关键规则

- **eras 追加-only**,不改历史时代;计费变更要 bump `stateVersion`。
- 未知 provider/模型一律不计费,禁止跨 provider 价格回退。
- 峰谷窗口用 UTC 小时,官方按其他时区声明时用 `toUtcWindows` 换算。
- 新投影必须带 `wire`;改 view 形状同步改 `sessionCostSchema`。
- **dist/ 提交进 git**,改 src 必须重新 build;CI 检查 dist 新鲜度。
- client 改动能 HMR(profile 为 link: 时 build 即生效);host/配置改动需重启 `dsh web`。
- 发布 = 打 tag 推送,然后更新 chezmoi 脚本里的 tag。

## 开发指南

```bash
pnpm build      # 根目录 pnpm -r:各包 rolldown src/*.ts → dist/
pnpm test       # 各包自动先 build;断言见各包 test/(session-cost / settings / format)
pnpm typecheck  # tsc --noEmit,strict,逐包
```

- **测试测 dist/**:import 从 `../dist/*.js`;`pnpm test` 先 build,保证测的就是线上逻辑。每条的 check 名写明保护的不变量。
- **host 端外部依赖**(zod、@deepseek-ai/dsh-settings、@deepseek-ai/schemastery)在 rolldown.config.js 里声明为 external,由平台供给;不要 bundle 进去。
- **验证平台行为的正确姿势**:读 `~/Library/pnpm/store/.../@deepseek-ai/*/lib/*.js` 编译产物并引用 file:line;client inspect 目录是手写静态清单,不全(如 settingsScope 不在其中但可用)。DSH 升级后要复查平台假设(0.1.1 的 wire 闸门就是教训)。
- **调试浏览器端**:client bundle 无 console 通道时,用动态 Cordis 插件做探针(host-only 免审批;动态工具的 `output.render(args, value)` 第二参才是 execute 结果)。
- 文档纪律:README(用户面,en)、DESIGN.md(设计决策,zh)、本文件(开发纪律)同步更新;Markdown 一段一行。

## Commit

使用 Conventional Commits:`feat:` / `fix:` / `docs:` / `test:` / `build:` / `ci:` / `chore:`。
