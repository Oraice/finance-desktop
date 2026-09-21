// ---------------------------------------------------------------------------
// e2e.mjs —— 真实业务链路端到端测试（经 preload → IPC → 主进程 → 本地文件）
// 仅在独立临时 userData 中运行（main.js --e2e 负责隔离），不污染真实数据。
// 结果写入 window.__e2eResult，主进程据此决定退出码。
// ---------------------------------------------------------------------------

import { accountBalances, validateTransfer, assertTransferAffordable } from '../../renderer/charts/funds.mjs'
import { toCashRecords, toPnlRecords, advanceStatus, makeRefund, makeAdvance, makeReimburse } from '../../renderer/lib/record-flags.mjs'

const steps = []
function assert(cond, msg) { if (!cond) throw new Error(msg) }
async function astep(name, fn) {
  try {
    const detail = await fn()
    steps.push({ name, ok: true, detail: detail == null ? '' : String(detail) })
    return detail
  } catch (e) {
    steps.push({ name, ok: false, detail: String((e && e.message) || e) })
    return null
  }
}

const API = window.ledgerAPI
const AUTH = window.authAPI
const U = 'e2e_user'
const P = 'E2e123456'

// 1. 注册
await astep('注册账户', async () => {
  const r = await AUTH.register(U, P, false)
  assert(r && r.ok, (r && r.error) || '注册失败')
  return r.username
})

// 2. 建账本
const created = await astep('创建账本', async () => {
  const l = await API.create('E2E测试账本', '')
  assert(l && l.id, '建账失败')
  return l
})
const lid = created && created.id

// 3. 资金账户
await astep('新增储蓄卡与信用卡', async () => {
  const bank = { id: 'acct-bank', name: '储蓄卡', type: 'debit', openingBalance: 5000, archived: false }
  const cc = { id: 'acct-cc', name: '信用卡', type: 'credit', openingBalance: 0, creditLimit: 10000, statementDay: 5, dueDay: 25, archived: false }
  await API.saveFunds(lid, [bank, cc], [])
  const full = await API.get(lid)
  assert(full.accounts.length === 2, '账户数应为 2')
})

// 4. 记账
await astep('记工资收入与信用卡消费', async () => {
  const recs = [
    { id: 'r1', date: '2026-09-01', type: 'income', category: '工资', amount: 8000, note: '工资', accountId: 'acct-bank', source: 'E2E' },
    { id: 'r2', date: '2026-09-02', type: 'expense', category: '餐饮', amount: 2500, note: '聚餐', accountId: 'acct-cc', source: 'E2E' }
  ]
  await API.saveRecords(lid, recs, [])
  const full = await API.get(lid)
  assert(full.records.length === 2, '流水数应为 2')
})

// 5. 转账还款
await astep('储蓄卡向信用卡还款 2000', async () => {
  const full = await API.get(lid)
  const t = { id: 'tr1', date: '2026-09-03', fromId: 'acct-bank', toId: 'acct-cc', amount: 2000, note: '还款', source: 'E2E' }
  const before = accountBalances(full.accounts, full.records, full.transfers)
  assertTransferAffordable(t, before)
  await API.saveFunds(lid, full.accounts, [...full.transfers, t])
})

// 6. 余额断言
await astep('断言余额 / 欠款 / 可用额度', async () => {
  const full = await API.get(lid)
  const bals = accountBalances(full.accounts, full.records, full.transfers)
  const bank = bals.find((x) => x.id === 'acct-bank')
  const cc = bals.find((x) => x.id === 'acct-cc')
  assert(Math.abs(bank.balance - 11000) < 0.001, '储蓄卡余额应为 11000，实际 ' + bank.balance)
  assert(Math.abs(cc.debt - 500) < 0.001, '信用卡欠款应为 500，实际 ' + cc.debt)
  assert(Math.abs(cc.available - 9500) < 0.001, '可用额度应为 9500，实际 ' + cc.available)
  return 'bank 11000 / cc debt 500 / available 9500'
})

