/**
 * 持久存储只剩一件东西:`~/.dsh/redaction/key`(0600)——HMAC 密钥,
 * 它让占位符跨会话/重启稳定(纯函数,不需要持久映射表)。
 *
 * 映射本身从磁盘上移除了(曾是 map.jsonl):broker 工具把占位符变成
 * 可兑现凭证后,一张不断增长的持久明文映射表就是纯攻击面。现在映射
 * 只在引擎内存里按会话分桶,进程死即蒸发。本文件存在的全部理由就是
 * 保住 key 的机密性——key 泄露 + 提供商侧日志 = 低熵秘密可被字典验证。
 *
 * 写入纪律:不依赖 umask,创建时显式传 mode;目录 0700、文件 0600,
 * 权限漂移自动修正。
 */
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface StorePaths {
  dir: string
  keyFile: string
}

export function defaultStorePaths(home: string = os.homedir()): StorePaths {
  const dir = path.join(home, '.dsh', 'redaction')
  return { dir, keyFile: path.join(dir, 'key') }
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  try {
    if ((fs.statSync(dir).mode & 0o777) !== 0o700) fs.chmodSync(dir, 0o700)
  } catch {
    // stat/chmod 失败不致命;下次写入会再试。
  }
}

export function loadOrCreateKey(paths: StorePaths): Uint8Array {
  ensureDir(paths.dir)
  if (fs.existsSync(paths.keyFile)) {
    try {
      if ((fs.statSync(paths.keyFile).mode & 0o777) !== 0o600) fs.chmodSync(paths.keyFile, 0o600)
    } catch {
      // 同上。
    }
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
