import assert from 'node:assert/strict'
import { BUILTIN_RULES, compileRules, createEngine, createSecretExecTool } from '../dist/core.js'

const key = new TextEncoder().encode('test-key-32-bytes-padding-000000')
const config = { defaultTimeoutMs: 120000, maxOutputChars: 200000 }
const SESSION = 'session-main'
const execOf = (id) => ({ agent: id === undefined ? undefined : { id } })
const deps = () => ({ engine: createEngine(compileRules(BUILTIN_RULES), key), config })

// 造一个会话内映射:先脱敏一句含假 key 的话,拿到占位符。
const seed = (engine, session = SESSION) => {
  const secret = 'sk-test0123456789abcdefghijklmn'
  const ph = engine.redact(`key=${secret}`, session).redactions[0].placeholder
  assert.ok(ph.startsWith('__REDACTED_GENERIC_API_KEY_'))
  return { secret, ph }
}

// 1. 占位符在执行时解析,输出里换回占位符,真值全程不出现。
{
  const d = deps()
  const { secret, ph } = seed(d.engine)
  const tool = createSecretExecTool(d)
  const value = await tool.execute({ command: `echo "the key is ${ph}"` }, execOf(SESSION))
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
    () => tool.execute({ command: 'echo __REDACTED_API_KEY_000000000000__' }, execOf(SESSION)),
    /unresolvable placeholder/,
  )
}

// 3. 跨会话占位符不可兑现(bearer-capability 防护):值只在别的会话流过。
{
  const d = deps()
  const { ph } = seed(d.engine, 'session-other')
  const tool = createSecretExecTool(d)
  await assert.rejects(
    () => tool.execute({ command: `echo ${ph}` }, execOf(SESSION)),
    /unresolvable placeholder/,
  )
}

// 4. 拿不到会话身份的调用 fail-closed。
{
  const d = deps()
  const { ph } = seed(d.engine)
  const tool = createSecretExecTool(d)
  await assert.rejects(() => tool.execute({ command: `echo ${ph}` }, execOf(undefined)), /no agent session identity/)
}

// 5. 子进程环境 scrub:凭据形状的变量不下发。
{
  process.env.VIBEGUARD_TEST_SECRET_VALUE = 'ambient-secret-xyz'
  const d = deps()
  const tool = createSecretExecTool(d)
  const value = await tool.execute({ command: 'env' }, execOf(SESSION))
  assert.ok(!value.stdout.includes('ambient-secret-xyz'), '凭据形状 env 不应进入子进程')
  delete process.env.VIBEGUARD_TEST_SECRET_VALUE
}

// 6. 超时:SIGTERM 终止,timedOut 标记。
{
  const d = deps()
  const tool = createSecretExecTool(d)
  const value = await tool.execute({ command: 'sleep 30', timeoutMs: 500 }, execOf(SESSION))
  assert.equal(value.timedOut, true)
  assert.notEqual(value.exitCode, 0)
}

// 7. 输出里的其他秘密也被引擎兜住,并记入本会话桶(随后可解析)。
{
  const d = deps()
  const tool = createSecretExecTool(d)
  const other = 'glpat-abcdefghij0123456789zz'
  const value = await tool.execute({ command: `echo "${other}"` }, execOf(SESSION))
  assert.ok(!value.stdout.includes(other))
  const ph = value.stdout.match(/__REDACTED_GITLAB_TOKEN_[a-f0-9]{12}__/)
  assert.ok(ph, '输出里应是 GITLAB_TOKEN 占位符')
  assert.equal(d.engine.resolve(ph[0], SESSION), other, '输出兜住的秘密进本会话桶,可兑现')
}

console.log('broker.mjs: all assertions passed')
