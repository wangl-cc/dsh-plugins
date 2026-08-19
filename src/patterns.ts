/**
 * 内置规则集。有序,首条命中生效(用户规则排在内置之前,见 config)。
 *
 * 来源:gitleaks 默认规则集(config/gitleaks.toml)与 opencode-vibeguard
 * 默认配置,改写为 JS RegExp 语法(RE2 的 (?-i:…)、[[:alnum:]]、\x60
 * 在 JS 里不存在)。收录原则:
 *  - 结构性前缀规则优先(前缀即身份,误报天然低);
 *  - 关键词锚定规则(要求上下文出现厂商名)不收——本插件扫的是 agent
 *    输入输出文本,不是仓库,噪音收益比不合适;
 *  - 通用 kv 规则(group/minLength 降噪)收尾,可用 disabledBuiltinRules 关。
 *
 * group: 0 = 整个 match 是秘密;>0 = 第 N 个捕获组是秘密(kv 规则用,
 * 保留 `password=` 前缀让模型理解语境)。minLength 作用于剥离引号后的值。
 */
import type { Rule } from './engine'

export const BUILTIN_RULES: Rule[] = [
  // 私钥整块(含头尾行);vibeguard 只匹配头行,正文会漏,这里吃到 END。
  // 按 armor 形态拆三条,具体在前、兜底在后(NAME 是脱敏后唯一存活的
  // 语义线索,笼统的 PRIVATE_KEY 会把 OpenSSH/TLS/RSA 抹成一类)。
  {
    name: 'OPENSSH_PRIVATE_KEY',
    pattern: '-----BEGIN OPENSSH PRIVATE KEY-----[\\s\\S]*?-----END OPENSSH PRIVATE KEY-----',
  },
  {
    name: 'PGP_PRIVATE_KEY',
    pattern: '-----BEGIN PGP PRIVATE KEY BLOCK-----[\\s\\S]*?-----END PGP PRIVATE KEY BLOCK-----',
  },
  {
    name: 'GENERIC_PEM_PRIVATE_KEY',
    pattern: '-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----',
  },
  // 厂商结构性 token。
  {
    name: 'ANTHROPIC_API_KEY',
    pattern: 'sk-ant-(?:api03|admin01)-[A-Za-z0-9_-]{80,}',
  },
  {
    name: 'OPENAI_API_KEY',
    pattern: 'sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}',
  },
  {
    name: 'AGE_SECRET_KEY',
    pattern: 'AGE-SECRET-KEY-1[QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L]{58}',
  },
  {
    name: 'GITHUB_TOKEN',
    pattern: '(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{22,}',
  },
  {
    name: 'GITLAB_TOKEN',
    pattern: 'glpat-[A-Za-z0-9_-]{20,}',
  },
  {
    name: 'AWS_ACCESS_KEY',
    pattern: '(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}',
  },
  {
    name: 'ALIBABA_ACCESS_KEY',
    pattern: 'LTAI[A-Za-z0-9]{12,20}',
  },
  {
    name: 'GOOGLE_API_KEY',
    pattern: 'AIza[\\w-]{35}',
  },
  {
    name: 'SLACK_TOKEN',
    pattern: 'xox[baprs]-[0-9A-Za-z-]{10,}',
  },
  {
    name: 'STRIPE_KEY',
    pattern: '(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{10,}',
  },
  {
    name: 'NPM_TOKEN',
    pattern: 'npm_[a-z0-9]{36}',
  },
  {
    name: 'SENDGRID_KEY',
    pattern: 'SG\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{30,}',
  },
  {
    name: 'JWT',
    pattern: 'eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+',
  },
  {
    name: 'DB_URL',
    pattern: '(?:postgres(?:ql)?|mysql|mongodb(?:\\+srv)?|redis)://[^\\s:/]+:[^\\s@]+@[^\\s]+',
  },
  {
    name: 'BEARER_TOKEN',
    pattern: 'authorization\\s*:\\s*bearer\\s+[A-Za-z0-9._-]{20,}',
    flags: 'i',
  },
  // 通用 sk- 兜底(kimi/deepseek 等);允许 dash(sk-kimi-…),排具体厂商规则之后。
  {
    name: 'GENERIC_API_KEY',
    pattern: 'sk-[A-Za-z0-9][A-Za-z0-9_-]{18,}',
  },
  // 通用 kv 家族:只脱敏值(group 1),保留键名;短值(<8)跳过降噪。
  {
    name: 'PASSWORD',
    pattern: '\\b(?:password|passwd)\\b["\']?\\s*[=:]\\s*("[^"\\n]+"|\'[^\'\\n]+\'|[^\\s,;)}\\]>"\']+)',
    flags: 'i',
    group: 1,
    minLength: 8,
  },
  {
    name: 'API_KEY',
    pattern:
      '\\b(?:api[_-]?key|apikey|access[_-]?(?:key|token|secret)|auth[_-]?token|refresh[_-]?token)\\b["\']?\\s*[=:]\\s*("[^"\\n]+"|\'[^\'\\n]+\'|[^\\s,;)}\\]>"\']+)',
    flags: 'i',
    group: 1,
    minLength: 8,
  },
  {
    name: 'SECRET',
    pattern:
      '\\b(?:secret|token|bearer|client[_-]?secret|session[_-]?(?:key|secret)|private[_-]?key|secret[_-]?key)\\b["\']?\\s*[=:]\\s*("[^"\\n]+"|\'[^\'\\n]+\'|[^\\s,;)}\\]>"\']+)',
    flags: 'i',
    group: 1,
    minLength: 8,
  },
]
