// 数据备份与恢复单元测试：node test/backup.test.mjs
import assert from 'node:assert'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const backup = require('../backup-core.cjs')

let passed = 0
const ok = (name, fn) => { fn(); passed++; console.log('  ✔', name) }

console.log('backup 单元测试')

const sampleAccounts = [
  { id: 'a1', username: '老王', hash: 'h', salt: 's', autoLogin: true, encPass: 'secret-enc' },
  { id: 'a2', username: '小李', hash: 'h2', salt: 's2', autoLogin: false, encPass: null }
]
const sampleLedgers = [
  { id: 'l1', ownerId: 'a1', name: '个人账', records: [{ id: 'r1' }, { id: 'r2' }] },
  { id: 'l2', ownerId: 'a2', name: '公司账', records: [{ id: 'r3' }] }
]

ok('buildBackup：结构与字段正确', () => {
  const b = backup.buildBackup(sampleAccounts, sampleLedgers, 1000)
  assert.strictEqual(b.format, backup.FORMAT)
  assert.strictEqual(b.createdAt, 1000)
  assert.strictEqual(b.accounts.length, 2)
  assert.strictEqual(b.ledgers.length, 2)
})

ok('明文备份：序列化 → 解析往返一致', () => {
  const b = backup.buildBackup(sampleAccounts, sampleLedgers)
  const text = backup.serializeBackup(b, '')
  assert.ok(!backup.isEncrypted(text))
  const parsed = backup.parseBackup(text)
  assert.strictEqual(parsed.ledgers[0].name, '个人账')
  assert.strictEqual(parsed.accounts[1].username, '小李')
})

ok('摘要：账户/账本/流水数量正确', () => {
  const b = backup.buildBackup(sampleAccounts, sampleLedgers)
  const s = backup.summarizeBackup(b)
  assert.strictEqual(s.accountCount, 2)
  assert.strictEqual(s.ledgerCount, 2)
  assert.strictEqual(s.recordCount, 3)
  assert.deepStrictEqual(s.ledgerNames, ['个人账', '公司账'])
})

ok('加密备份：正确密码可往返，且标记为加密', () => {
  const b = backup.buildBackup(sampleAccounts, sampleLedgers)
  const text = backup.serializeBackup(b, 'mypassword123')
  assert.ok(backup.isEncrypted(text))
  // 无密码应报加密错误
  assert.throws(() => backup.parseBackup(text), /加密/)
  const parsed = backup.parseBackup(text, 'mypassword123')
  assert.strictEqual(parsed.ledgers[1].name, '公司账')
})

ok('加密备份：错误密码被拒绝', () => {
  const text = backup.serializeBackup(backup.buildBackup(sampleAccounts, sampleLedgers), 'right-pw-123')
  assert.throws(() => backup.parseBackup(text, 'wrong-pw-999'), /密码不正确|损坏/)
})

ok('损坏/非法文件：解析报错', () => {
  assert.throws(() => backup.parseBackup('这不是JSON'), /无法解析/)
  assert.throws(() => backup.parseBackup(JSON.stringify({ format: 'unknown' })), /无法识别/)
  assert.throws(
    () => backup.parseBackup(JSON.stringify({ format: backup.FORMAT, accounts: null, ledgers: [] })),
    /损坏|不完整/
  )
})

ok('normalizeOnRestore：关闭自动登录并清空 encPass', () => {
  const b = backup.buildBackup(sampleAccounts, sampleLedgers)
  backup.normalizeOnRestore(b)
  for (const a of b.accounts) {
    assert.strictEqual(a.autoLogin, false)
    assert.strictEqual(a.encPass, null)
  }
})

console.log(`\n全部通过：${passed} 组用例 ✅`)
