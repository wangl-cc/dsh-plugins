import assert from 'node:assert/strict'
import { findDeniedPath } from '../dist/core.js'

const denyList = ['/home/u/.dsh/.credentials.yaml', '/home/u/.dsh/redaction/', '/home/u/.ssh/id_']

// 1. bash 命令含敏感路径 → 命中。
assert.equal(findDeniedPath({ command: 'cat /home/u/.ssh/id_ed25519' }, denyList), '/home/u/.ssh/id_')

// 2. read/write/edit 的目标字段 → 命中。
assert.equal(findDeniedPath({ file_path: '/home/u/.dsh/.credentials.yaml' }, denyList), '/home/u/.dsh/.credentials.yaml')

// 3. 文档内容里提到敏感路径(file_path 是安全目标)→ 不误伤。
//    这是全 JSON 子串匹配时代的真实回归:编辑 README 提到 deny 路径被拦。
assert.equal(
  findDeniedPath(
    { file_path: '/repo/README.md', old_string: 'x', new_string: 'deny 列表含 /home/u/.ssh/id_ 等' },
    denyList,
  ),
  undefined,
)

// 4. 无目标字段/非对象 → 不命中。
assert.equal(findDeniedPath({ pattern: '/home/u/.ssh/id_' }, denyList), undefined)
assert.equal(findDeniedPath(null, denyList), undefined)
assert.equal(findDeniedPath(undefined, denyList), undefined)

// 5. workdir 也参与(bash 用 workdir 定位再读相对路径的常见形态)。
assert.equal(findDeniedPath({ command: 'cat .credentials.yaml', workdir: '/home/u/.dsh' }, denyList), undefined)
assert.equal(
  findDeniedPath({ command: 'cat x', workdir: '/home/u/.dsh/redaction' }, denyList),
  '/home/u/.dsh/redaction/',
)

console.log('guard.mjs: all assertions passed')
