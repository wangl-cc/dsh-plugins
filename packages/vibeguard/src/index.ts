/**
 * dsh-vibeguard host half:写日志前脱敏,出境前兜底。
 *
 * 四个事件钩子 + broker 工具 + 一段常驻系统提示词:
 *  - tools/post-execute:工具结果提交会话日志前,替换 content 文本块里
 *    的秘密(LLM 请求是会话日志的纯函数且深冻结,这是唯一的拦截点);
 *  - agent/pre-step:用户消息(粘贴的 key 不经过工具)进入 step 前替换;
 *  - tools/pre-execute:敏感路径访问控制(deny,字段感知见 guard.ts),
 *    以及 secret_exec 的 ask 审批门槛;
 *  - session-telemetry/record:第二条出境通道(遥测后端)的兜底重扫;
 *  - secret_exec(broker.ts):唯一的还原出口,按会话解析占位符;
 *  - systemPrompt.section:告知模型占位符语义。
 *
 * 另挂 tools/code-dispatch-log:run_code 子调用的持久化日志副本走独立
 * waterfall,不拦它,子调用输出里的秘密会绕过 post-execute 落进日志。
 *
 * 作用域与映射:tools/* 与 agent/* 事件是 scope 过滤派发,root 上下文
 * 监听可收所有 agent。映射按会话分桶(engine.ts):各挂点从
 * exec.agent.id / payload.agent.id / dispatch.agent?.id 取会话标识;
 * 拿不到的(遥测兜底)进匿名桶,脱敏生效但永不解析(fail-closed)。
 * 占位符本身是全局纯函数(HMAC 持久 key),跨会话稳定与去重不受影响。
 */
import os from 'node:os'
import path from 'node:path'
import { ConfigSchema, type PluginConfig } from './config'
import { createSecretExecTool } from './broker'
import { findDeniedPath } from './guard'
import { compileRules, createEngine, type AppliedRedaction, type Engine, type RedactResult } from './engine'
import { BUILTIN_RULES, OPTIONAL_RULES } from './patterns'
import { defaultStorePaths, loadOrCreateKey, type StorePaths } from './store'

export const name = 'vibeguard'
/** 本地最小 Cordis 类型(与 monorepo 各包同风格,不依赖类型包)。 */
export interface CordisContext {
  on(event: string, listener: (...args: never[]) => unknown): void
  inject(services: string[], callback: (ctx: CordisContext & Record<string, unknown>) => void): void
  effect?(fn: () => () => void): void
}

interface TextLikeBlock {
  type: string
  text?: unknown
  [key: string]: unknown
}

interface MessageLike {
  readonly id: string
  readonly role: string
  readonly content: TextLikeBlock[]
  readonly source: unknown
}

interface AgentLike {
  readonly id: string
}

interface ToolExecutionLike {
  readonly name: string
  readonly arguments: unknown
  readonly agent?: AgentLike
}

interface ToolResultLike {
  readonly isError: boolean
  readonly content: TextLikeBlock[]
}

const PROMPT_SECTION = `Some text in this conversation may contain redacted secrets as placeholders of the form \`__REDACTED_<NAME>_<hash>__\` (e.g. \`__REDACTED_API_KEY_3f9a1c2b4d5e__\`), produced by a local redaction layer before content is logged. Rules: (1) never try to guess, reconstruct, or invent the original value of a placeholder; (2) the same placeholder always refers to the same secret, across turns and sessions; (3) placeholders are resolvable only within the live session whose traffic actually contained the secret — after a restart they are permanently unresolvable, and placeholders quoted from other sessions or old logs will not resolve either.`

const PROMPT_SECTION_BROKER = ` When a shell command genuinely needs the real value of a redacted secret, use the secret_exec tool with the placeholder in the command: it resolves placeholders from this session's in-memory map in subprocess memory at execution time (the user may be asked to approve each call) and redacts output before returning. If a placeholder does not resolve, ask the user to paste the value again — do not work around it.`

const INLINE_NOTICE = (count: number): string =>
  `\n[dsh-vibeguard: redacted ${count} secret value(s) above into __REDACTED_*__ placeholders; never guess or reconstruct their originals — ask the user when a real value is required]`

function expandDenyPaths(denyPaths: string[]): string[] {
  const home = os.homedir()
  const expanded: string[] = []
  for (const p of denyPaths) {
    expanded.push(p)
    if (p === '~' || p.startsWith('~/')) expanded.push(path.join(home, p.slice(1)))
  }
  return expanded
}

