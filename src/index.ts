/**
 * dsh-vibeguard host half:写日志前脱敏,出境前兜底。
 *
 * 四个事件钩子 + 一段常驻系统提示词:
 *  - tools/post-execute:工具结果提交会话日志前,替换 content 文本块里
 *    的秘密(LLM 请求是会话日志的纯函数且深冻结,这是唯一的拦截点);
 *  - agent/pre-step:用户消息(粘贴的 key 不经过工具)进入 step 前替换;
 *  - tools/pre-execute:敏感路径访问控制(deny),唯一的语义拦截点;
 *    参数改写在 DSH 公开 API 里不存在,故本插件不做运行期还原;
 *  - session-telemetry/record:第二条出境通道(遥测后端)的兜底重扫;
 *  - systemPrompt.section:告知模型占位符语义(禁止猜测原值、同占位符
 *    恒同值、需真值请用户提供或用 env 间接引用)。
 *
 * 另挂 tools/code-dispatch-log:run_code 子调用的持久化日志副本走独立
 * waterfall,不拦它,子调用输出里的秘密会绕过 post-execute 落进日志。
 *
 * 作用域:tools/* 与 agent/* 事件是 scope 过滤派发,root 上下文监听可收
 * 所有 agent(与 dsh-tool-call-timeout-policy 同模式)。映射存储是全局
 * 单文件,不按会话分片(内容寻址使分片失去意义)。
 */
import os from 'node:os'
import path from 'node:path'
import { ConfigSchema, type PluginConfig } from './config'
import { compileRules, createEngine, type AppliedRedaction, type Engine, type RedactResult } from './engine'
import { BUILTIN_RULES } from './patterns'
import { appendMappings, defaultStorePaths, loadMappings, loadOrCreateKey, type StorePaths } from './store'

export const name = 'vibeguard'

/** 本地最小 Cordis 类型(与 dsh-stats-compact 同风格,不依赖类型包)。 */
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

interface ToolExecutionLike {
  readonly name: string
  readonly arguments: unknown
}

interface ToolResultLike {
  readonly isError: boolean
  readonly content: TextLikeBlock[]
}

const PROMPT_SECTION = `Some text in this conversation may contain redacted secrets as placeholders of the form \`__REDACTED_<NAME>_<hash>__\` (e.g. \`__REDACTED_API_KEY_3f9a1c2b4d5e__\`), produced by a local redaction layer before content is logged. Rules: (1) never try to guess, reconstruct, or invent the original value of a placeholder; (2) the same placeholder always refers to the same secret, across turns and sessions; (3) when a command or file genuinely needs the real secret, ask the user to provide it, or prefer indirection that keeps the secret out of the conversation (e.g. referencing an environment variable like \`$NAME\` in shell commands).`

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
  const rules = compileRules([...config.rules, ...BUILTIN_RULES.filter((rule) => !disabled.has(rule.name))])

  const paths: StorePaths = defaultStorePaths()
  const engine: Engine = createEngine(rules, loadOrCreateKey(paths), loadMappings(paths))

  const persist = (redactions: AppliedRedaction[]): void => {
    const fresh = redactions.filter((r) => r.isNew)
    if (fresh.length > 0) appendMappings(paths, fresh)
  }

  /** 脱敏一组 content 块;未命中返回 null(调用侧走 next() 保持原样)。 */
  const redactBlocks = (content: TextLikeBlock[]): { blocks: TextLikeBlock[]; count: number } | null => {
    let changed = false
    const all: AppliedRedaction[] = []
    const blocks = content.map((block) => {
      if (typeof block.text !== 'string' || block.text.length === 0) return block
      const result: RedactResult = engine.redact(block.text)
      if (result.redactions.length === 0) return block
      changed = true
      all.push(...result.redactions)
      return { ...block, text: result.text }
    })
    if (!changed) return null
    persist(all)
    return { blocks, count: new Set(all.map((r) => r.placeholder)).size }
  }

  // 工具结果:写日志前替换。
  ctx.on('tools/post-execute', (async (exec: ToolExecutionLike, result: ToolResultLike, next: () => Promise<unknown>) => {
    const redacted = redactBlocks(result.content)
    if (redacted === null) return next()
    const content = config.inlineNotice
      ? [...redacted.blocks, { type: 'text', text: INLINE_NOTICE(redacted.count) }]
      : redacted.blocks
    return { kind: 'accept', content }
  }) as never)

  // run_code 子调用的日志副本。
  ctx.on('tools/code-dispatch-log', (async (_dispatch: unknown, next: () => Promise<TextLikeBlock[]>) => {
    const content = await next()
    const redacted = redactBlocks(content)
    return redacted === null ? content : redacted.blocks
  }) as never)

  // 用户消息:进入 step 前替换。
  ctx.on('agent/pre-step', (async (
    payload: { messages: MessageLike[] },
    next: () => Promise<unknown>,
  ) => {
    if (!config.redactUserMessages) return next()
    let changed = false
    const messages = payload.messages.map((message) => {
      const redacted = redactBlocks(message.content)
      if (redacted === null) return message
      changed = true
      return { ...message, content: redacted.blocks }
    })
    if (!changed) return next()
    return { kind: 'enter', messages }
  }) as never)

  // 敏感路径访问控制。
  const denyList = expandDenyPaths(config.denyPaths)
  ctx.on('tools/pre-execute', (async (exec: ToolExecutionLike, next: () => Promise<unknown>) => {
    let haystack = ''
    try {
      haystack = JSON.stringify(exec.arguments ?? null)
    } catch {
      haystack = ''
    }
    for (const denied of denyList) {
      if (haystack.includes(denied)) {
        return { kind: 'deny', reason: `dsh-vibeguard: access to sensitive path denied (${denied})` }
      }
    }
    return next()
  }) as never)

  // 遥测出站兜底:深度遍历 JSON,字符串值过引擎。
  ctx.on('session-telemetry/record', ((record: Record<string, unknown>, next: () => Record<string, unknown>) => {
    const current = next()
    let changed = false
    const walk = (value: unknown): unknown => {
      if (typeof value === 'string') {
        const result = engine.redact(value)
        if (result.redactions.length === 0) return value
        changed = true
        persist(result.redactions)
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
    const register = (): (() => void) => systemPrompt.section({ name: 'vibeguard-redaction', order: 150, text: PROMPT_SECTION })
    if (typeof injected.effect === 'function') injected.effect(register)
    else register()
  })
}
