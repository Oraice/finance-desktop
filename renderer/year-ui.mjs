// ---------------------------------------------------------------------------
// year-ui.mjs —— 年度账单视图：年度核心数字、同比、各月收支、分类占比、
// 年度大额 TOP10、年度概览。
// ---------------------------------------------------------------------------

import { yearlyReport, yearOverYear } from './charts/report.mjs'
import { toPnlRecords } from './lib/record-flags.mjs'

const $ = (s) => document.querySelector(s)
const fmt = (n) => '¥' + Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')

let monthsChart = null
let catChart = null

function fillYears(records) {
  const sel = $('#yr-year')
  const years = new Set([new Date().getFullYear()])
  for (const r of records) {
    const y = Number(String(r.date || '').slice(0, 4))
    if (y) years.add(y)
  }
  const list = [...years].sort((a, b) => b - a)
  const prev = sel.value
  sel.innerHTML = list.map((y) => `<option value="${y}">${y} 年</option>`).join('')
  if (prev) sel.value = prev
  return Number(sel.value)
}

function pctText(p) {
  if (p.pct === null) return '<span class="muted">—</span>'
  const up = p.pct >= 0
  return `<span class="${up ? 'txt-inc' : 'txt-exp'}">${up ? '▲' : '▼'} ${Math.abs(p.pct).toFixed(1)}%</span>`
}

function renderYear(ledger) {
  const records = toPnlRecords(ledger?.records || [])
  const year = fillYears(records)
  const r = yearlyReport(records, year)
  const yoy = yearOverYear(records, year)

  $('#yr-income').textContent = fmt(r.income)
  $('#yr-expense').textContent = fmt(r.expense)
  $('#yr-balance').textContent = fmt(r.balance)
  $('#yr-meta').textContent = `${r.count} 笔 · 记账 ${r.activeDays} 天 · 月均支出 ${fmt(r.monthlyAvgExpense)}`

  const yoyRow = (label, p) =>
    `<tr><td>${label}</td><td>${fmt(p.cur)}</td><td>${fmt(p.prev)}</td><td>${pctText(p)}</td></tr>`
  $('#yr-yoy-tbody').innerHTML =
    yoyRow('收入', yoy.income) + yoyRow('支出', yoy.expense) + yoyRow('结余', yoy.balance)

  if (!monthsChart) monthsChart = window.echarts.init($('#yr-months-chart'))
  monthsChart.setOption({
    tooltip: { trigger: 'axis', valueFormatter: (v) => fmt(v) },
    legend: { data: ['收入', '支出'], top: 0 },
    grid: { left: 56, right: 16, top: 34, bottom: 28 },
    xAxis: { type: 'category', data: r.months.map((m) => m.month + '月') },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => (v >= 10000 ? v / 10000 + '万' : v) } },
    series: [
      { name: '收入', type: 'bar', itemStyle: { color: '#2f9e44', borderRadius: [3, 3, 0, 0] }, data: r.months.map((m) => m.income) },
      { name: '支出', type: 'bar', itemStyle: { color: '#e03131', borderRadius: [3, 3, 0, 0] }, data: r.months.map((m) => m.expense) }
    ]
  }, true)

  if (!catChart) catChart = window.echarts.init($('#yr-cat-chart'))
  catChart.setOption({
    title: r.expenseCategories.length ? null : { text: '暂无支出', left: 'center', top: 'middle', textStyle: { color: '#aaa', fontSize: 14 } },
    tooltip: { trigger: 'item', valueFormatter: (v) => fmt(v) },
    legend: { type: 'scroll', bottom: 0 },
    color: ['#d9480f', '#e8590c', '#f08c00', '#fab005', '#94d82d', '#20c997', '#22b8cf', '#4263eb', '#7048e8', '#e64980'],
    series: [{
      type: 'pie', radius: ['40%', '66%'], center: ['50%', '44%'],
      itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
      label: { formatter: '{b}\n{d}%' },
      data: r.expenseCategories
    }]
  }, true)

  $('#yr-top-tbody').innerHTML = r.topExpenses.length
    ? r.topExpenses.map((t) =>
      `<tr><td>${t.date}</td><td>${esc(t.category)}</td><td class="num expense">${fmt(t.amount)}</td><td>${esc(t.note)}</td></tr>`).join('')
    : '<tr><td colspan="4" class="muted" style="text-align:center">暂无</td></tr>'

  const best = r.months.filter((m) => m.count).sort((a, b) => b.expense - a.expense)[0]
  $('#yr-overview').innerHTML =
    `全年共 <b>${r.count}</b> 笔记录，覆盖 <b>${r.activeDays}</b> 天、<b>${r.activeMonths}</b> 个月；` +
    `支出最高为 <b>${best ? best.month + ' 月（' + fmt(best.expense) + '）' : '—'}</b>，月均支出 <b>${fmt(r.monthlyAvgExpense)}</b>。`
}

export function initYearPanel({ getLedger }) {
  $('#yr-year').addEventListener('change', () => renderYear(getLedger()))
  document.querySelectorAll('.tab').forEach((t) =>
    t.addEventListener('click', () => { if (t.dataset.tab === 'year') renderYear(getLedger()) }))
  window.addEventListener('resize', () => { monthsChart?.resize(); catChart?.resize() })
}
