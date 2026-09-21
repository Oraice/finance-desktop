// ---------------------------------------------------------------------------
// file-store.test.mjs —— 原子写入与损坏自愈单元测试
// 运行：node test/file-store.test.mjs
// ---------------------------------------------------------------------------

import assert from 'node:assert'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { atomicWrite, atomicWriteJson, readJsonOrQuarantine } = require('../file-store.cjs')

let passed = 0
const ok = (name, fn) => { fn(); passed++ }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-store-'))
const p = (name) => path.join(dir, name)

ok('atomicWrite 写入并读回一致', () => {
  const f = p('a.json')
  atomicWrite(f, 'hello-账本')
  assert.equal(fs.readFileSync(f, 'utf8'), 'hello-账本')
})

ok('atomicWriteJson 写入对象、读回 deepEqual', () => {
  const f = p('b.json')
  const obj = { id: 'x', n: 1, name: '储蓄卡' }
  atomicWriteJson(f, obj)
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), obj)
})

ok('覆盖已有文件后是新内容、无残留临时文件', () => {
  const f = p('c.json')
  atomicWrite(f, 'old')
  atomicWrite(f, 'new')
  assert.equal(fs.readFileSync(f, 'utf8'), 'new')
  const leftovers = fs.readdirSync(dir).filter((x) => x.includes('.tmp'))
  assert.equal(leftovers.length, 0)
})

ok('readJsonOrQuarantine 正常返回对象', () => {
  const f = p('d.json')
  atomicWriteJson(f, { a: 1 })
  assert.deepEqual(readJsonOrQuarantine(f), { a: 1 })
})

ok('文件不存在返回 null', () => {
  assert.equal(readJsonOrQuarantine(p('nope.json')), null)
})

ok('损坏 JSON：返回 null、隔离坏文件、触发 onIssue', () => {
  const f = p('broken.json')
  fs.writeFileSync(f, '{ this is : not json ,,', 'utf8')
  let called = ''
  const r = readJsonOrQuarantine(f, (msg) => { called = msg })
  assert.equal(r, null)
  assert.match(called, /已隔离/)
  assert.equal(fs.existsSync(f), false) // 原损坏文件已被移走
  const corrupt = fs.readdirSync(dir).filter((x) => x.startsWith('broken.json.corrupt-'))
  assert.equal(corrupt.length, 1)
})

fs.rmSync(dir, { recursive: true, force: true })
console.log(`文件原子写入/自愈全部通过：${passed} 组`)
