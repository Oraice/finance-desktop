'use strict'
// ---------------------------------------------------------------------------
// backup-core.cjs —— 数据备份与恢复的纯逻辑（Node 可单测，不依赖 Electron）
// 备份文件始终为 JSON 文本（.finbak）：
//   无密码 → 明文 JSON；有密码 → AES-256-GCM 加密包（salt/iv/tag/密文）。
// ---------------------------------------------------------------------------
const crypto = require('crypto')

const FORMAT = 'caizhangbu-backup'
const ENC_FORMAT = 'caizhangbu-backup-enc'
const VERSION = 1

// scrypt 派生备份密钥的参数（与口令哈希保持同一强度档）
const ENC_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

/** 组装备份对象 */
function buildBackup(accounts, ledgers, now = Date.now()) {
  return {
    format: FORMAT,
    version: VERSION,
    app: '财账簿',
    createdAt: now,
    accounts,
    ledgers
  }
}

/**
 * 序列化备份：无密码 → 明文 JSON 文本；有密码 → AES-256-GCM 加密后的 JSON 文本。
 */
function serializeBackup(backup, password) {
  const plain = JSON.stringify(backup)
  const pw = String(password || '')
  if (!pw) return plain

  const salt = crypto.randomBytes(16)
  const key = crypto.scryptSync(pw, salt, 32, ENC_OPTS)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return JSON.stringify({
    format: ENC_FORMAT,
    version: VERSION,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: ct.toString('base64')
  })
}

function isValidBackup(b) {
  return b && b.format === FORMAT && Array.isArray(b.accounts) && Array.isArray(b.ledgers)
}

/**
 * 解析备份文件文本：明文直接返回；加密包需密码，密码错误 / 文件损坏抛异常。
 */
function parseBackup(content, password) {
  let obj
  try { obj = JSON.parse(content) } catch { throw new Error('不是有效的备份文件（内容无法解析）') }

  if (obj.format === FORMAT) {
    if (!isValidBackup(obj)) throw new Error('备份文件内容不完整或已损坏')
    return obj
  }
  if (obj.format === ENC_FORMAT) {
    const pw = String(password || '')
    if (!pw) { const e = new Error('该备份已加密，请输入备份密码'); e.encrypted = true; throw e }
    try {
      const key = crypto.scryptSync(pw, Buffer.from(obj.salt, 'hex'), 32, ENC_OPTS)
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(obj.iv, 'hex'))
      decipher.setAuthTag(Buffer.from(obj.tag, 'hex'))
      const plain = Buffer.concat([
        decipher.update(Buffer.from(obj.data, 'base64')),
        decipher.final()
      ]).toString('utf8')
      const backup = JSON.parse(plain)
      if (!isValidBackup(backup)) throw new Error('备份内容不完整')
      return backup
    } catch (e) {
      if (e.encrypted) throw e
      throw new Error('备份密码不正确，或备份文件已损坏')
    }
  }
  throw new Error('无法识别的备份格式')
}

/** 判断文本是否为加密备份（不抛异常，供 UI 决定是否先要密码） */
function isEncrypted(content) {
  try { return JSON.parse(content).format === ENC_FORMAT } catch { return false }
}

/** 备份摘要：备份时间、账户数、账本数、流水总数、账本名称 */
function summarizeBackup(b) {
  const recordCount = b.ledgers.reduce((n, l) => n + ((l.records || []).length), 0)
  return {
    createdAt: b.createdAt,
    accountCount: b.accounts.length,
    ledgerCount: b.ledgers.length,
    recordCount,
    ledgerNames: b.ledgers.map((l) => l.name)
  }
}

/**
 * 恢复预处理：encPass 经 Windows DPAPI 绑定本机本用户，换机/重装后无法解密，
 * 统一清空并关闭自动登录，避免恢复后免密失败。
 */
function normalizeOnRestore(b) {
  b.accounts = b.accounts.map((a) => ({ ...a, autoLogin: false, encPass: null }))
  return b
}

module.exports = {
  FORMAT, ENC_FORMAT, VERSION,
  buildBackup, serializeBackup, parseBackup,
  isEncrypted, summarizeBackup, normalizeOnRestore
}
