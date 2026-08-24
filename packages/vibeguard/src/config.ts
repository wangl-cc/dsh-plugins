/**
 * 插件 config 的 zod schema。loader 行(cordis.patch.yml)携带的 config
 * 经此解析;非法配置(尤其非法规则名/正则 flags)在挂载时直接报错,
 * 不做静默降级。
 */
import { z } from 'zod'

/** 规则名:进入占位符文本,必须可被查找正则稳定解析。 */
export const NAME_PATTERN = /^[A-Z0-9_]{2,24}$/

export const RuleSchema = z.object({
  name: z.string().regex(NAME_PATTERN, 'rule name must match [A-Z0-9_]{2,24}'),
  pattern: z.string().min(1),
  /** 引擎自行追加 g;这里只允许 imsu y。 */
  flags: z
    .string()
    .regex(/^[imsuy]*$/, 'flags may only contain i m s u y (g is added by the engine)')
    .optional(),
  /** 0 = 整个 match 是秘密;>0 = 第 N 个捕获组。 */
  group: z.number().int().min(0).max(9).default(0),
  /** 剥离引号后的最小值长度,短的跳过(降噪)。 */
  minLength: z.number().int().min(0).default(0),
})

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** 用户自定义规则,排在内置规则之前(首条命中生效)。 */
  rules: z.array(RuleSchema).default([]),
  /** 按 name 关闭内置规则。 */
  disabledBuiltinRules: z.array(z.string()).default([]),
  /** 按 name 启用可选规则(默认关闭的 PII 类,见 src/patterns.ts OPTIONAL_RULES)。 */
  enabledOptionalRules: z.array(z.string()).default([]),
  /** 额外 deny 的敏感路径(子串匹配目标参数字段,~ 会展开为 home)。
   *  默认空:~/.dsh/redaction/ 的自我保护是硬编码不变量,其余内容形状
   *  均被规则覆盖,路径级策略留给用户按需配置。 */
  denyPaths: z.array(z.string()).default([]),
  /** 是否脱敏用户消息(agent/pre-step)。 */
  redactUserMessages: z.boolean().default(true),
  /** 脱敏后的 tool 结果尾部是否附 inline 标记。 */
  inlineNotice: z.boolean().default(true),
  /** broker 工具 secret_exec:解析占位符执行命令。requireApproval = 每次执行走 ask 审批。 */
  secretExec: z
    .object({
      enabled: z.boolean().default(true),
      requireApproval: z.boolean().default(true),
      defaultTimeoutMs: z.number().int().positive().default(120000),
      maxOutputChars: z.number().int().positive().default(200000),
    })
    .default({ enabled: true, requireApproval: true, defaultTimeoutMs: 120000, maxOutputChars: 200000 }),
})

export type PluginConfig = z.input<typeof ConfigSchema>
export type ResolvedConfig = z.output<typeof ConfigSchema>
