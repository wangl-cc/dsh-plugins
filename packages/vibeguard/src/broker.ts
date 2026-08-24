/**
 * secret_exec:broker 工具——长得像 bash,但能解析占位符。
 *
 * 存在的理由:DSH 把工具参数设计成"先落日志+呈现,再深冻结",公开 API
 * 不存在改写别的工具参数的通道("arguments are already logged and
 * presented")。所以还原不做成隐形改写,而做成本工具的**声明语义**:
 * 日志如实记录带占位符的命令,替换只发生在本子进程的内存里。
 *
 * 安全性质:
 *  - 真值从 map 映射(engine.resolve)查出后只存在于子进程内存,不进
 *    上下文、不进日志;日志/审批界面看到的是带占位符的命令;
 *  - 子进程环境做与 dsh-subprocess 同款的凭据 scrub(剥掉
 *    KEY|PASSWORD|SECRET|TOKEN 形状与 DSH_ 前缀),防 `env` 侧漏;
 *  - 输出双重脱敏:先把本次用到的真值**直接**换回占位符(不依赖规则
 *    命中),再过引擎兜其他秘密;
 *  - 未知占位符 → 拒绝执行,提示模型向用户要真值。
 */
import { spawn } from 'node:child_process'
import { PLACEHOLDER_PATTERN, type Engine } from './engine'

/** 与 dsh-subprocess 的 scrubbedParentEnv 同规则:凭据形状与 DSH_ 前缀不下发。 */
const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i

function scrubbedEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (SENSITIVE_ENV_PATTERN.test(key)) continue
    if (key.toUpperCase().startsWith('DSH_')) continue
    env[key] = value
  }
  return env
}

export interface SecretExecConfig {
  defaultTimeoutMs: number
  maxOutputChars: number
}

export interface BrokerDeps {
  engine: Engine
  config: SecretExecConfig
  /** engine.redact 产生的新映射需要落盘;由 index.ts 注入。 */
  persist: (redactions: { placeholder: string; value: string; name: string; isNew: boolean }[]) => void
}

/** 本地最小 exec 视图(只需要取消信号)。 */
interface ExecLike {
  signal?: AbortSignal
}

interface SecretExecArgs {
  command: string
  timeoutMs?: number
  workdir?: string
}

export interface SecretExecValue {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  /** 本次解析掉的占位符(审计用;占位符本身不是秘密)。 */
  resolved: string[]
}

/** 值里可能含替换模式特殊字符($& 等),用函数式替换保证字面语义。 */
function replaceAllLiteral(text: string, search: string, replacement: string): string {
  return text.split(search).join(replacement)
}

async function runCommand(
  command: string,
  args: SecretExecArgs,
  deps: BrokerDeps,
  signal?: AbortSignal,
): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  const timeoutMs = args.timeoutMs ?? deps.config.defaultTimeoutMs
  return new Promise((resolvePromise, reject) => {
    const child = spawn('bash', ['-lc', command], {
      cwd: args.workdir,
      env: scrubbedEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const cap = (s: string): string =>
      s.length > deps.config.maxOutputChars ? s.slice(0, deps.config.maxOutputChars) + '\n[truncated]' : s

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 3000).unref()
    }, timeoutMs)
    timer.unref?.()

    const onAbort = (): void => {
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 3000).unref()
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.on('close', (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolvePromise({ exitCode, stdout: cap(stdout), stderr: cap(stderr), timedOut })
    })
  })
}

/**
 * 构造 secret_exec 的 ToolDefinition(本地最小结构;字段与 dsh-tools 的
 * ToolDefinition 对齐:name/description/parameters/output/execute)。
 */
export function createSecretExecTool(deps: BrokerDeps): Record<string, unknown> {
  return {
    name: 'secret_exec',
    description:
      'Run a shell command that needs the real value of redacted secrets. ' +
      'Write __REDACTED_<NAME>_<hash>__ placeholders in the command; they are resolved to real values in ' +
      'subprocess memory at execution time and never enter the conversation. Command output is redacted ' +
      'before returning. Unknown placeholders fail the call — ask the user for the value instead.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command, may contain __REDACTED_*__ placeholders.' },
        timeoutMs: { type: 'number', description: 'Timeout in milliseconds.' },
        workdir: { type: 'string', description: 'Working directory for the command.' },
      },
      required: ['command'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          exitCode: { type: ['number', 'null'] },
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          timedOut: { type: 'boolean' },
          resolved: { type: 'array', items: { type: 'string' } },
        },
        required: ['exitCode', 'stdout', 'stderr', 'timedOut', 'resolved'],
      },
      render: (_args: unknown, value: unknown) => {
        const v = value as SecretExecValue
        const parts = [v.stdout]
        if (v.stderr) parts.push(`[stderr]\n${v.stderr}`)
        parts.push(v.timedOut ? '[timed out]' : `[exit ${v.exitCode}]`)
        return [{ type: 'text', text: parts.filter(Boolean).join('\n') }]
      },
    },
    async execute(rawArgs: unknown, exec: ExecLike): Promise<SecretExecValue> {
      const args = rawArgs as SecretExecArgs
      if (typeof args.command !== 'string' || args.command.length === 0) {
        throw new Error('secret_exec: command must be a non-empty string')
      }

      // 解析占位符;任何一个未知都整体拒绝。
      const found = [...new Set(args.command.match(PLACEHOLDER_PATTERN) ?? [])]
      const pairs: Array<[string, string]> = []
      const unknown: string[] = []
      for (const ph of found) {
        const value = deps.engine.resolve(ph)
        if (value === undefined) unknown.push(ph)
        else pairs.push([ph, value])
      }
      if (unknown.length > 0) {
        throw new Error(
          `secret_exec: unknown placeholder(s): ${unknown.join(', ')} — they do not exist in the redaction map; ask the user for the real value or re-check the placeholder`,
        )
      }

      let command = args.command
      for (const [ph, value] of pairs) command = replaceAllLiteral(command, ph, value)

      const result = await runCommand(command, args, deps, exec.signal)

      // 输出双脱敏:先换回本次用到的真值,再过引擎。
      const re = (text: string): string => {
        let out = text
        for (const [ph, value] of pairs) out = replaceAllLiteral(out, value, ph)
        const r = deps.engine.redact(out)
        if (r.redactions.length > 0) deps.persist(r.redactions)
        return r.text
      }

      return { ...result, stdout: re(result.stdout), stderr: re(result.stderr), resolved: found }
    },
  }
}