// 7. 非法转账拦截
await astep('超额还款与同账户转账被拦截', async () => {
  const full = await API.get(lid)
  const bals = accountBalances(full.accounts, full.records, full.transfers)
  let blocked = false
  try { assertTransferAffordable({ fromId: 'acct-bank', amount: 999999 }, bals) }
  catch (e) { blocked = /余额不足|最多可转/.test(e.message) }
  assert(blocked, '超额转账应被拦截')
  let same = false
  try { validateTransfer({ fromId: 'acct-bank', toId: 'acct-bank', amount: 1, date: '2026-09-03' }, full.accounts) }
  catch { same = true }
  assert(same, '同账户转账应被拒')
})

// 8. Excel 导入
await astep('Excel 生成 → 解析 → 落盘', async () => {
  await import('../../renderer/vendor/xlsx.full.min.js')
  const XLSX = window.XLSX
  assert(XLSX && XLSX.utils, 'XLSX 未加载')
  const ic = await import('../../renderer/xlsx/import-core.mjs')
  const aoa = [
    ['日期', '类型', '金额', '分类', '备注'],
    ['2026-09-10', '支出', 100, '交通', '地铁'],
    ['2026-09-11', '支出', 200, '购物', '超市'],
    ['2026-09-12', '收入', 300, '工资', '兼职']
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const grid = ic.sheetToGrid(ws, XLSX)
  const hr = ic.detectHeaderRow(grid)
  const map = ic.guessMapping(grid[hr])
  const out = ic.normalizeRecords(grid, hr, map)
  assert(out.records.length === 3, '应解析 3 条，实际 ' + out.records.length)
  const full = await API.get(lid)
  const imported = out.records.map((r, i) => ({ id: 'imp-' + i, source: '导入', ...r }))
  await API.saveRecords(lid, [...full.records, ...imported], [])
  const after = await API.get(lid)
  assert(after.records.length === 5, '总流水应为 5，实际 ' + after.records.length)
})

// 9. 退款冲正 + 代垫报销闭环
await astep('退款冲正与代垫报销闭环', async () => {
  const full = await API.get(lid)
  const beforeBals = accountBalances(full.accounts, toCashRecords(full.records), full.transfers)
  const bankBefore = beforeBals.find((x) => x.id === 'acct-bank').balance

  // (a) 消费 600 → 退款 600；(b) 代垫 800 → 报销 800，均走储蓄卡
  const spend = { id: 'rf-orig', date: '2026-09-15', type: 'expense', category: '购物', amount: 600, accountId: 'acct-bank', source: 'E2E' }
  const refund = makeRefund(spend, { date: '2026-09-16', amount: 600 })
  const adv = makeAdvance({ date: '2026-09-17', amount: 800, accountId: 'acct-bank' })
  const reb = makeReimburse(adv, { date: '2026-09-18', amount: 800, accountId: 'acct-bank' })
  await API.saveRecords(lid, [...full.records, spend, refund, adv, reb], [])

  const after = await API.get(lid)
  // 资金：储蓄卡 -600+600-800+800，余额应与操作前一致
  const bals = accountBalances(after.accounts, toCashRecords(after.records), after.transfers)
  const bankAfter = bals.find((x) => x.id === 'acct-bank').balance
  assert(Math.abs(bankAfter - bankBefore) < 0.001, '退款/报销后储蓄卡余额应不变，实际 ' + bankAfter + ' vs ' + bankBefore)
  // 损益：剔除代垫与报销；代垫状态应为已报销
  const pnl = toPnlRecords(after.records)
  assert(!pnl.some((r) => r.category === '代垫' || r.category === '报销'), '损益不应含代垫 / 报销')
  assert(advanceStatus(after.records, adv.id) === 'done', '代垫应为已报销状态')
  return '储蓄卡余额不变 / 损益无代垫报销 / 代垫已报销'
})

// 10. 多账本汇总
await astep('多账本汇总', async () => {
  await API.create('第二个账本', '')
  const all = await API.all()
  assert(all.length === 2, '应有 2 个账本，实际 ' + all.length)
})

const ok = steps.every((s) => s.ok)
window.__e2eResult = {
  ok,
  steps,
  count: { total: steps.length, passed: steps.filter((s) => s.ok).length },
  at: new Date().toISOString()
}
document.getElementById('e2e-out').textContent = ok ? 'PASS' : 'FAIL'