export function apply(ctx: CordisContext, rawConfig?: PluginConfig): void {
  const config = ConfigSchema.parse(rawConfig ?? {})
  if (!config.enabled) return

  const disabled = new Set(config.disabledBuiltinRules)
  const optionalEnabled = new Set(config.enabledOptionalRules)
  const rules = compileRules([
    ...config.rules,
    ...OPTIONAL_RULES.filter((rule) => optionalEnabled.has(rule.name)),
    ...BUILTIN_RULES.filter((rule) => !disabled.has(rule.name)),
  ])

  const paths: StorePaths = defaultStorePaths()
  const engine: Engine = createEngine(rules, loadOrCreateKey(paths))

  /** 脱敏一组 content 块;未命中返回 null(调用侧走 next() 保持原样)。 */
  const redactBlocks = (
    content: TextLikeBlock[],
    session?: string,
  ): { blocks: TextLikeBlock[]; count: number } | null => {
    let changed = false
    const all: AppliedRedaction[] = []
    const blocks = content.map((block) => {
      if (typeof block.text !== 'string' || block.text.length === 0) return block
      const result: RedactResult = engine.redact(block.text, session)
      if (result.redactions.length === 0) return block
      changed = true
      all.push(...result.redactions)
      return { ...block, text: result.text }
    })
    if (!changed) return null
    return { blocks, count: new Set(all.map((r) => r.placeholder)).size }
  }

  // 工具结果:写日志前替换。
  ctx.on('tools/post-execute', (async (exec: ToolExecutionLike, result: ToolResultLike, next: () => Promise<unknown>) => {
    const redacted = redactBlocks(result.content, exec.agent?.id)
    if (redacted === null) return next()
    const content = config.inlineNotice
      ? [...redacted.blocks, { type: 'text', text: INLINE_NOTICE(redacted.count) }]
      : redacted.blocks
    return { kind: 'accept', content }
  }) as never)

  // run_code 子调用的日志副本。
  ctx.on('tools/code-dispatch-log', (async (
    dispatch: { agent?: AgentLike; exec?: ToolExecutionLike },
    next: () => Promise<TextLikeBlock[]>,
  ) => {
    const content = await next()
    const redacted = redactBlocks(content, dispatch.agent?.id ?? dispatch.exec?.agent?.id)
    return redacted === null ? content : redacted.blocks
  }) as never)

  // 用户消息:进入 step 前替换。
  ctx.on('agent/pre-step', (async (
    payload: { agent?: AgentLike; messages: MessageLike[] },
    next: () => Promise<unknown>,
  ) => {
    if (!config.redactUserMessages) return next()
    let changed = false
    const messages = payload.messages.map((message) => {
      const redacted = redactBlocks(message.content, payload.agent?.id)
      if (redacted === null) return message
      changed = true
      return { ...message, content: redacted.blocks }
    })
    if (!changed) return next()
    return { kind: 'enter', messages }
  }) as never)

  // 敏感路径访问控制(字段感知,见 guard.ts)+ secret_exec 审批门槛。
  const denyList = expandDenyPaths(config.denyPaths)
  ctx.on('tools/pre-execute', (async (exec: ToolExecutionLike, next: () => Promise<unknown>) => {
    const denied = findDeniedPath(exec.arguments, denyList)
    if (denied !== undefined) {
      return { kind: 'deny', reason: `dsh-vibeguard: access to sensitive path denied (${denied})` }
    }
    // broker 工具默认每次执行都要用户点头(approval 策略为 never 时自动拒绝)。
    if (exec.name === 'secret_exec' && config.secretExec.requireApproval) {
      return {
        kind: 'ask',
        reason: 'dsh-vibeguard: secret_exec resolves redacted placeholders to real secret values in a subprocess',
      }
    }
    return next()
  }) as never)

  // broker 工具:按会话解析占位符执行命令。
  if (config.secretExec.enabled) {
    ctx.inject(['tools'], (injected) => {
      const tools = injected.tools as { register(def: Record<string, unknown>): () => void } | undefined
      if (tools === undefined) return
      const tool = createSecretExecTool({ engine, config: config.secretExec })
      if (typeof injected.effect === 'function') injected.effect(() => tools.register(tool))
      else tools.register(tool)
    })
  }

  // 遥测出站兜底:深度遍历 JSON,字符串值过引擎。拿不到会话身份,进匿名桶。
  ctx.on('session-telemetry/record', ((record: Record<string, unknown>, next: () => Record<string, unknown>) => {
    const current = next()
    let changed = false
    const walk = (value: unknown): unknown => {
      if (typeof value === 'string') {
        const result = engine.redact(value)
        if (result.redactions.length === 0) return value
        changed = true
        return result.text
      }
      if (Array.isArray(value)) return value.map(walk)
      if (value !== null && typeof value === 'object') {
        const source = value as Record<string, unknown>
        const out: Record<string, unknown> = {}
        for (const key of Object.keys(source)) out[key] = walk(source[key])
        return out
      }
      return value
    }
    const next2 = walk(current) as Record<string, unknown>
    return changed ? next2 : current
  }) as never)

  // 常驻提示词:告知模型占位符语义。
  ctx.inject(['systemPrompt'], (injected) => {
    const systemPrompt = injected.systemPrompt as
      | { section(section: { name: string; order: number; text: string }): () => void }
      | undefined
    if (systemPrompt === undefined) return
    const register = (): (() => void) =>
      systemPrompt.section({
        name: 'vibeguard-redaction',
        order: 150,
        text: PROMPT_SECTION + (config.secretExec.enabled ? PROMPT_SECTION_BROKER : ''),
      })
    if (typeof injected.effect === 'function') injected.effect(register)
    else register()
  })
}
