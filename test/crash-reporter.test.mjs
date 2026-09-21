// ---------------------------------------------------------------------------
// crash-reporter.test.mjs —— 崩溃记录 / 异常退出检测 / 脱敏上报 单元测试
// 运行：node test/crash-reporter.test.mjs
// ---------------------------------------------------------------------------

import assert from 'node:assert'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { createCrashReporter } = require('../crash-reporter.cjs')

let passed = 0
const ok = (name, fn) => { fn(); passed++ }
const expectAsync = async (name, fn) => { await fn(); passed++ }

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crash-core-'))
  const reporter = createCrashReporter({
    userDataPath: dir,
    appVersion: '9.9.9',
    platformInfo: { platform: 'win32', os: 'Windows 11', arch: 'x64' }
  })

  ok('buildReport 提取 name/message/stack 与版本平台', () => {
    const r = reporter.buildReport({ error: new TypeError('boom') })
    assert.equal(r.name, 'TypeError')
    assert.equal(r.message, 'boom')
    assert.match(r.stack, /TypeError: boom/)
    assert.equal(r.appVersion, '9.9.9')
    assert.equal(r.platform, 'win32')
    assert.equal(r.os, 'Windows 11')
    assert.equal(r.arch, 'x64')
    assert.equal(r.source, 'main')
  })

  ok('buildReport 超长 message 截断并加省略号', () => {
    const r = reporter.buildReport({ error: new Error('x'.repeat(1500)) })
    assert.ok(r.message.length <= 1001)
    assert.ok(r.message.endsWith('…'))
  })

  ok('渲染层错误 source=renderer 且带代码位置', () => {
    const r = reporter.buildReport({ source: 'renderer', error: new Error('ui fail'), url: 'file:///app.js', line: 12, col: 3 })
    assert.equal(r.source, 'renderer')
    assert.deepEqual(r.extra, { url: 'file:///app.js', line: 12, col: 3 })
  })

  ok('render-gone 构造 RenderProcessGone', () => {
    const r = reporter.buildReport({ source: 'render-gone', reason: 'oom' })
    assert.equal(r.source, 'render-gone')
    assert.equal(r.name, 'RenderProcessGone')
    assert.equal(r.message, 'oom')
  })

  ok('record 落盘且 list 读回一致', () => {
    const { report, file } = reporter.record({ error: new Error('disk-crash') })
    assert.ok(file && fs.existsSync(file))
    const list = reporter.listCrashes()
    assert.equal(list.length, 1)
    assert.equal(list[0].message, 'disk-crash')
    assert.equal(list[0].id, report.id)
  })

  ok('clear 清空全部崩溃记录', () => {
    reporter.record({ error: new Error('another') })
    reporter.clearCrashes()
    assert.equal(reporter.listCrashes().length, 0)
  })

  ok('startLiveness 后检测为异常退出', () => {
    reporter.startLiveness()
    assert.ok(fs.existsSync(path.join(dir, 'liveness.json')))
    assert.equal(reporter.detectUnexpectedExit().unexpected, true)
  })

  ok('endLiveness 后检测为正常退出', () => {
    reporter.endLiveness()
    assert.equal(reporter.detectUnexpectedExit().unexpected, false)
  })

  // ---------------- 上报（异步，注入假 httpPost） ----------------
  const dirUp = fs.mkdtempSync(path.join(os.tmpdir(), 'crash-up-'))
  let posts = 0
  const okReporter = createCrashReporter({
    userDataPath: dirUp,
    httpPost: async () => { posts++; return { status: 200 } }
  })

  await expectAsync('未开启上报：不发送、sent=false', async () => {
    const res = await okReporter.recordAndMaybeSend({ error: new Error('a') }, { crashUpload: false, crashEndpoint: 'https://e' })
    assert.equal(res.sent, false)
    assert.equal(posts, 0)
  })

  await expectAsync('开启上报：发送一次、sent=true', async () => {
    const res = await okReporter.recordAndMaybeSend({ error: new Error('b') }, { crashUpload: true, crashEndpoint: 'https://e' })
    assert.equal(res.sent, true)
    assert.equal(posts, 1)
  })

  const dirFail = fs.mkdtempSync(path.join(os.tmpdir(), 'crash-fail-'))
  const failReporter = createCrashReporter({
    userDataPath: dirFail,
    httpPost: async () => { throw new Error('net down') }
  })
  await expectAsync('上报失败：sent=false 且带 error，不抛出', async () => {
    const res = await failReporter.recordAndMaybeSend({ error: new Error('c') }, { crashUpload: true, crashEndpoint: 'https://e' })
    assert.equal(res.sent, false)
    assert.equal(res.error, 'net down')
  })

  return { dir, dirUp, dirFail }
}

main()
  .then((dirs) => {
    for (const d of Object.values(dirs)) fs.rmSync(d, { recursive: true, force: true })
    console.log(`崩溃记录/存活检测/上报全部通过：${passed} 组`)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
