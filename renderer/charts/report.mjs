// ---------------------------------------------------------------------------
// report.mjs —— 年度账单 / 收支环比 / 记账日历热力图 / 多账本汇总的纯聚合
// 与渲染分离，所有函数无副作用，可在 Node 单元测试中直接验证。
// ---------------------------------------------------------------------------

const num = (v) => Number(v) || 0
const r2 = (v) => Math.round(num(v) * 100) / 100
const pad2 = (n) => String(n).padStart(2, '0')

/** 环比 / 同比百分比：基期为 0 时无法计算，返回 null（视图显示“—”） */
const changePct = (cur, prev) => (prev > 0 ? r2(((cur - prev) / prev) * 100) : null)

// ------------------------------ 年度账单 ------------------------------------

/**
 * 年度账单聚合。
 * 返回年度总收支/结余、笔数、记账天数、活跃月份、月均支出、
 * 12 个月明细、年度支出/收入分类、TOP10 支出。
 */
export function yearlyReport(records, year) {
  const y = Number(year)
  const months = []
  for (let m = 1; m <= 12; m++) {
    months.push({ month: m, key: `${y}-${pad2(m)}`, income: 0, expense: 0, balance: 0, count: 0 })
  }
  let income = 0
  let expense = 0
  let count = 0
  const catExp = new Map()
  const catInc = new Map()
  const daySet = new Set()

  for (const r of records) {
    const d = String(r.date || '')
    if (!d.startsWith(y + '-')) continue
    const m = Number(d.slice(5, 7))
    if (!(m >= 1 && m <= 12)) continue
    const row = months[m - 1]
    const amt = num(r.amount)
    if (r.type === 'income') {
      row.income += amt; income += amt
      const k = r.category || '其他'
      catInc.set(k, (catInc.get(k) || 0) + amt)
    } else if (r.type === 'expense') {
      row.expense += amt; expense += amt
      const k = r.category || '未分类'
      catExp.set(k, (catExp.get(k) || 0) + amt)
    } else continue
    row.count++; count++; daySet.add(d)
  }

  for (const row of months) {
    row.income = r2(row.income)
    row.expense = r2(row.expense)
    row.balance = r2(row.income - row.expense)
  }

  const toList = (map) =>
    [...map.entries()].map(([name, value]) => ({ name, value: r2(value) }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value)

  const topExpenses = records
    .filter((r) => r.type === 'expense' && String(r.date || '').startsWith(y + '-'))
    .map((r) => ({ date: r.date, category: r.category || '未分类', amount: r2(r.amount), note: r.note || '' }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)

  const activeMonths = months.filter((m) => m.count > 0).length
  return {
    year: y,
    income: r2(income),
    expense: r2(expense),
    balance: r2(income - expense),
    count,
    activeDays: daySet.size,
    activeMonths,
    monthlyAvgExpense: activeMonths ? r2(expense / activeMonths) : 0,
    months,
    expenseCategories: toList(catExp),
    incomeCategories: toList(catInc),
    topExpenses
  }
}

/** 年度同比：今年 vs 去年（收入/支出/结余的绝对值与百分比） */
export function yearOverYear(records, year) {
  const cur = yearlyReport(records, year)
  const prev = yearlyReport(records, year - 1)
  const pack = (c, p) => ({ cur: c, prev: p, pct: changePct(c, p) })
  return {
    year,
    income: pack(cur.income, prev.income),
    expense: pack(cur.expense, prev.expense),
    balance: pack(cur.balance, prev.balance)
  }
}

// ------------------------------ 收支环比 ------------------------------------

/**
 * 本月 vs 上月环比（收入/支出/结余）。
 * 返回各项 本期 cur / 上期 prev / 环比 pct / 差额 diff，以及两期笔数。
 */
export function chainRatio(records, now = new Date()) {
  const y = now.getFullYear()
  const m = now.getMonth()
  const curKey = `${y}-${pad2(m + 1)}`
  const prevDate = new Date(y, m - 1, 1)
  const prevKey = `${prevDate.getFullYear()}-${pad2(prevDate.getMonth() + 1)}`

  const sums = {
    [curKey]: { income: 0, expense: 0, count: 0 },
    [prevKey]: { income: 0, expense: 0, count: 0 }
  }
  for (const r of records) {
    const k = String(r.date || '').slice(0, 7)
    if (sums[k] && (r.type === 'income' || r.type === 'expense')) {
      sums[k][r.type] += num(r.amount)
      sums[k].count++
    }
  }
  const cur = sums[curKey]
  const prev = sums[prevKey]
  const pack = (c, p) => ({ cur: r2(c), prev: r2(p), pct: changePct(c, p), diff: r2(c - p) })

  return {
    curKey,
    prevKey,
    income: pack(cur.income, prev.income),
    expense: pack(cur.expense, prev.expense),
    balance: pack(cur.income - cur.expense, prev.income - prev.expense),
    curCount: cur.count,
    prevCount: prev.count
  }
}

// ---------------------------- 记账日历热力图 ---------------------------------

/**
 * 全年记账日历热力图。
 * 返回 {year, max, months:[{month, weeks:[[cell|null]×7]}]}，
 * 周以周日开头；cell = {day, expense, income, count}，无记录的日期也给零值格子。
 */
export function calendarHeatmap(records, year) {
  const y = Number(year)
  const dayMap = new Map()
  for (const r of records) {
    const d = String(r.date || '')
    if (!d.startsWith(y + '-')) continue
    const key = d.slice(5)
    if (!dayMap.has(key)) dayMap.set(key, { expense: 0, income: 0, count: 0 })
    const cell = dayMap.get(key)
    if (r.type === 'expense') cell.expense += num(r.amount)
    else if (r.type === 'income') cell.income += num(r.amount)
    cell.count++
  }

  const months = []
  let max = 0
  for (let m = 1; m <= 12; m++) {
    const dim = new Date(y, m, 0).getDate()
    const startDow = new Date(y, m - 1, 1).getDay()
    const weeks = []
    let week = new Array(startDow).fill(null)
    for (let day = 1; day <= dim; day++) {
      const raw = dayMap.get(`${pad2(m)}-${pad2(day)}`)
      const cell = raw
        ? { day, expense: r2(raw.expense), income: r2(raw.income), count: raw.count }
        : { day, expense: 0, income: 0, count: 0 }
      if (cell.expense > max) max = cell.expense
      week.push(cell)
      if (week.length === 7) { weeks.push(week); week = [] }
    }
    if (week.length) { while (week.length < 7) week.push(null); weeks.push(week) }
    months.push({ month: m, weeks })
  }
  return { year: y, months, max: r2(max) }
}

// ------------------------------ 多账本汇总 ----------------------------------

function bump(map, k, v) { map.set(k, (map.get(k) || 0) + v) }
function bumpMonth(map, r, amt) {
  const k = String(r.date || '').slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(k)) return
  if (!map.has(k)) map.set(k, { income: 0, expense: 0 })
  map.get(k)[r.type] += amt
}

/**
 * 多账本汇总。ledgers = [{id,name,iconImage,records}]
 * 返回各账本收支行 rows、合计 income/expense/balance/count、
 * 跨账本分类占比 categories、近 12 月趋势 trend。
 */
export function multiLedgerSummary(ledgers) {
  const rows = []
  let income = 0
  let expense = 0
  let count = 0
  const catMap = new Map()
  const monthMap = new Map()

  for (const l of ledgers) {
    let li = 0
    let le = 0
    let lc = 0
    for (const r of l.records || []) {
      const amt = num(r.amount)
      if (r.type === 'income') {
        li += amt; income += amt
        bumpMonth(monthMap, r, amt)
      } else if (r.type === 'expense') {
        le += amt; expense += amt
        bump(catMap, r.category || '未分类', amt); bumpMonth(monthMap, r, amt)
      } else continue
      lc++; count++
    }
    rows.push({
      id: l.id, name: l.name, iconImage: l.iconImage || '',
      income: r2(li), expense: r2(le), balance: r2(li - le), count: lc
    })
  }

  rows.sort((a, b) => b.expense - a.expense)
  const categories = [...catMap.entries()]
    .map(([name, value]) => ({ name, value: r2(value) }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value)
  const trend = [...monthMap.entries()]
    .map(([month, v]) => ({ month, income: r2(v.income), expense: r2(v.expense) }))
    .sort((a, b) => (a.month < b.month ? -1 : 1))
    .slice(-12)

  return { rows, income: r2(income), expense: r2(expense), balance: r2(income - expense), count, categories, trend }
}
