// ---------------------------------------------------------------------------
// funds.test.mjs —— 资金账户 / 转账（含信用卡、负债）纯逻辑单元测试
// 运行：node test/funds.test.mjs
// ---------------------------------------------------------------------------

import assert from 'node:assert'
import {
  ACCOUNT_TYPES,
  isLiabilityType,
  normalizeAccount,
  validateTransfer,
  accountBalances,
  netWorth,
  transferOutCapacity,
  assertTransferAffordable,
  withAccountRestored,
  withoutAccount,
  withAccountReverted,
  withoutTransfer,
  withTransferRestored
} from '../renderer/charts/funds.mjs'

let passed = 0
function ok(name, fn) {
  fn()
  passed++
}

const cash = { id: 'cash', name: '现金', type: 'cash', openingBalance: 100 }
const bank = { id: 'bank', name: '储蓄卡', type: 'debit', openingBalance: 1000 }
const cc = { id: 'cc', name: '信用卡', type: 'credit', openingBalance: 0, creditLimit: 10000, statementDay: 5, dueDay: 25 }
const debt = { id: 'debt', name: '借条', type: 'debt', openingBalance: 0 }

// ----------------------------- normalizeAccount -----------------------------

ok('现金账户规整：补默认、保留两位', () => {
  const a = normalizeAccount({ name: '钱包', type: 'cash', openingBalance: 12.345 })
  assert.equal(a.name, '钱包')
  assert.equal(a.type, 'cash')
  assert.equal(a.openingBalance, 12.35)
  assert.equal(a.archived, false)
})

ok('名称为空报错', () => {
  assert.throws(() => normalizeAccount({ name: '  ' }), /名称不能为空/)
})

ok('名称超过 10 字报错', () => {
  assert.throws(() => normalizeAccount({ name: '一'.repeat(11) }), /不能超过 10/)
})

ok('非法类型报错', () => {
  assert.throws(() => normalizeAccount({ name: 'x', type: 'nope' }), /类型不正确/)
})

ok('负初始金额报错', () => {
  assert.throws(() => normalizeAccount({ name: 'x', openingBalance: -1 }), /不小于 0/)
})

ok('信用卡规整：保留额度与账单/还款日', () => {
  const a = normalizeAccount({ name: '招行卡', type: 'credit', openingBalance: 0, creditLimit: 20000, statementDay: '8', dueDay: '26' })
  assert.equal(a.creditLimit, 20000)
  assert.equal(a.statementDay, 8)
  assert.equal(a.dueDay, 26)
})

ok('信用卡缺额度报错', () => {
  assert.throws(() => normalizeAccount({ name: 'x', type: 'credit', openingBalance: 0, statementDay: 8, dueDay: 26 }), /信用卡额度/)
})

ok('信用卡账单日越界报错', () => {
  assert.throws(() => normalizeAccount({ name: 'x', type: 'credit', openingBalance: 0, creditLimit: 1, statementDay: 0, dueDay: 26 }), /账单日/)
  assert.throws(() => normalizeAccount({ name: 'x', type: 'credit', openingBalance: 0, creditLimit: 1, statementDay: 32, dueDay: 26 }), /账单日/)
})

ok('信用卡账单/还款日可取月末 29-31', () => {
  const a = normalizeAccount({ name: 'x', type: 'credit', openingBalance: 0, creditLimit: 1, statementDay: 31, dueDay: 30 })
  assert.equal(a.statementDay, 31)
  assert.equal(a.dueDay, 30)
})

ok('类型方向判定：信用卡/负债为负债，其余为资产', () => {
  assert.equal(isLiabilityType('credit'), true)
  assert.equal(isLiabilityType('debt'), true)
  for (const t of ACCOUNT_TYPES.filter((x) => !x.liability)) assert.equal(isLiabilityType(t.value), false)
})

// ----------------------------- validateTransfer -----------------------------

ok('转账校验通过并规整', () => {
  const t = validateTransfer({ fromId: 'bank', toId: 'cash', amount: '100.5', date: '2026-09-20', note: '提现' }, [bank, cash])
  assert.deepEqual(t, { fromId: 'bank', toId: 'cash', amount: 100.5, date: '2026-09-20', note: '提现' })
})

ok('同账户互转报错', () => {
  assert.throws(() => validateTransfer({ fromId: 'bank', toId: 'bank', amount: 10, date: '2026-09-20' }, [bank]), /不能相同/)
})

ok('转账金额非正报错', () => {
  assert.throws(() => validateTransfer({ fromId: 'bank', toId: 'cash', amount: 0, date: '2026-09-20' }, [bank, cash]), /大于 0/)
})

ok('账户不存在报错', () => {
  assert.throws(() => validateTransfer({ fromId: 'bank', toId: 'ghost', amount: 10, date: '2026-09-20' }, [bank]), /不存在/)
})

ok('转账日期非法报错', () => {
  assert.throws(() => validateTransfer({ fromId: 'bank', toId: 'cash', amount: 10, date: '2026-9-1' }, [bank, cash]), /日期/)
})

// ----------------------------- accountBalances ------------------------------

ok('资产账户：初始 + 收入 − 支出', () => {
  const records = [
    { type: 'income', amount: 50, accountId: 'cash' },
    { type: 'expense', amount: 30, accountId: 'cash' }
  ]
  const [r] = accountBalances([cash], records, [])
  assert.equal(r.balance, 120)
  assert.equal(r.debt, 0)
})

ok('信用卡：消费增加欠款并计算可用额度', () => {
  const records = [{ type: 'expense', amount: 2000, accountId: 'cc' }]
  const [r] = accountBalances([cc], records, [])
  assert.equal(r.debt, 2000)
  assert.equal(r.available, 8000)
})

