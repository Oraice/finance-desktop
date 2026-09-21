// 报表聚合单元测试：node test/report.test.mjs
import assert from 'node:assert'
import {
  yearlyReport, yearOverYear, chainRatio, calendarHeatmap, multiLedgerSummary
} from '../renderer/charts/report.mjs'

const rec = (date, type, amount, category, note = '') => ({ date, type, amount, category, note })

const data = [
  rec('2025-02-10', 'expense', 100, '餐饮'),
  rec('2025-02-15', 'expense', 50, '交通'),
  rec('2025-03-01', 'income', 5000, '工资'),
  rec('2026-01-05', 'expense', 200, '餐饮'),
  rec('2026-01-20', 'expense', 800, '购物'),
  rec('2026-02-01', 'income', 6000, '工资'),
  rec('2026-02-03', 'expense', 50, '餐饮'),
  rec('2026-02-08', 'expense', 150, '餐饮'),
  rec('2026-02-12', 'expense', 30, '交通')
]

let passed = 0
const ok = (name, fn) => { fn(); passed++; console.log('  ✔', name) }

console.log('report 聚合单元测试')

ok('yearlyReport：年度合计 / 笔数 / 记账天数 / 活跃月 / 月均', () => {
  const yr = yearlyReport(data, 2026)
  assert.strictEqual(yr.income, 6000)
  assert.strictEqual(yr.expense, 1230)
  assert.strictEqual(yr.balance, 4770)
  assert.strictEqual(yr.count, 6)
  assert.strictEqual(yr.activeDays, 6)
  assert.strictEqual(yr.activeMonths, 2)
  assert.strictEqual(yr.monthlyAvgExpense, 615)
})

ok('yearlyReport：月度明细正确', () => {
  const yr = yearlyReport(data, 2026)
  assert.strictEqual(yr.months[0].expense, 1000)
  assert.strictEqual(yr.months[0].count, 2)
  assert.strictEqual(yr.months[1].income, 6000)
  assert.strictEqual(yr.months[1].expense, 230)
  assert.strictEqual(yr.months[1].count, 4)
})

ok('yearlyReport：支出分类降序、TOP 支出', () => {
  const yr = yearlyReport(data, 2026)
  assert.strictEqual(yr.expenseCategories[0].name, '购物')
  assert.strictEqual(yr.expenseCategories[0].value, 800)
  assert.strictEqual(yr.expenseCategories[1].value, 400) // 餐饮 200+50+150
  assert.strictEqual(yr.topExpenses[0].amount, 800)
  assert.strictEqual(yr.topExpenses[0].category, '购物')
})

ok('yearOverYear：今年 vs 去年同比', () => {
  const yoy = yearOverYear(data, 2026)
  assert.strictEqual(yoy.income.cur, 6000)
  assert.strictEqual(yoy.income.prev, 5000)
  assert.strictEqual(yoy.income.pct, 20)
  assert.strictEqual(yoy.expense.prev, 150)
  assert.strictEqual(yoy.expense.pct, 720)
  assert.strictEqual(yoy.balance.prev, 4850)
  assert.strictEqual(yoy.balance.pct, -1.65)
})

ok('chainRatio：本月 vs 上月，支出下降 77%，基期 0 收入返回 null', () => {
  const ch = chainRatio(data, new Date(2026, 1, 15)) // 2026-02-15
  assert.strictEqual(ch.curKey, '2026-02')
  assert.strictEqual(ch.prevKey, '2026-01')
  assert.strictEqual(ch.income.cur, 6000)
  assert.strictEqual(ch.income.pct, null)
  assert.strictEqual(ch.expense.cur, 230)
  assert.strictEqual(ch.expense.prev, 1000)
  assert.strictEqual(ch.expense.pct, -77)
  assert.strictEqual(ch.balance.cur, 5770)
  assert.strictEqual(ch.balance.pct, null) // 上月结余 -1000
  assert.strictEqual(ch.curCount, 4)
  assert.strictEqual(ch.prevCount, 2)
})

ok('chainRatio：无数据时各项 pct 为 null', () => {
  const e = chainRatio([], new Date(2026, 2, 10))
  assert.strictEqual(e.income.pct, null)
  assert.strictEqual(e.expense.pct, null)
  assert.strictEqual(e.balance.pct, null)
})

ok('calendarHeatmap：max、12 月、365 天、月首补齐 null', () => {
  const cal = calendarHeatmap(data, 2026)
  assert.strictEqual(cal.max, 800)
  assert.strictEqual(cal.months.length, 12)
  const all = cal.months.flatMap((m) => m.weeks).flat().filter(Boolean)
  assert.strictEqual(all.length, 365) // 2026 平年
  assert.strictEqual(all.filter((c) => c.expense === 800).length, 1)
  assert.ok(all.every((c) => typeof c.day === 'number'))
  // 2026-01-01 为周四（getDay=4），第一周前 4 格补齐 null
  assert.deepStrictEqual(cal.months[0].weeks[0].slice(0, 4), [null, null, null, null])
})

ok('calendarHeatmap：无记录日期给零值格子', () => {
  const cal = calendarHeatmap(data, 2026)
  const all = cal.months.flatMap((m) => m.weeks).flat().filter(Boolean)
  const zero = all.find((c) => c.day === 6 && c.expense === 0) // 2026-01-06 无记录
  assert.ok(zero)
  assert.strictEqual(zero.count, 0)
})

ok('multiLedgerSummary：各账本、合计、分类、趋势，按支出降序', () => {
  const sum = multiLedgerSummary([
    { id: 'a', name: '日常', iconImage: '', records: [rec('2026-02-01', 'income', 6000, '工资'), rec('2026-02-03', 'expense', 50, '餐饮')] },
    { id: 'b', name: '投资', iconImage: 'data:image/x', records: [rec('2026-02-05', 'expense', 1000, '购物')] }
  ])
  assert.strictEqual(sum.rows[0].name, '投资')
  assert.strictEqual(sum.rows[0].expense, 1000)
  assert.strictEqual(sum.rows[0].iconImage, 'data:image/x')
  assert.strictEqual(sum.rows[1].name, '日常')
  assert.strictEqual(sum.income, 6000)
  assert.strictEqual(sum.expense, 1050)
  assert.strictEqual(sum.balance, 4950)
  assert.strictEqual(sum.count, 3)
  assert.strictEqual(sum.categories[0].name, '购物')
  assert.strictEqual(sum.categories[0].value, 1000)
  assert.strictEqual(sum.trend.length, 1)
  assert.strictEqual(sum.trend[0].income, 6000)
  assert.strictEqual(sum.trend[0].expense, 1050)
})

console.log(`\n全部通过：${passed} 组用例 ✅`)
