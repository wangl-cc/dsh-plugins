/**
 * 脱敏引擎:内容寻址占位符 + 会话作用域内存映射,零磁盘状态。
 *
 * 占位符 = `__REDACTED_<NAME>_<hmac12>__`,hmac12 是
 * HMAC-SHA256(进程随机密钥, 原文) 的前 12 位 hex。进程期内是纯函数:
 * 同一原文在任何会话都得到同一占位符,去重与相等性语义免费。
 * 用 HMAC 而非裸哈希是因为占位符会发给不可信的 LLM 提供商——低熵秘密
 * 的裸哈希可被字典爆破验证;密钥只活在内存(进程启动时随机生成),
 * 磁盘上没有可偷的材料,重启后连猜测验证的对象都消失(历史占位符
 * 永久失联,这是知情接受的代价)。
 *
 * 碰撞(48 bit 截断,理论上 ~2^24 个秘密后出现):同会话内同一占位符
 * 撞到不同原文时追加 _2/_3 后缀。跨会话别名不做检测(概率 ~10⁻⁷ 量级,
 * 且兑现只发生在值真实流过的会话内,别名无安全后果)。
 *
 * **映射是会话作用域的内存表,不落盘。** broker 工具引入后占位符成为
 * 可兑现凭证,全局持久映射等于"永久 bearer token":任何会话拿到占位符
 * 字符串(旧日志、别的会话)都能兑现真值。按会话分桶、进程死即蒸发:
 * 占位符可解析 ⟺ 它的真值在本会话、本进程里真实流经过。拿不到会话身份
 * 的挂点(遥测兜底)记入匿名桶——脱敏照常,但匿名桶永不解析(fail-closed)。
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

export interface AppliedRedaction {
  placeholder: string
  value: string
  name: string
  /** true = 该值在本会话第一次出现。 */
  isNew: boolean
}

/** 映射三元组;仅用于 seed 注入(见 createEngine)。 */
export interface Mapping {
  placeholder: string
  value: string
  name: string
}

export interface RedactResult {
  text: string
  /** 本次替换掉的每一处(含本会话已知值)。 */
  redactions: AppliedRedaction[]
}

/** 匹配占位符全文(含可选碰撞后缀),供还原/查找侧使用。 */
export const PLACEHOLDER_PATTERN = /__REDACTED_[A-Z0-9_]+_[a-f0-9]{12}(?:_\d+)?__/g

/** 精确匹配:已是占位符的值不再是秘密,跳过(kv 规则会把占位符当值再脱敏)。 */
const PLACEHOLDER_EXACT = /^__REDACTED_[A-Z0-9_]+_[a-f0-9]{12}(?:_\d+)?__$/

/** 匿名桶的 key:不可能与真实 SessionId 冲突,且 resolve 永不查询它。 */
const ANONYMOUS_BUCKET = 'Ø-anonymous'

interface Bucket {
  byValue: Map<string, string>
  byPlaceholder: Map<string, string>
}

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
  /** 带 session 时映射记入该会话的桶;缺省记入匿名桶(脱敏生效,永不解析)。 */
  redact(input: string, session?: string): RedactResult
  placeholderFor(value: string, name: string, session?: string): { placeholder: string; isNew: boolean }
  /** 占位符 → 真值,仅限该会话的桶(broker 工具专用;模型侧永远不该拿到这个通道)。 */
  resolve(placeholder: string, session: string): string | undefined
  /** 全部桶的映射总数(测试与诊断用)。 */
  size(): number
}

/**
 * @param rules 已编译规则,有序,首条命中生效(顺序应用,先命中的规则
 *              先把值换成占位符,后续规则看到的是已脱敏文本)。
 * @param key   HMAC 密钥(进程启动时 randomBytes(32),零磁盘状态)。
 * @param seed  测试注入的预存映射(碰撞后缀等路径在生产中难以触发);
 *              生产代码不传。session 缺省进匿名桶。
 */
export function createEngine(
  rules: CompiledRule[],
  key: Uint8Array,
  seed: Array<Mapping & { session?: string }> = [],
): Engine {
  const buckets = new Map<string, Bucket>()

  const bucketFor = (session?: string): Bucket => {
    const k = session ?? ANONYMOUS_BUCKET
    let bucket = buckets.get(k)
    if (bucket === undefined) {
      bucket = { byValue: new Map(), byPlaceholder: new Map() }
      buckets.set(k, bucket)
    }
    return bucket
  }

  for (const m of seed) {
    const bucket = bucketFor(m.session)
    bucket.byValue.set(m.value, m.placeholder)
    bucket.byPlaceholder.set(m.placeholder, m.value)
  }

  const hmac12 = (value: string): string =>
    createHmac('sha256', key).update(value, 'utf8').digest('hex').slice(0, 12)

  function placeholderFor(value: string, name: string, session?: string): { placeholder: string; isNew: boolean } {
    const bucket = bucketFor(session)
    const known = bucket.byValue.get(value)
    if (known !== undefined) return { placeholder: known, isNew: false }

    const base = `__REDACTED_${name}_${hmac12(value)}`
    let candidate = `${base}__`
    for (let n = 2; ; n += 1) {
      const current = bucket.byPlaceholder.get(candidate)
      if (current === undefined || current === value) break
      candidate = `${base}_${n}__`
    }
    bucket.byPlaceholder.set(candidate, value)
    bucket.byValue.set(value, candidate)
    return { placeholder: candidate, isNew: true }
  }

  function redact(input: string, session?: string): RedactResult {
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
        const { placeholder, isNew } = placeholderFor(bare, rule.name, session)
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

  return {
    redact,
    placeholderFor,
    resolve: (placeholder: string, session: string) => {
      if (session === ANONYMOUS_BUCKET) return undefined
      return buckets.get(session)?.byPlaceholder.get(placeholder)
    },
    size: () => {
      let total = 0
      for (const bucket of buckets.values()) total += bucket.byValue.size
      return total
    },
  }
}