ok('资产间转账（提现）：总资产不变、各账户此增彼减', () => {
  const transfers = [{ fromId: 'bank', toId: 'cash', amount: 200, date: '2026-09-20' }]
  const rs = accountBalances([bank, cash], [], transfers)
  const b = rs.find((x) => x.id === 'bank')
  const c = rs.find((x) => x.id === 'cash')
  assert.equal(b.balance, 800)
  assert.equal(c.balance, 300)
  assert.equal(netWorth(rs).assets, 1100)
})

ok('还款：资产减少、信用卡欠款减少', () => {
  const records = [{ type: 'expense', amount: 2000, accountId: 'cc' }]
  const transfers = [{ fromId: 'bank', toId: 'cc', amount: 1500, date: '2026-09-20' }]
  const rs = accountBalances([bank, cc], records, transfers)
  assert.equal(rs.find((x) => x.id === 'bank').balance, -500)
  assert.equal(rs.find((x) => x.id === 'cc').debt, 500)
})

ok('借款（负债转出到现金）：现金增加、负债欠款增加', () => {
  const transfers = [{ fromId: 'debt', toId: 'cash', amount: 500, date: '2026-09-20' }]
  const rs = accountBalances([cash, debt], [], transfers)
  assert.equal(rs.find((x) => x.id === 'cash').balance, 600)
  assert.equal(rs.find((x) => x.id === 'debt').debt, 500)
})

ok('未指定账户的流水不影响任何账户余额', () => {
  const records = [
    { type: 'expense', amount: 999 },
    { type: 'income', amount: 888, accountId: '' }
  ]
  const [r] = accountBalances([cash], records, [])
  assert.equal(r.balance, 100)
})

// ------------------------------- netWorth ----------------------------------

ok('净资产 = 总资产 − 总负债', () => {
  const records = [{ type: 'expense', amount: 2000, accountId: 'cc' }]
  const rs = accountBalances([bank, cash, cc], records, [])
  const w = netWorth(rs)
  assert.equal(w.assets, 1100)
  assert.equal(w.debts, 2000)
  assert.equal(w.net, -900)
})

// --------------------------- 转账余额 / 额度校验 ---------------------------

ok('转出上限：储蓄卡按余额、信用卡按可用额度、纯负债不限', () => {
  const records = [{ type: 'expense', amount: 2000, accountId: 'cc' }]
  const rs = accountBalances([bank, cc, debt], records, [])
  assert.equal(transferOutCapacity(rs.find((x) => x.id === 'bank')), 1000)
  assert.equal(transferOutCapacity(rs.find((x) => x.id === 'cc')), 8000)
  assert.equal(transferOutCapacity(rs.find((x) => x.id === 'debt')), Infinity)
})

ok('储蓄卡足额转出通过、超额报错', () => {
  const rs = accountBalances([bank, cc], [], [])
  assert.doesNotThrow(() => assertTransferAffordable({ fromId: 'bank', amount: 1000 }, rs))
  assert.throws(() => assertTransferAffordable({ fromId: 'bank', amount: 1000.01 }, rs), /余额不足/)
})

ok('储蓄卡向信用卡还款超额会被拦截（用户场景）', () => {
  const rs = accountBalances([bank, cc], [], [])
  assert.throws(() => assertTransferAffordable({ fromId: 'bank', toId: 'cc', amount: 1500 }, rs), /最多可转/)
})

ok('信用卡套现不超可用额度通过、超额报错', () => {
  const records = [{ type: 'expense', amount: 2000, accountId: 'cc' }]
  const rs = accountBalances([cc, cash], records, [])
  assert.doesNotThrow(() => assertTransferAffordable({ fromId: 'cc', amount: 8000 }, rs))
  assert.throws(() => assertTransferAffordable({ fromId: 'cc', amount: 8000.01 }, rs), /可用额度不足/)
})

ok('负债 / 借贷账户转出不设上限', () => {
  const rs = accountBalances([debt, cash], [], [])
  assert.doesNotThrow(() => assertTransferAffordable({ fromId: 'debt', amount: 999999 }, rs))
})

// ----------------------------- 撤销数据变换 --------------------------------

ok('withAccountRestored：缺失则加回、已存在则原数组不动', () => {
  const list = [cash, bank]
  assert.equal(withAccountRestored(list, cc).length, 3)
  assert.equal(withAccountRestored(list, cash), list)
})

ok('withoutAccount / withAccountReverted：移除账户与覆盖旧账户', () => {
  const list = [cash, bank]
  assert.deepEqual(withoutAccount(list, 'bank').map((a) => a.id), ['cash'])
  const old = { ...bank, name: '旧储蓄卡' }
  const out = withAccountReverted(list, old)
  assert.equal(out.find((a) => a.id === 'bank').name, '旧储蓄卡')
  assert.equal(out.length, 2)
})

ok('withoutTransfer / withTransferRestored：移除与加回转账', () => {
  const t1 = { id: 't1', fromId: 'bank', toId: 'cash', amount: 10, date: '2026-09-20' }
  const t2 = { id: 't2', fromId: 'cash', toId: 'bank', amount: 20, date: '2026-09-20' }
  const list = [t1, t2]
  assert.deepEqual(withoutTransfer(list, 't1').map((t) => t.id), ['t2'])
  assert.equal(withTransferRestored(withoutTransfer(list, 't1'), t1).length, 2)
  assert.equal(withTransferRestored(list, t1), list)
})

console.log(`资金账户/转账全部通过：${passed} 组`)
