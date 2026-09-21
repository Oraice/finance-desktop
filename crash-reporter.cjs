'use strict'
// ---------------------------------------------------------------------------
// crash-reporter.cjs —— 崩溃 / 异常的本地记录、异常退出检测与（可选）上报
// 纯 Node（fs / path / http(s)），不依赖 Electron，可在单元测试中直接验证。
//
// 隐私边界（重要）：
//   崩溃报告只含「错误名称 / 消息 / 堆栈 + 应用版本 + 操作系统/架构 + 时间」，
//   绝不包含账户、账本、流水、金额、密码、备份内容或任何用户输入的数据。
//   crashLocalLog：仅写入本机 userData/crashes（默认开，可关）；
//   crashUpload ：仅当用户在设置中显式开启且配置了地址才会发送（默认关）。
// ---------------------------------------------------------------------------

const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-')
const MAX_MSG = 1000
const MAX_STACK = 4000
const clip = (s, n) => {
  const str = String(s || '')
  return str.length > n ? str.slice(0, n) + '…' : str
}

/** 默认 HTTP POST：8 秒超时，2xx 视为成功 */
function defaultHttpPost(urlStr, body) {
  return new Promise((resolve, reject) => {
    let u
    try { u = new URL(urlStr) } catch (e) { reject(e); return }
    const lib = u.protocol === 'http:' ? http : https
    const req = lib.request(
      urlStr,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        res.resume()
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve({ status: res.statusCode })
          else reject(new Error('HTTP ' + res.statusCode))
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('上报超时')))
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function createCrashReporter(opts = {}) {
  const {
    userDataPath,
    appVersion = '0.0.0',
    platformInfo = {},
    httpPost = defaultHttpPost
  } = opts

  const crashDir = () => path.join(userDataPath, 'crashes')
  const livenessFile = () => path.join(userDataPath, 'liveness.json')

  function ensureCrashDir() {
    const dir = crashDir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  /** 从错误对象构造脱敏报告 */
  function buildReport(rec = {}) {
    const e = rec.error
    let name = 'Error'
    let message = ''
    let stack = ''
    if (e instanceof Error) {
      name = e.name || 'Error'
      message = e.message || ''
      stack = e.stack || ''
    } else if (rec.source === 'render-gone') {
      name = 'RenderProcessGone'
      message = rec.reason || e || '渲染进程消失'
    } else {
      message = e == null ? (rec.message || '') : String(e)
    }
    const extra = rec.url ? { url: String(rec.url), line: rec.line || 0, col: rec.col || 0 } : (rec.extra || null)
    return {
      id: 'crash-' + stamp() + '-' + Math.random().toString(36).slice(2, 6),
      at: new Date().toISOString(),
      source: rec.source || 'main',
      appVersion,
      platform: platformInfo.platform || process.platform,
      os: platformInfo.os || '',
      arch: platformInfo.arch || process.arch,
      name,
      message: clip(message, MAX_MSG),
      stack: clip(stack, MAX_STACK),
      extra
    }
  }

  /** 仅在本机记录一次崩溃，返回 { report, file } */
  function record(rec) {
    const report = buildReport(rec)
    const dir = ensureCrashDir()
    const file = path.join(dir, report.id + '.json')
    try { fs.writeFileSync(file, JSON.stringify(report, null, 2)) } catch { /* 极端状态下写盘失败也不抛 */ }
    return { report, file: fs.existsSync(file) ? file : null }
  }

  /** 记录；若用户开启上报则异步发送（失败静默，绝不阻塞主流程） */
  async function recordAndMaybeSend(rec, settings) {
    const { report } = record(rec)
    if (settings && settings.crashUpload && settings.crashEndpoint) {
      try {
        await httpPost(settings.crashEndpoint, JSON.stringify(report))
        return { report, sent: true }
      } catch (e) {
        return { report, sent: false, error: e.message }
      }
    }
    return { report, sent: false }
  }

  // ------------------------- 异常退出存活检测 -------------------------------

  function startLiveness() {
    try {
      fs.writeFileSync(livenessFile(), JSON.stringify({
        startedAt: new Date().toISOString(), pid: process.pid, appVersion
      }))
    } catch { /* ignore */ }
  }

  function endLiveness() {
    try { if (fs.existsSync(livenessFile())) fs.unlinkSync(livenessFile()) } catch { /* ignore */ }
  }

  /** 启动时调用：残留存活标记说明上一次未正常退出（崩溃 / 强杀 / 断电） */
  function detectUnexpectedExit() {
    try {
      if (!fs.existsSync(livenessFile())) return { unexpected: false }
      const info = JSON.parse(fs.readFileSync(livenessFile(), 'utf8'))
      const recent = listCrashes()[0] || null
      return { unexpected: true, liveness: info, recentCrash: recent }
    } catch {
      return { unexpected: false }
    }
  }

  // ------------------------------ 列表管理 ----------------------------------

  function listCrashes() {
    try {
      const dir = ensureCrashDir()
      return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { return null }
        })
        .filter(Boolean)
        .sort((a, b) => (a.at < b.at ? 1 : -1))
    } catch {
      return []
    }
  }

  function clearCrashes() {
    try {
      const dir = ensureCrashDir()
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
        fs.unlinkSync(path.join(dir, f))
      }
    } catch { /* ignore */ }
  }

  return {
    buildReport, record, recordAndMaybeSend,
    startLiveness, endLiveness, detectUnexpectedExit,
    listCrashes, clearCrashes
  }
}

module.exports = { createCrashReporter, defaultHttpPost }
