// ---------------------------------------------------------------------------
// recurring.test.mjs —— 周期记账纯逻辑单元测试。运行：node test/recurring.test.mjs
// ---------------------------------------------------------------------------

import assert from 'node:assert'
import {
  FREQUENCIES,
  advanceDate,
  nthOccurrence,
  normalizeRecurring,
  dueDates,
  dueRecords,
  occurrenceRecord,
  isValidDate
} from '../renderer/charts/recurring.mjs'

let passed = 0
function ok(name, fn) {
  fn()
  passed++
}

const tpl = (over = {}) => normalizeRecurring({ startDate: '2026-01-01', amount: 100, frequency: 'monthly', ...over })

// ------------------------------ advanceDate --------------------------------

ok('advanceDate：每天 / 每周 / 每两周', () => {
  assert.equal(advanceDate('2026-09-20', 'daily', 1), '2026-09-21')
  assert.equal(advanceDate('2026-09-20', 'weekly', 1), '2026-09-27')
  assert.equal(advanceDate('2026-09-20', 'weekly', 2), '2026-10-04')
})

ok('advanceDate：每月单次，31 号落到 2/28', () => {
  assert.equal(advanceDate('2026-01-31', 'monthly', 1), '2026-02-28')
  assert.equal(advanceDate('2026-09-15', 'monthly', 1), '2026-10-15')
})

ok('advanceDate：每年，2/29 在平年落到 2/28', () => {
  assert.equal(advanceDate('2024-02-29', 'yearly', 1), '2025-02-28')
})

// ---------------------------- nthOccurrence -------------------------------

ok('nthOccurrence：每月锚定原始日，短月月末、长月回原日', () => {
  const t = tpl({ startDate: '2026-01-31' })
  assert.equal(nthOccurrence(t, 0), '2026-01-31')
  assert.equal(nthOccurrence(t, 1), '2026-02-28')
  assert.equal(nthOccurrence(t, 2), '2026-03-31')
  assert.equal(nthOccurrence(t, 3), '2026-04-30')
})

ok('nthOccurrence：interval=2 月 / 每周', () => {
  assert.equal(nthOccurrence(tpl({ startDate: '2026-01-10', interval: 2 }), 1), '2026-03-10')
  const w = tpl({ startDate: '2026-09-01', frequency: 'weekly' })
  assert.equal(nthOccurrence(w, 0), '2026-09-01')
  assert.equal(nthOccurrence(w, 2), '2026-09-15')
})

// --------------------------- normalizeRecurring ---------------------------

ok('normalizeRecurring：补默认值（分类 / active / interval / anchor）', () => {
  const t = tpl({ amount: 1500 })
  assert.equal(t.category, '未分类')
  assert.equal(t.active, true)
  assert.equal(t.interval, 1)
  assert.equal(t.anchorDate, '2026-01-01')
  assert.equal(t.lastRunDate, '')
  assert.equal(t.amount, 1500)
})

ok('normalizeRecurring：收入默认分类为其他收入，可显式停用', () => {
  assert.equal(tpl({ type: 'income' }).category, '其他收入')
  assert.equal(tpl({ active: false }).active, false)
})

ok('normalizeRecurring：金额 0 / 负数 / 缺开始日期抛错', () => {
  assert.throws(() => tpl({ amount: 0 }), /大于 0/)
  assert.throws(() => tpl({ amount: -5 }), /大于 0/)
  assert.throws(() => normalizeRecurring({ amount: 100 }), /开始日期/)
})

ok('normalizeRecurring：结束早于开始 / 非法间隔 / 非法频率抛错', () => {
  assert.throws(() => tpl({ endDate: '2025-12-01' }), /结束日期/)
  assert.throws(() => tpl({ interval: 0 }), /间隔/)
  assert.throws(() => tpl({ frequency: 'xxx' }), /频率/)
})

// ------------------------------- dueDates ---------------------------------

ok('dueDates：从未运行，区间内每月各一次（含边界）', () => {
  assert.deepEqual(dueDates(tpl(), '2026-04-01'),
    ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01'])
})

ok('dueDates：已入账到 2/1，只返回 3/1、4/1', () => {
  const t = tpl({ lastRunDate: '2026-02-01' })
  assert.deepEqual(dueDates(t, '2026-04-01'), ['2026-03-01', '2026-04-01'])
})

ok('dueDates：endDate 截断，之后不再生成', () => {
  const t = tpl({ endDate: '2026-03-01' })
  assert.deepEqual(dueDates(t, '2026-06-01'),
    ['2026-01-01', '2026-02-01', '2026-03-01'])
})

ok('dueDates：停用模板 / upTo 早于开始 返回空', () => {
  assert.deepEqual(dueDates(tpl({ active: false }), '2026-06-01'), [])
  assert.deepEqual(dueDates(tpl(), '2025-12-31'), [])
})

ok('dueDates：每周在区间内 3 次', () => {
  const t = tpl({ startDate: '2026-09-01', frequency: 'weekly' })
  assert.deepEqual(dueDates(t, '2026-09-20'),
    ['2026-09-01', '2026-09-08', '2026-09-15'])
})

// ----------------------------- records 转换 -------------------------------

ok('occurrenceRecord / dueRecords：字段与来源正确', () => {
  const t = tpl({ startDate: '2026-01-05', category: '房租', amount: 1500, accountId: 'bank', note: '月租' })
  assert.deepEqual(occurrenceRecord(t, '2026-01-05'), {
    date: '2026-01-05', type: 'expense', category: '房租', amount: 1500,
    note: '月租', accountId: 'bank', source: '周期'
  })
  const recs = dueRecords(t, '2026-02-05')
  assert.equal(recs.length, 2)
  assert.equal(recs[0].date, '2026-01-05')
  assert.equal(recs[1].source, '周期')
})

ok('isValidDate：合法 / 非法日期', () => {
  assert.equal(isValidDate('2026-02-28'), true)
  assert.equal(isValidDate('2026-02-30'), false)
  assert.equal(isValidDate(''), false)
})

console.log(`周期记账全部通过：${passed} 组`)
