import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { BUILTIN_RULES, compileRules, createEngine } from '../dist/core.js'

const key = new TextEncoder().encode('test-key-32-bytes-padding-000000')
const rules = compileRules(BUILTIN_RULES)
const PH_RE = /^__REDACTED_[A-Z0-9_]+_[a-f0-9]{12}(?:_\d+)?__$/

function fresh() {
  return createEngine(compileRules(BUILTIN_RULES), key)
}

// 1. 格式与确定性:同一原文 → 同一占位符,跨引擎实例稳定(同 key)。
{
  const a = fresh()
  const b = fresh()
  const r1 = a.redact('key = sk-kimi-abc123def456ghi789jkl0')
  const r2 = b.redact('key = sk-kimi-abc123def456ghi789jkl0')
  assert.equal(r1.redactions.length, 1)
  assert.match(r1.redactions[0].placeholder, PH_RE)
  assert.equal(r1.text, r2.text)
  assert.ok(!r1.text.includes('sk-kimi-abc123def456ghi789jkl0'))
}

// 2. 去重:同一文本里出现两次,只产生一条新映射,两处同占位符。
{
  const e = fresh()
  const r = e.redact('a=LTAI123456789012 b=LTAI123456789012')
  assert.equal(r.redactions.length, 2)
  assert.equal(r.redactions[0].placeholder, r.redactions[1].placeholder)
  assert.equal(r.redactions.filter((x) => x.isNew).length, 1)
  assert.equal(r.redactions[0].name, 'ALIBABA_ACCESS_KEY')
}

// 3. 不同秘密 → 不同占位符。
{
  const e = fresh()
  const r = e.redact('LTAI123456789012 vs LTAIabcdefghijkl')
  assert.notEqual(r.redactions[0].placeholder, r.redactions[1].placeholder)
}

// 4. 厂商特异性:首条命中生效,具体规则先于通用 sk- 兜底。
{
  const e = fresh()
  const anthropic = e.redact(`sk-ant-api03-${'a'.repeat(93)}`)
  assert.equal(anthropic.redactions[0].name, 'ANTHROPIC_API_KEY')
  const kimi = e.redact(`sk-kimi-${'w'.repeat(60)}`)
  assert.equal(kimi.redactions[0].name, 'GENERIC_API_KEY')
}

// 5. 私钥整块(含正文)被一次替换。
{
  const e = fresh()
  const pem = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU=\n-----END OPENSSH PRIVATE KEY-----'
  const r = e.redact(`before\n${pem}\nafter`)
  assert.equal(r.redactions.length, 1)
  assert.equal(r.redactions[0].name, 'PRIVATE_KEY')
  assert.ok(!r.text.includes('b3BlbnNzaC1rZXktdjEAAAAABG5vbmU='))
  assert.ok(r.text.startsWith('before\n'))
  assert.ok(r.text.endsWith('\nafter'))
}

// 6. kv 规则:保留键名,只替换值;短值跳过。
{
  const e = fresh()
  const r = e.redact('password: "sup3r-secret-value"')
  assert.equal(r.redactions[0].name, 'PASSWORD')
  assert.ok(r.text.startsWith('password: '))
  assert.ok(!r.text.includes('sup3r-secret-value'))
  assert.ok(!r.text.includes('"'), '引号随值一起被替换')

  const short = e.redact('password: short')
  assert.equal(short.redactions.length, 0, '短值不脱敏')
}

// 7. 引号不敏感:同一值带不带引号映射到同一占位符。
{
  const e = fresh()
  const r1 = e.redact('password="sup3r-secret-value"')
  const r2 = e.redact("password: sup3r-secret-value")
  assert.equal(r1.redactions[0].placeholder, r2.redactions[0].placeholder)
}

// 8. 碰撞后缀:预占同占位符的不同值 → _2。
{
  const value = `sk-${'c'.repeat(32)}`
  const expected = createHmac('sha256', key).update(value, 'utf8').digest('hex').slice(0, 12)
  const occupied = `__REDACTED_GENERIC_API_KEY_${expected}__`
  const e = createEngine(rules, key, [{ placeholder: occupied, value: 'someone-else', name: 'GENERIC_API_KEY' }])
  const r = e.redact(value)
  assert.equal(r.redactions[0].placeholder, `__REDACTED_GENERIC_API_KEY_${expected}_2__`)
}

// 9. 占位符幂等:脱敏结果再过一遍引擎不变(不会二次脱敏)。
{
  const e = fresh()
  const once = e.redact('token = glpat-abcdefghijklmnopqr')
  const twice = e.redact(once.text)
  assert.equal(twice.redactions.length, 0)
  assert.equal(twice.text, once.text)
}

// 10. JWT 与 DB_URL。
{
  const e = fresh()
  const jwt = e.redact('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dummysignaturepart')
  assert.equal(jwt.redactions[0].name, 'JWT')
  const db = e.redact('DATABASE_URL=postgres://user:p%40ss@db.internal:5432/app')
  assert.equal(db.redactions[0].name, 'DB_URL')
  assert.ok(!db.text.includes('p%40ss'))
}

console.log('engine.mjs: all assertions passed')
