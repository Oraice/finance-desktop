'use strict'
// ---------------------------------------------------------------------------
// file-store.cjs —— 本地数据文件的原子写入与损坏自愈
// 纯 fs / path，不依赖 Electron，可在 Node 单元测试中直接验证。
//
// 为什么需要它：
//   直接用 writeFileSync 覆盖账本 / 账户文件时，若写到一半遇到断电、崩溃或
//   磁盘写满，原文件会被截断、永久损坏。这里先把内容写到同目录临时文件并
//   fsync 落盘，再 rename 原子替换目标——同卷 rename 在 Windows 上经
//   MoveFileEx(MOVEFILE_REPLACE_EXISTING) 原子完成，结果要么是完整旧文件、
//   要么是完整新文件，不会出现写了一半的状态。
// ---------------------------------------------------------------------------

const fs = require('fs')
const path = require('path')

const timeStamp = () => new Date().toISOString().replace(/[:.]/g, '-')

/**
 * 原子写入：临时文件 + fsync + rename 替换。返回目标路径。
 */
function atomicWrite(target, content) {
  const dir = path.dirname(target)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(
    dir,
    `.${path.basename(target)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  )
  let fd
  try {
    fd = fs.openSync(tmp, 'w')
    fs.writeFileSync(fd, String(content), 'utf8')
    fs.fsyncSync(fd) // 强制数据落盘，而非停留在系统缓存
  } catch (e) {
    try { if (fd !== undefined) fs.closeSync(fd) } catch { /* ignore */ }
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
    throw e
  }
  fs.closeSync(fd)
  fs.renameSync(tmp, target) // 同卷原子替换
  return target
}

/** 原子写入 JSON（两空格缩进）。返回目标路径。 */
function atomicWriteJson(target, value) {
  return atomicWrite(target, JSON.stringify(value, null, 2))
}

/**
 * 读取并解析 JSON，返回解析后的对象；文件不存在或 JSON 损坏时返回 null。
 * JSON 损坏时会把坏文件隔离重命名为 `<file>.corrupt-<时间戳>`（保留现场、
 * 不删除），并通过 onIssue(msg) 回调记录事件。
 */
function readJsonOrQuarantine(file, onIssue) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return null // 文件不存在
  }
  try {
    return JSON.parse(text)
  } catch {
    const quarantined = `${file}.corrupt-${timeStamp()}`
    try { fs.renameSync(file, quarantined) } catch { /* 隔离失败也不抛 */ }
    if (typeof onIssue === 'function') onIssue(`文件解析失败，已隔离：${quarantined}`)
    return null
  }
}

module.exports = { atomicWrite, atomicWriteJson, readJsonOrQuarantine }
