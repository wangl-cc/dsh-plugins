import assert from 'node:assert/strict'
import { BUILTIN_RULES, compileRules, createEngine, createSecretExecTool } from '../dist/core.js'

const key = new TextEncoder().encode('test-key-32-bytes-padding-000000')
const config = { defaultTimeoutMs: 120000, maxOutputChars: 200000 }
const persisted = []
const deps = () => ({ engine: createEngine(compileRules(BUILTIN_RULES), key), config, persist: (rs) => persisted.push(...rs) })

// 造一个映射:先脱敏一句含假 key 的话,拿到占位符。
const engine = createEngine(compileRules(BUILTIN_RULES), key)
const secret = 'sk-test0123456789abcdefghijklmn'
const ph = engine.redact(`key=${secret}`).redactions[0].placeholder
assert.ok(ph.startsWith('__REDACTED_GENERIC_API_KEY_'))

// 1. 占位符在执行时解析,输出里换回占位符,真值全程不出现。
{
  const d = deps()
  d.engine.redact(`key=${secret}`) // 让 broker 的引擎认识这个映射
  const tool = createSecretExecTool(d)
  const value = await tool.execute({ command: `echo "the key is ${ph}"` }, {})
  assert.equal(value.exitCode, 0)
  assert.ok(value.stdout.includes(ph), '输出里应是占位符')
  assert.ok(!value.stdout.includes(secret), '输出里不能有真值')
  assert.deepEqual(value.resolved, [ph])
}

// 2. 未知占位符 → 拒绝执行。
{
  const d = deps()
  const tool = createSecretExecTool(d)
  await assert.rejects(
    () => tool.execute({ command: 'echo __REDACTED_API_KEY_000000000000__' }, {}),
    /unknown placeholder/,
  )
}

// 3. 子进程环境 scrub:凭据形状的变量不下发。
{
  process.env.VIBEGUARD_TEST_SECRET_VALUE = 'ambient-secret-xyz'
  const d = deps()
  const tool = createSecretExecTool(d)
  const value = await tool.execute({ command: 'env' }, {})
  assert.ok(!value.stdout.includes('ambient-secret-xyz'), '凭据形状 env 不应进入子进程')
  delete process.env.VIBEGUARD_TEST_SECRET_VALUE
}

// 4. 超时:SIGTERM 终止,timedOut 标记。
{
  const d = deps()
  const tool = createSecretExecTool(d)
  const value = await tool.execute({ command: 'sleep 30', timeoutMs: 500 }, {})
  assert.equal(value.timedOut, true)
  assert.notEqual(value.exitCode, 0)
}

// 5. 输出里的其他秘密也被引擎兜住并落盘。
{
  const d = deps()
  const tool = createSecretExecTool(d)
  const other = 'glpat-abcdefghij0123456789zz'
  const value = await tool.execute({ command: `echo "${other}"` }, {})
  assert.ok(!value.stdout.includes(other))
  assert.ok(value.stdout.includes('__REDACTED_GITLAB_TOKEN_'))
  assert.ok(persisted.some((r) => r.value === other), '新映射应通过 persist 落盘')
}

console.log('broker.mjs: all assertions passed')
