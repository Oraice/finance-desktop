// ---------------------------------------------------------------------------
// reminders.test.mjs —— 账单日 / 还款日提醒纯逻辑单元测试。运行：node test/reminders.test.mjs
// ---------------------------------------------------------------------------

import assert from 'node:assert'
import { upcomingCreditEvents, EVENT_LABEL } from '../renderer/charts/reminders.mjs'

let passed = 0
function ok(name, fn) {
  fn()
  passed++
}

const credit = { id: 'c1', name: '招行信用卡', type: 'credit', statementDay: 25, dueDay: 10, archived: false }
const debt = { id: 'd1', name: '借条', type: 'debt', dueDay: 15, archived: false }

ok('本月账单日 + 跨月还款日，日期与剩余天数正确', () => {
  const evs = upcomingCreditEvents([credit], '2026-09-20', 30)
  assert.equal(evs.length, 2)
  const st = evs.find((e) => e.kind === 'statement')
  assert.deepEqual(st, {
    id: 'c1-statement-20260925', accountId: 'c1', accountName: '招行信用卡',
    kind: 'statement', date: '2026-09-25', daysLeft: 5
  })
  const due = evs.find((e) => e.kind === 'due')
  assert.equal(due.date, '2026-10-10')
  assert.equal(due.daysLeft, 20)
})

ok('当天（daysLeft=0）也算在窗口内', () => {
  const evs = upcomingCreditEvents(
    [{ id: 'x', name: 'X', type: 'credit', statementDay: 20, dueDay: 20 }],
    '2026-09-20', 30
  )
  assert.equal(evs.length, 2)
  assert.ok(evs.every((e) => e.date === '2026-09-20' && e.daysLeft === 0))
})

ok('短月：31 号落到当月最后一天', () => {
  const evs = upcomingCreditEvents(
    [{ id: 'c', name: 'C', type: 'credit', statementDay: 31, dueDay: 31 }],
    '2026-02-20', 30
  )
  assert.equal(evs.length, 2)
  assert.ok(evs.every((e) => e.date === '2026-02-28' && e.daysLeft === 8))
})

ok('跨年：本月日已过则取次年 1 月', () => {
  const evs = upcomingCreditEvents(
    [{ id: 'c', name: 'C', type: 'credit', statementDay: 15, dueDay: 15 }],
    '2026-12-20', 30
  )
  assert.ok(evs.every((e) => e.date === '2027-01-15' && e.daysLeft === 26))
})

ok('负债账户只产生还款日事件，无账单日', () => {
  const evs = upcomingCreditEvents([debt], '2026-09-20', 30)
  assert.equal(evs.length, 1)
  assert.equal(evs[0].kind, 'due')
  assert.equal(evs[0].date, '2026-10-15')
  assert.equal(evs[0].daysLeft, 25)
  assert.equal(evs.filter((e) => e.kind === 'statement').length, 0)
})

ok('归档账户跳过', () => {
  const evs = upcomingCreditEvents([{ ...credit, archived: true }], '2026-09-20', 30)
  assert.equal(evs.length, 0)
})

ok('窗口截断：超出提前天数的事件不返回', () => {
  assert.equal(upcomingCreditEvents([credit], '2026-09-20', 3).length, 0)
  const within = upcomingCreditEvents([credit], '2026-09-20', 5)
  assert.equal(within.length, 1)
  assert.equal(within[0].kind, 'statement')
})

ok('结果按剩余天数升序', () => {
  const a = { id: 'a', name: 'A', type: 'credit', statementDay: 25, dueDay: 22 }
  const b = { id: 'b', name: 'B', type: 'credit', statementDay: 24, dueDay: 23 }
  const evs = upcomingCreditEvents([a, b], '2026-09-20', 30)
  assert.deepEqual(evs.map((e) => e.daysLeft), [2, 3, 4, 5])
})

ok('EVENT_LABEL 文案', () => {
  assert.equal(EVENT_LABEL.statement, '账单日')
  assert.equal(EVENT_LABEL.due, '还款日')
})

console.log(`账单提醒全部通过：${passed} 组`)
