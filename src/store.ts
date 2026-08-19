/**
 * 映射存储:`~/.dsh/redaction/`(0700)下的 `key`(0600)与
 * `map.jsonl`(0600, append-only)。
 *
 * 威胁模型是本机可信、出境不可信:映射不加密,靠文件权限;它只服务于
 * 用户查真值(grep 占位符),运行时不依赖它做还原(DSH 公开 API 不
 * 支持参数改写,参数在 pre-execute 前已记录并冻结)。
 *
 * 写入纪律:不依赖 umask,创建时显式传 mode;已存在的文件/目录权限
 * 不对就 chmod 修正。读入时容忍坏行(跳过),不让手删残了映射的文件
 * 弄死插件。
 */
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Mapping } from './engine'

export interface StorePaths {
  dir: string
  keyFile: string
  mapFile: string
}

export function defaultStorePaths(home: string = os.homedir()): StorePaths {
  const dir = path.join(home, '.dsh', 'redaction')
  return { dir, keyFile: path.join(dir, 'key'), mapFile: path.join(dir, 'map.jsonl') }
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  try {
    if ((fs.statSync(dir).mode & 0o777) !== 0o700) fs.chmodSync(dir, 0o700)
  } catch {
    // stat/chmod 失败不致命;下次写入会再试。
  }
}

function ensureFilePerms(file: string): void {
  try {
    if ((fs.statSync(file).mode & 0o777) !== 0o600) fs.chmodSync(file, 0o600)
  } catch {
    // 同上。
  }
}

export function loadOrCreateKey(paths: StorePaths): Uint8Array {
  ensureDir(paths.dir)
  if (fs.existsSync(paths.keyFile)) {
    ensureFilePerms(paths.keyFile)
    const buf = fs.readFileSync(paths.keyFile)
    if (buf.length < 16) {
      throw new Error(`dsh-vibeguard: key file too short (${buf.length} bytes): ${paths.keyFile}`)
    }
    return new Uint8Array(buf)
  }
  const key = randomBytes(32)
  fs.writeFileSync(paths.keyFile, key, { mode: 0o600 })
  return new Uint8Array(key)
}

export function loadMappings(paths: StorePaths): Mapping[] {
  if (!fs.existsSync(paths.mapFile)) return []
  ensureFilePerms(paths.mapFile)
  const out: Mapping[] = []
  for (const line of fs.readFileSync(paths.mapFile, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const rec = JSON.parse(trimmed) as Record<string, unknown>
      if (typeof rec.ph === 'string' && typeof rec.value === 'string') {
        out.push({
          placeholder: rec.ph,
          value: rec.value,
          name: typeof rec.name === 'string' ? rec.name : 'SECRET',
        })
      }
    } catch {
      // 坏行跳过。
    }
  }
  return out
}

export function appendMappings(paths: StorePaths, entries: Mapping[]): void {
  if (entries.length === 0) return
  ensureDir(paths.dir)
  const lines = entries.map((e) => JSON.stringify({ ph: e.placeholder, value: e.value, name: e.name, ts: Date.now() })).join('\n') + '\n'
  if (fs.existsSync(paths.mapFile)) {
    fs.appendFileSync(paths.mapFile, lines)
  } else {
    fs.writeFileSync(paths.mapFile, lines, { mode: 0o600 })
  }
}
