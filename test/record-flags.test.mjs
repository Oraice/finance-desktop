// record-flags 单元测试：node test/record-flags.test.mjs
import assert from 'node:assert'
import {
  toCashRecords, toPnlRecords, advanceStatus,
  makeRefund, makeAdvance, makeReimburse
} from '../renderer/lib/record-flags.mjs'
import { categoryShare } from '../renderer/charts/dashboard.mjs'
import { accountBalances } from '../renderer/charts/funds.mjs'

let passed = 0
const ok = (name, fn) => { fn(); passed++; console.log('  ✔', name) }

console.log('record-flags 退款 / 代垫 / 报销单元测试')

const cashAcct = () => [{ id: 'ac1', type: 'cash', name: '现金', openingBalance: 0 }]

// ------------------------------ 投影 ----------------------------------------

ok('toCashRecords：退款转负支出，代垫 / 报销 / 普通原样', () => {
  const list = [
    { id: '1', type: 'expense', amount: 100, flag: 'refund' },
    { id: '2', type: 'expense', amount: 30, flag: 'advance' },
    { id: '3', type: 'income', amount: 30, flag: 'reimburse' },
    { id: '4', type: 'expense', amount: 20 }
  ]
  const out = toCashRecords(list)
  assert.strictEqual(out[0].amount, -100)
  assert.strictEqual(out[1].amount, 30)
  assert.strictEqual(out[2].amount, 30)
  assert.strictEqual(out[3].amount, 20)
})

ok('toPnlRecords：剔除代垫与报销，退款转负，普通保留', () => {
  const list = [
    { id: '1', type: 'expense', amount: 100, flag: 'refund' },
    { id: '2', type: 'expense', amount: 30, flag: 'advance' },
    { id: '3', type: 'income', amount: 30, flag: 'reimburse' },
    { id: '4', type: 'income', amount: 500 }
  ]
  const out = toPnlRecords(list)
  assert.deepStrictEqual(out.map((x) => x.id), ['1', '4'])
  assert.strictEqual(out[0].amount, -100)
})

ok('advanceStatus：无报销为 pending，有指向它的报销为 done', () => {
  const adv = makeAdvance({ date: '2026-09-10', amount: 50 })
  assert.strictEqual(advanceStatus([adv], adv.id), 'pending')
  const reb = makeReimburse(adv, { date: '2026-09-20', amount: 50 })
  assert.strictEqual(advanceStatus([adv, reb], adv.id), 'done')
})

// ------------------------------ 创建 / 校验 ---------------------------------

ok('makeRefund：字段、关联、原分类正确', () => {
  const orig = { id: 'o1', date: '2026-09-10', type: 'expense', category: '餐饮', amount: 100, accountId: 'ac1' }
  const rf = makeRefund(orig, { date: '2026-09-12', amount: 100 })
  assert.strictEqual(rf.flag, 'refund')
  assert.strictEqual(rf.type, 'expense')
  assert.strictEqual(rf.category, '餐饮')
  assert.strictEqual(rf.linkId, 'o1')
  assert.strictEqual(rf.accountId, 'ac1')
})

ok('makeRefund：非支出、超额、非正数均抛错', () => {
  const orig = { id: 'o1', date: '2026-09-10', type: 'expense', category: '餐饮', amount: 100 }
  assert.throws(() => makeRefund({ type: 'income', amount: 100 }, { amount: 10 }), /支出/)
  assert.throws(() => makeRefund(orig, { amount: 101 }), /不能超过/)
  assert.throws(() => makeRefund(orig, { amount: 0 }), /金额/)
})

ok('makeAdvance：代垫为支出，非法金额 / 日期抛错', () => {
  const adv = makeAdvance({ date: '2026-09-10', amount: 500, accountId: 'ac1' })
  assert.strictEqual(adv.flag, 'advance')
  assert.strictEqual(adv.type, 'expense')
  assert.strictEqual(adv.accountId, 'ac1')
  assert.throws(() => makeAdvance({ date: '2026-09-10', amount: -1 }), /金额/)
  assert.throws(() => makeAdvance({ date: '坏日期', amount: 10 }), /日期/)
})

ok('makeReimburse：报销为收入并关联代垫，非法输入抛错', () => {
  const adv = makeAdvance({ date: '2026-09-10', amount: 500 })
  const reb = makeReimburse(adv, { date: '2026-09-20', amount: 500, accountId: 'ac1' })
  assert.strictEqual(reb.flag, 'reimburse')
  assert.strictEqual(reb.type, 'income')
  assert.strictEqual(reb.linkId, adv.id)
  assert.throws(() => makeReimburse({ flag: 'refund' }, { date: '2026-09-20', amount: 1 }), /代垫/)
  assert.throws(() => makeReimburse(adv, { date: '2026-09-20', amount: 501 }), /不能超过/)
  assert.throws(() => makeReimburse(adv, { date: '坏', amount: 1 }), /日期/)
})

ok('createdAt：操作记录带精确时刻，可显式传入', () => {
  const orig = { id: 'o1', date: '2026-09-10', type: 'expense', category: '餐饮', amount: 100 }
  const rf = makeRefund(orig, { date: '2026-09-12', amount: 100 })
  assert.ok(rf.createdAt, '退款应带 createdAt')
  const fixed = '2026-09-12T08:30:00.000Z'
  const adv = makeAdvance({ date: '2026-09-10', amount: 50, createdAt: fixed })
  assert.strictEqual(adv.createdAt, fixed)
  const reb = makeReimburse(adv, { date: '2026-09-20', amount: 50 })
  assert.ok(reb.createdAt, '报销应带 createdAt')
})

// ---------------------------- 组合口径不变量 ---------------------------------

ok('全额退款：损益分类净额为 0，资金余额回到初始', () => {
  const orig = { id: 'o1', date: '2026-09-10', type: 'expense', category: '餐饮', amount: 100, accountId: 'ac1' }
  const rf = makeRefund(orig, { date: '2026-09-12', amount: 100 })
  // 损益：餐饮 100 + (-100) = 0，占比中不再出现
  const share = categoryShare(toPnlRecords([orig, rf]))
  assert.ok(!share.some((x) => x.name === '餐饮'))
  // 资金：现金 -100 后加回，余额 0
  const bals = accountBalances(cashAcct(), toCashRecords([orig, rf]), [])
  assert.strictEqual(bals[0].balance, 0)
})

ok('部分退款：损益分类净额为剩余额', () => {
  const orig = { id: 'o1', date: '2026-09-10', type: 'expense', category: '餐饮', amount: 100, accountId: 'ac1' }
  const rf = makeRefund(orig, { date: '2026-09-12', amount: 40 })
  const share = categoryShare(toPnlRecords([orig, rf]))
  assert.strictEqual(share[0].value, 60)
})

ok('代垫 + 报销：损益不计收支，资金先减后加余额为 0', () => {
  const adv = makeAdvance({ date: '2026-09-10', amount: 500, accountId: 'ac1' })
  const reb = makeReimburse(adv, { date: '2026-09-20', amount: 500, accountId: 'ac1' })
  // 损益：两笔均剔除
  assert.strictEqual(toPnlRecords([adv, reb]).length, 0)
  // 资金：现金 -500 +500 = 0
  const bals = accountBalances(cashAcct(), toCashRecords([adv, reb]), [])
  assert.strictEqual(bals[0].balance, 0)
})

console.log(`\n全部通过：${passed} 组用例 ✅`)
