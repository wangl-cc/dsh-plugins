/**
 * 脱敏引擎:内容寻址占位符。
 *
 * 占位符 = `__REDACTED_<NAME>_<hmac12>__`,hmac12 是
 * HMAC-SHA256(本机密钥, 原文) 的前 12 位 hex。纯函数:同一原文在任何
 * 会话、任何时刻、重启前后都得到同一占位符,去重与相等性语义免费。
 * 用 HMAC 而非裸哈希是因为占位符会发给不可信的 LLM 提供商——低熵秘密
 * 的裸哈希可被字典爆破验证,HMAC 密钥不出本机则连猜测验证都做不到。
 *
 * 碰撞(48 bit 截断,理论上 ~2^24 个秘密后出现):同一占位符撞到不同
 * 原文时追加 _2/_3 后缀,与 VibeGuard 同策略。后缀必须落在 `__` 之前,
 * 查找正则见 PLACEHOLDER_PATTERN。
 */
import { createHmac } from 'node:crypto'

export interface Rule {
  name: string
  pattern: string
  flags?: string
  /** 0 = 整个 match 是秘密;>0 = 第 N 个捕获组是秘密(保留前后语境)。 */
  group?: number
  /** 剥离引号后的最小值长度,短的跳过(降噪)。 */
  minLength?: number
  /**
   * 匹配后的二次校验(仅内置规则可携带;loader config 是纯 JSON,给不了函数)。
   * 用于 regex 精度不够的场景,如身份证号的 GB 11643 校验位。
   */
  validate?: (value: string) => boolean
}

export interface CompiledRule {
  name: string
  regex: RegExp
  group: number
  minLength: number
  validate?: (value: string) => boolean
}

/** map.jsonl 一行的解析形态。 */
export interface Mapping {
  placeholder: string
  value: string
  name: string
}

export interface AppliedRedaction extends Mapping {
  /** true = 第一次出现,需要 append 进 map.jsonl。 */
  isNew: boolean
}

export interface RedactResult {
  text: string
  /** 本次替换掉的每一处(含已知值;isNew 区分是否需落盘)。 */
  redactions: AppliedRedaction[]
}

/** 匹配占位符全文(含可选碰撞后缀),供还原/查找侧使用。 */
export const PLACEHOLDER_PATTERN = /__REDACTED_[A-Z0-9_]+_[a-f0-9]{12}(?:_\d+)?__/g

/** 精确匹配:已是占位符的值不再是秘密,跳过(kvm规则会把占位符当值再脱敏)。 */
const PLACEHOLDER_EXACT = /^__REDACTED_[A-Z0-9_]+_[a-f0-9]{12}(?:_\d+)?__$/

export function compileRules(rules: Rule[]): CompiledRule[] {
  return rules.map((rule) => {
    let regex: RegExp
    try {
      regex = new RegExp(rule.pattern, `g${rule.flags ?? ''}`)
    } catch (error) {
      throw new Error(`dsh-vibeguard: invalid pattern for rule ${rule.name}: ${(error as Error).message}`)
    }
    return { name: rule.name, regex, group: rule.group ?? 0, minLength: rule.minLength ?? 0, validate: rule.validate }
  })
}

export interface Engine {
  redact(input: string): RedactResult
  placeholderFor(value: string, name: string): { placeholder: string; isNew: boolean }
  /** 占位符 → 真值(broker 工具专用;模型侧永远不该拿到这个通道)。 */
  resolve(placeholder: string): string | undefined
  /** 当前映射规模(测试与诊断用)。 */
  size(): number
}

/**
 * @param rules    已编译规则,有序,首条命中生效(顺序应用,先命中的规则
 *                 先把值换成占位符,后续规则看到的是已脱敏文本)。
 * @param key      HMAC 密钥(store.loadOrCreateKey)。
 * @param existing 启动时从 map.jsonl 载入的历史映射(碰撞校验与去重)。
 */
export function createEngine(rules: CompiledRule[], key: Uint8Array, existing: Mapping[] = []): Engine {
  const byValue = new Map<string, string>()
  const byPlaceholder = new Map<string, string>()
  for (const m of existing) {
    byValue.set(m.value, m.placeholder)
    byPlaceholder.set(m.placeholder, m.value)
  }

  const hmac12 = (value: string): string =>
    createHmac('sha256', key).update(value, 'utf8').digest('hex').slice(0, 12)

  function placeholderFor(value: string, name: string): { placeholder: string; isNew: boolean } {
    const known = byValue.get(value)
    if (known !== undefined) return { placeholder: known, isNew: false }

    const base = `__REDACTED_${name}_${hmac12(value)}`
    let candidate = `${base}__`
    for (let n = 2; ; n += 1) {
      const current = byPlaceholder.get(candidate)
      if (current === undefined || current === value) break
      candidate = `${base}_${n}__`
    }
    byPlaceholder.set(candidate, value)
    byValue.set(value, candidate)
    return { placeholder: candidate, isNew: true }
  }

  function redact(input: string): RedactResult {
    let text = input
    const redactions: AppliedRedaction[] = []
    for (const rule of rules) {
      rule.regex.lastIndex = 0
      text = text.replace(rule.regex, (match: string, ...rest: unknown[]) => {
        const groupValue = rule.group > 0 ? (rest[rule.group - 1] as string | undefined) : match
        if (typeof groupValue !== 'string' || groupValue.length === 0) return match
        // kv 规则的捕获组含引号;剥离后做长度校验与 HMAC,引号随之被占位符替换。
        const bare = groupValue.replace(/^["']|["']$/g, '')
        if (bare.length < rule.minLength) return match
        if (PLACEHOLDER_EXACT.test(bare)) return match
        if (rule.validate !== undefined && !rule.validate(bare)) return match
        const { placeholder, isNew } = placeholderFor(bare, rule.name)
        redactions.push({ placeholder, value: bare, name: rule.name, isNew })
        if (rule.group > 0) {
          const at = match.indexOf(groupValue)
          if (at < 0) return match
          return match.slice(0, at) + placeholder + match.slice(at + groupValue.length)
        }
        return placeholder
      })
    }
    return { text, redactions }
  }

  return { redact, placeholderFor, resolve: (placeholder: string) => byPlaceholder.get(placeholder), size: () => byValue.size }
}
