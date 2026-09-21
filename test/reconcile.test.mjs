// ---------------------------------------------------------------------------
// reconcile.test.mjs —— 账户对账纯逻辑单元测试。运行：node test/reconcile.test.mjs
// ---------------------------------------------------------------------------

import assert from 'node:assert'
import { reconcileDiff, normalizeReconciliation, adjustmentRecord } from '../renderer/charts/reconcile.mjs'

let passed = 0
function ok(name, fn) {
  fn()
  passed++
}

const asset = { id: 'a1', name: '储蓄卡', type: 'debit', balance: 1000, debt: 0 }
const cc = { id: 'c1', name: '信用卡', type: 'credit', balance: 0, debt: 500 }

ok('reconcileDiff：资产盘盈 / 盘亏', () => {
  assert.deepEqual(reconcileDiff(asset, 1200), { isLiab: false, systemValue: 1000, actualValue: 1200, diff: 200 })
  assert.deepEqual(reconcileDiff(asset, 800), { isLiab: false, systemValue: 1000, actualValue: 800, diff: -200 })
})

ok('reconcileDiff：负债比欠款，含两位小数', () => {
  assert.deepEqual(reconcileDiff(cc, 600), { isLiab: true, systemValue: 500, actualValue: 600, diff: 100 })
  const r = reconcileDiff(cc, 400.25)
  assert.equal(r.isLiab, true)
  assert.equal(r.systemValue, 500)
  assert.equal(r.actualValue, 400.25)
  assert.equal(r.diff, -99.75)
})

ok('normalizeReconciliation：合法记录规整（无 id）', () => {
  const r = normalizeReconciliation({
    accountId: 'a1', accountName: '储蓄卡', date: '2026-09-20',
    systemValue: 1000, actualValue: 1200.25, adjusted: true, note: '月末对账'
  })
  assert.deepEqual(r, {
    accountId: 'a1', accountName: '储蓄卡', date: '2026-09-20',
    systemValue: 1000, actualValue: 1200.25, diff: 200.25,
    adjusted: true, note: '月末对账'
  })
})

ok('normalizeReconciliation：缺账户 / 非法日期抛错，adjusted 默认 false', () => {
  assert.throws(() => normalizeReconciliation({ date: '2026-09-20' }), /缺少对账账户/)
  assert.throws(() => normalizeReconciliation({ accountId: 'a1', date: '2026-9-20' }), /对账日期不正确/)
  const r = normalizeReconciliation({ accountId: 'a1', date: '2026-09-20', systemValue: 1, actualValue: 1 })
  assert.equal(r.adjusted, false)
  assert.equal(r.note, '')
})

ok('adjustmentRecord：资产盘盈记收入、盘亏记支出', () => {
  const gain = adjustmentRecord(asset, reconcileDiff(asset, 1200))
  assert.deepEqual(gain, {
    date: '', type: 'income', category: '对账调整', amount: 200,
    note: '储蓄卡 对账盘盈', accountId: 'a1', source: '对账'
  })
  const loss = adjustmentRecord(asset, reconcileDiff(asset, 800))
  assert.equal(loss.type, 'expense')
  assert.equal(loss.amount, 200)
  assert.equal(loss.note, '储蓄卡 对账盘亏')
})

ok('adjustmentRecord：负债欠多记支出、欠少记收入', () => {
  const more = adjustmentRecord(cc, reconcileDiff(cc, 600))
  assert.equal(more.type, 'expense')
  assert.equal(more.amount, 100)
  assert.equal(more.note, '信用卡 对账欠款盘盈')
  const less = adjustmentRecord(cc, reconcileDiff(cc, 400))
  assert.equal(less.type, 'income')
  assert.equal(less.amount, 100)
  assert.equal(less.note, '信用卡 对账欠款盘亏')
})

ok('adjustmentRecord：差额为 0 返回 null', () => {
  assert.equal(adjustmentRecord(asset, reconcileDiff(asset, 1000)), null)
})

console.log(`账户对账全部通过：${passed} 组`)
