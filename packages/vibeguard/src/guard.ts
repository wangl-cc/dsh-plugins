/**
 * 敏感路径访问控制(tools/pre-execute 的 deny 侧)。
 *
 * 匹配是**字段感知**的:只检查各工具的"目标路径/命令"参数
 * (command / file_path / path / workdir …),不对整个参数 JSON 做
 * 子串匹配。初版的全 JSON 匹配会把文档内容里的路径字样误判成访问
 * (例如编辑 README 时 new_string 提到 deny 路径被拦),而真正的目标
 * 参数(file_path)才是访问语义所在。
 *
 * 固有局限(有意的取舍):bash 命令是自由文本,`cat $X`、`cd … && cat …`
 * 这类拼接能绕过子串匹配。deny 防的是"顺手读",不是对抗性绕过;真正的
 * 兜底是 post-execute 脱敏——内容即使被读出来,进日志前也会变占位符。
 */

/** 参与 deny 匹配的参数字段(跨工具的"目标"语义合集)。 */
const PATHISH_FIELDS = [
  'command',
  'file_path',
  'path',
  'workdir',
  'cwd',
  'directory',
  'root',
  'targetDir',
  'target',
]

/** 返回命中的 deny 条目;未命中返回 undefined。 */
export function findDeniedPath(args: unknown, denyList: string[]): string | undefined {
  if (args === null || typeof args !== 'object') return undefined
  const record = args as Record<string, unknown>
  for (const field of PATHISH_FIELDS) {
    const value = record[field]
    if (typeof value !== 'string' || value.length === 0) continue
    for (const denied of denyList) {
      if (denied.length === 0) continue
      // 目录条目带尾斜杠时,引用该目录本身的写法(无尾斜杠)也要命中;
      // 用 value + '/' 匹配,不会扩大到 'redaction-other' 这类兄弟路径。
      if (value.includes(denied)) return denied
      if (denied.endsWith('/') && `${value}/`.includes(denied)) return denied
    }
  }
  return undefined
}
