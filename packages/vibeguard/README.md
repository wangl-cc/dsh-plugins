# dsh-vibeguard

DSH(DeepSeek Harness)宿主端插件:在秘密写入会话日志**之前**替换为内容寻址占位符,让 LLM 和遥测永远只见占位符,真值只留在本机。

```
sk-kimi-WFek…  →  __REDACTED_GENERIC_API_KEY_3f9a1c2b4d5e__
```

## 工作原理

- **占位符是内容的纯函数**:`__REDACTED_<NAME>_<hmac12>__`,hmac12 = HMAC-SHA256(进程随机密钥, 原文) 前 12 位 hex。进程期内同一秘密在任何会话都是同一占位符;**重启后所有历史占位符永久失联**(不可兑现、不可关联)——知情接受的代价,换来零磁盘状态。
- **拦截点**:`tools/post-execute`(工具结果)、`agent/pre-step`(用户消息)、`tools/code-dispatch-log`(run_code 子调用日志)、`session-telemetry/record`(遥测兜底);`tools/pre-execute` 提供字段感知的路径 deny(默认空列表,纯用户策略入口——插件零磁盘状态,没有需要自保护的文件)。
- **告知模型**:注册一段常驻系统提示词,说明占位符语义(禁止猜测原值、同占位符恒同值、只在真值流经过的活会话里可兑现)。
- **会话作用域还原**:映射只在内存里按会话分桶,进程死即蒸发;占位符可兑现 ⟺ 真值在本会话、本进程里真实流经过。模型需要**用**真值执行命令时走 `secret_exec`(见下)。

## secret_exec(broker 工具)

DSH 不允许改写已落账的工具参数("arguments are already logged and presented"),所以还原不做成隐形改写,而做成本工具的**声明语义**:

```json
{ "command": "curl -H 'Authorization: Bearer __REDACTED_GENERIC_API_KEY_…__' https://api.example.com" }
```

占位符在**子进程内存里**换成真值执行;日志和审批界面看到的仍是占位符;输出先把用过的真值换回占位符、再过引擎兜其他秘密。解析只查**本会话**的内存桶:从旧日志或别的会话抄来的占位符、重启后的占位符一律 fail-closed(提示请用户重贴);拿不到会话身份的调用直接拒绝。子进程环境做与 dsh-subprocess 同款的凭据 scrub(`KEY|PASSWORD|SECRET|TOKEN` 形状与 `DSH_` 前缀不下发),防 `env` 侧漏。

默认每次执行走 ask 审批(`secretExec.requireApproval`);approval 策略为 never 时即默认拒绝。审计:日志里留着带占位符的命令,可兑现性本身即"该秘密在本会话出现过"的证明。

设计决策与架构约束的完整论证见 [DESIGN.md](DESIGN.md)。

## 安装

```bash
dsh plugin --profile web add <本仓库路径>   # 开发期本地 link
# 重启 dsh web 生效(host 插件无 HMR)
```

## Config(loader 行,见 cordis.patch.yml)

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `rules` | `[]` | 自定义规则 `[{name, pattern, flags?, group?, minLength?}]`,排在内置规则之前,首条命中生效 |
| `disabledBuiltinRules` | `[]` | 按 name 关闭内置规则 |
| `enabledOptionalRules` | `[]` | 按 name 启用可选规则(PII 类,默认关闭) |
| `denyPaths` | `[]` | 额外 deny 的敏感路径(`~` 展开;字段感知匹配,默认空) |
| `redactUserMessages` | `true` | 是否脱敏用户消息 |
| `inlineNotice` | `true` | 脱敏后 tool 结果尾部是否附标记 |
| `secretExec` | 见下 | broker 工具:`{enabled: true, requireApproval: true, defaultTimeoutMs: 120000, maxOutputChars: 200000}` |

**可选规则(默认关闭)**:`PII_CN_ID`(中国大陆身份证号,带 GB 11643 校验位验证)、`PII_CN_PHONE`(大陆手机号)。PII 与凭据风险类别不同——长数字 pattern 会误伤时间戳/随机 ID,且脱敏不可还原;如果这类数据正是你的工作内容,不要开。邮箱不收(git log 每条提交都带,误报无药可救)。

```yaml
enabledOptionalRules: [PII_CN_ID, PII_CN_PHONE]
```

规则示例:

```yaml
rules:
  - name: OPENAI_API_KEY
    pattern: sk-[a-zA-Z0-9]{40,}
```

`name` 限 `[A-Z0-9_]{2,24}`(zod 校验,非法即报错);`group: 1` 表示只脱敏第一个捕获组(保留 `password=` 这类键名语境);`minLength` 剥离引号后计,短值跳过降噪。

## 存储

**零磁盘状态。** HMAC key 与映射都只活在进程内存里:key 在启动时 `randomBytes(32)` 生成,映射按会话分桶,进程死即全部蒸发。磁盘上没有可偷的秘密材料——key 不落地,字典验证威胁连理论路径都不存在。

代价(知情接受):重启后所有历史占位符永久失联——不可兑现,也不再有"重贴同秘密 → 同占位符复活"的关联性质。旧日志里的占位符就是一次性符号。

## 开发

```bash
pnpm build      # src/*.ts → dist/
pnpm test       # 自动先 build
pnpm typecheck  # tsc --noEmit
```

`dist/` 不进 git;将来发 npm(scoped 包)时由 `prepack` 构建进 tarball。
