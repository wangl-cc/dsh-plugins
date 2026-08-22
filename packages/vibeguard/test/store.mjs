import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { appendMappings, defaultStorePaths, loadMappings, loadOrCreateKey } from '../dist/core.js'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-vibeguard-test-'))
const paths = defaultStorePaths(tmp)

// 1. 目录与 key 首次创建:0700 / 0600 / 32 字节。
const key1 = loadOrCreateKey(paths)
assert.equal(key1.length, 32)
assert.equal(fs.statSync(paths.dir).mode & 0o777, 0o700)
assert.equal(fs.statSync(paths.keyFile).mode & 0o777, 0o600)

// 2. key 复用:第二次加载得到同一密钥。
const key2 = loadOrCreateKey(paths)
assert.deepEqual([...key2], [...key1])

// 3. key 权限漂移会被修正。
fs.chmodSync(paths.keyFile, 0o644)
loadOrCreateKey(paths)
assert.equal(fs.statSync(paths.keyFile).mode & 0o777, 0o600)

// 4. map.jsonl:append + 加载 roundtrip。
appendMappings(paths, [
  { placeholder: '__REDACTED_API_KEY_aaaaaaaaaaaa__', value: 'sk-one', name: 'API_KEY' },
  { placeholder: '__REDACTED_PASSWORD_bbbbbbbbbbbb__', value: 'p@ss', name: 'PASSWORD' },
])
appendMappings(paths, [{ placeholder: '__REDACTED_JWT_cccccccccccc__', value: 'jwt', name: 'JWT' }])
assert.equal(fs.statSync(paths.mapFile).mode & 0o777, 0o600)
const loaded = loadMappings(paths)
assert.equal(loaded.length, 3)
assert.equal(loaded[0].placeholder, '__REDACTED_API_KEY_aaaaaaaaaaaa__')
assert.equal(loaded[2].name, 'JWT')

// 5. 坏行容忍:手删残的文件不弄死加载。
fs.appendFileSync(paths.mapFile, '{corrupt json\n\n')
const loaded2 = loadMappings(paths)
assert.equal(loaded2.length, 3)

// 6. 空 append 是 no-op,不创建文件。
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-vibeguard-test2-'))
const paths2 = defaultStorePaths(tmp2)
appendMappings(paths2, [])
assert.equal(fs.existsSync(paths2.mapFile), false)

fs.rmSync(tmp, { recursive: true, force: true })
fs.rmSync(tmp2, { recursive: true, force: true })
console.log('store.mjs: all assertions passed')
