// 阶段 3 看板聚合单元测试：node test/dashboard.test.mjs
import assert from 'node:assert'
import { filterByRange, monthlyTrend, categoryShare, topExpenses, monthSpent, budgetStatus, monthPace, categoryBudgetStatus } from '../renderer/charts/dashboard.mjs'

const r = (date, type, amount, category) => ({ date, type, amount, category })
const data = [
  r('2026-03-05', 'income', 1000, '工资'),
  r('2026-04-01', 'expense', 200, '餐饮'),
  r('2026-04-15', 'expense', 300, '餐饮'),
  r('2026-08-20', 'expense', 50, '交通'),
  r('2026-09-02', 'income', 999, '报销'),
  { date: '坏数据', type: 'expense', amount: 10 } // 非法月份应被趋势图忽略
]

let passed = 0
const ok = (name, fn) => { fn(); passed++; console.log('  ✔', name) }

console.log('dashboard 聚合单元测试')

ok('monthlyTrend：按月聚合、忽略非法日期、按时间升序、上限12', () => {
  const t = monthlyTrend(data)
  assert.deepStrictEqual(t.map((x) => x.month), ['2026-03', '2026-04', '2026-08', '2026-09'])
  assert.strictEqual(t[1].expense, 500)
  assert.strictEqual(t[0].income, 1000)
})

ok('categoryShare：仅统计支出、降序、缺省归类未分类', () => {
  const s = categoryShare(data)
  assert.strictEqual(s[0].name, '餐饮')
  assert.strictEqual(s[0].value, 500)
  assert.strictEqual(s.at(-1).name, '未分类') // 坏数据行
})

ok('topExpenses：按金额降序取前 n', () => {
  const t = topExpenses(data, 2)
  assert.strictEqual(t.length, 2)
  assert.strictEqual(t[0].amount, 300)
  assert.strictEqual(t[1].amount, 200)
})

ok('filterByRange：非法范围回退全量、year 过滤且剔除非法日期', () => {
  assert.strictEqual(filterByRange(data, 'all').length, data.length)
  assert.strictEqual(filterByRange(data, 'year').length, 5) // "坏数据"行应被剔除
  assert.strictEqual(filterByRange(data, '不存在的范围').length, data.length)
})

ok('monthSpent：只统计指定月份的支出、忽略收入', () => {
  const sep = new Date(2026, 8, 10) // 2026-09
  const recs = [
    r('2026-09-01', 'expense', 100, '餐饮'),
    r('2026-09-20', 'expense', 250.5, '购物'),
    r('2026-09-05', 'income', 999, '报销'),
    r('2026-08-30', 'expense', 80, '交通')
  ]
  assert.strictEqual(monthSpent(recs, sep), 350.5)
})

ok('budgetStatus：未设置预算时为 unset', () => {
  const s = budgetStatus(0, 500)
  assert.strictEqual(s.level, 'unset')
  assert.strictEqual(s.budget, 0)
})

ok('budgetStatus：使用率分档 safe / near / over', () => {
  assert.strictEqual(budgetStatus(1000, 500).level, 'safe')   // 50%
  assert.strictEqual(budgetStatus(1000, 800).level, 'near')   // 正好 80%
  assert.strictEqual(budgetStatus(1000, 1000).level, 'near')  // 用满 100%
  const over = budgetStatus(1000, 1300)
  assert.strictEqual(over.level, 'over')
  assert.strictEqual(over.over, 300)
  assert.strictEqual(over.remaining, -300)
})

ok('budgetStatus：剩余与进度条百分比正确', () => {
  const s = budgetStatus(2000, 500)
  assert.strictEqual(s.remaining, 1500)
  assert.strictEqual(s.pct, 25)
  assert.strictEqual(budgetStatus(1000, 2000).pct, 100) // 超支后进度条封顶 100%
})

ok('monthPace：本月天数 / 已过 / 剩余 / 时间进度', () => {
  const p = monthPace(new Date(2026, 8, 10)) // 2026-09-10，9 月 30 天
  assert.strictEqual(p.dim, 30)
  assert.strictEqual(p.elapsed, 10)
  assert.strictEqual(p.remainDays, 20)
  assert.strictEqual(p.timePct, 33.3)
  assert.strictEqual(monthPace(new Date(2026, 1, 1)).dim, 28) // 2026 年 2 月 28 天（平年）
})

ok('budgetStatus：支出节奏 ahead / track / behind', () => {
  const now = new Date(2026, 8, 10) // 时间进度 33.3%
  assert.strictEqual(budgetStatus(1000, 600, now).paceLevel, 'ahead')  // 已花 60%
  assert.strictEqual(budgetStatus(1000, 350, now).paceLevel, 'track')  // 35%，与时间同步
  assert.strictEqual(budgetStatus(1000, 100, now).paceLevel, 'behind') // 仅花 10%
})

ok('budgetStatus：每天可花额度与月末、超支口径', () => {
  const now = new Date(2026, 8, 10)
  assert.strictEqual(budgetStatus(1000, 500, now).daily, 25) // 剩 500 / 20 天
  const monthEnd = new Date(2026, 8, 30)
  assert.strictEqual(budgetStatus(1000, 500, monthEnd).daily, 500) // 月末最后一天按今天算
  const over = budgetStatus(1000, 1300, now)
  assert.strictEqual(over.daily, 0)
  assert.strictEqual(over.dailyOver, 30) // 超 300 / 已过 10 天
})

ok('categoryBudgetStatus：各分类本月支出 / 档位 / 超支优先排序', () => {
  const now = new Date(2026, 8, 10)
  const recs = [
    r('2026-09-02', 'expense', 800, '餐饮'),
    r('2026-09-08', 'expense', 350, '交通'),
    r('2026-09-05', 'expense', 100, '餐饮'),
    r('2026-08-30', 'expense', 900, '餐饮'), // 上月不计
    r('2026-09-09', 'income', 500, '工资')
  ]
  const rows = categoryBudgetStatus({ 餐饮: 1000, 交通: 300 }, recs, now)
  assert.strictEqual(rows[0].name, '交通') // 超支排最前
  assert.strictEqual(rows[0].level, 'over')
  assert.strictEqual(rows[0].over, 50)
  assert.strictEqual(rows[1].name, '餐饮')
  assert.strictEqual(rows[1].spent, 900)
  assert.strictEqual(rows[1].level, 'near')
  assert.strictEqual(rows[1].pct, 90)
})

console.log(`\n全部通过：${passed} 组用例 ✅`)
