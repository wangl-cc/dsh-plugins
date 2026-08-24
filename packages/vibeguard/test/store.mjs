import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defaultStorePaths, loadOrCreateKey } from '../dist/core.js'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-vibeguard-test-'))
const paths = defaultStorePaths(tmp)

// 1. 目录与 key 首次创建:0700 / 0600 / 32 字节。
const key1 = loadOrCreateKey(paths)
assert.equal(key1.length, 32)
assert.equal(fs.statSync(paths.dir).mode & 0o777, 0o700)
assert.equal(fs.statSync(paths.keyFile).mode & 0o777, 0o600)

// 2. key 复用:第二次加载得到同一密钥(占位符稳定性全靠它)。
const key2 = loadOrCreateKey(paths)
assert.deepEqual([...key2], [...key1])

// 3. key 权限漂移会被修正。
fs.chmodSync(paths.keyFile, 0o644)
loadOrCreateKey(paths)
assert.equal(fs.statSync(paths.keyFile).mode & 0o777, 0o600)

// 4. key 太短(损坏/手改)直接报错,fail-fast。
fs.writeFileSync(paths.keyFile, Buffer.from([1, 2, 3]), { mode: 0o600 })
assert.throws(() => loadOrCreateKey(paths), /key file too short/)

// 5. 持久面只有 key:store 不再创建任何映射文件(map.jsonl 已随会话内存表设计移除)。
assert.deepEqual(fs.readdirSync(paths.dir), ['key'])

fs.rmSync(tmp, { recursive: true, force: true })
console.log('store.mjs: all assertions passed')
