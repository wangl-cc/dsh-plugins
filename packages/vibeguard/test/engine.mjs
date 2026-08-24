import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { BUILTIN_RULES, OPTIONAL_RULES, compileRules, createEngine } from '../dist/core.js'

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

// 5. 私钥整块(含正文)按 armor 形态命名;三条规则首条命中生效。
{
  const e = fresh()
  const pem = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU=\n-----END OPENSSH PRIVATE KEY-----'
  const r = e.redact(`before\n${pem}\nafter`)
  assert.equal(r.redactions.length, 1)
  assert.equal(r.redactions[0].name, 'OPENSSH_PRIVATE_KEY')
  assert.ok(!r.text.includes('b3BlbnNzaC1rZXktdjEAAAAABG5vbmU='))
  assert.ok(r.text.startsWith('before\n'))
  assert.ok(r.text.endsWith('\nafter'))

  const rsa = e.redact('-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKzQ\n-----END RSA PRIVATE KEY-----')
  assert.equal(rsa.redactions[0].name, 'GENERIC_PEM_PRIVATE_KEY')

  const pgp = e.redact('-----BEGIN PGP PRIVATE KEY BLOCK-----\nxlFGBSd4AgAT\n-----END PGP PRIVATE KEY BLOCK-----')
  assert.equal(pgp.redactions[0].name, 'PGP_PRIVATE_KEY')
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



// 11. webhook / bot token 内置规则。
{
  const e = fresh()
  const slack = e.redact('url: https://hooks.slack.com/services/T01234ABCDE/B0BCDEFGHIJ/abcdefABCDEF0123456789ab')
  assert.equal(slack.redactions[0].name, 'SLACK_WEBHOOK_URL')
  const discord = e.redact('https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-abcd')
  assert.equal(discord.redactions[0].name, 'DISCORD_WEBHOOK_URL')
  const tg = e.redact('token: 123456789:AAEhBOweik5ad9rQXM65P0hssBlrfak9A8B')
  assert.equal(tg.redactions[0].name, 'TELEGRAM_BOT_TOKEN')
}

// 12. PII 可选规则:默认不在内置集;启用后身份证验校验位、手机号直匹配。
{
  const e = fresh()
  const off = e.redact('id 11010519491231002X phone 13812345678')
  assert.equal(off.redactions.length, 0, 'PII 规则默认关闭')

  const on = createEngine(compileRules([...OPTIONAL_RULES, ...BUILTIN_RULES]), key)
  const id = on.redact('id: 11010519491231002X')
  assert.equal(id.redactions[0].name, 'PII_CN_ID')
  const bad = on.redact('id: 110105194912310021')
  assert.equal(bad.redactions.length, 0, '校验位错误的身份证号不脱敏')
  const phone = on.redact('phone: 13812345678')
  assert.equal(phone.redactions[0].name, 'PII_CN_PHONE')
}
// 13. 会话作用域:同会话可解析,其他会话不可;跨会话同秘密同占位符。
{
  const e = fresh()
  const value = 'sk-session-scope-test-0123456789abcdef'
  const r = e.redact(`key=${value}`, 'session-a')
  const ph = r.redactions[0].placeholder
  assert.equal(e.resolve(ph, 'session-a'), value)
  assert.equal(e.resolve(ph, 'session-b'), undefined, '别的会话不可解析')
  const r2 = e.redact(`key=${value}`, 'session-b')
  assert.equal(r2.redactions[0].placeholder, ph, '跨会话占位符稳定(同一 HMAC key)')
  assert.equal(e.resolve(ph, 'session-b'), value, '值流过 session-b 后该会话才可解析')
}

// 14. 匿名桶(遥测兜底路径):脱敏生效,永不解析。
{
  const e = fresh()
  const value = 'sk-anonymous-bucket-0123456789abcdef'
  const r = e.redact(`key=${value}`)
  const ph = r.redactions[0].placeholder
  assert.ok(!r.text.includes(value), '匿名桶照常脱敏')
  assert.equal(e.resolve(ph, 'session-a'), undefined, '匿名桶对任何会话不可解析')
}

// 15. 重启即蒸发:新引擎实例(同一 key)对旧占位符一无所知。
{
  const e1 = fresh()
  const value = 'sk-restart-eviction-0123456789abcdef'
  const ph = e1.redact(`key=${value}`, 'session-a').redactions[0].placeholder
  const e2 = fresh()
  assert.equal(e2.resolve(ph, 'session-a'), undefined, '重启后占位符不可兑现')
  const ph2 = e2.redact(`key=${value}`, 'session-a').redactions[0].placeholder
  assert.equal(ph2, ph, '但占位符身份不变(日志里的旧占位符仍指向同一秘密)')
}

console.log('engine.mjs: all assertions passed')
