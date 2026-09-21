// ---------------------------------------------------------------------------
// summary-ui.mjs —— 多账本汇总视图：各账本收支表 + 合计、跨账本趋势、
// 跨账本支出分类占比。
// ---------------------------------------------------------------------------

import { multiLedgerSummary } from './charts/report.mjs'
import { toPnlRecords } from './lib/record-flags.mjs'

const $ = (s) => document.querySelector(s)
const fmt = (n) => '¥' + Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')

let trendChart = null
let catChart = null
let glyphFn = null

const PIE_COLORS = ['#d9480f', '#e8590c', '#f08c00', '#fab005', '#94d82d', '#20c997', '#22b8cf', '#4263eb', '#7048e8', '#e64980']

async function renderSummary() {
  let ledgers = []
  try {
    ledgers = await window.ledgerAPI.all()
  } catch { ledgers = [] }
  const s = multiLedgerSummary(ledgers.map((l) => ({ ...l, records: toPnlRecords(l.records || []) })))

  $('#sm-tbody').innerHTML = s.rows.map((r, i) =>
    `<tr>
      <td><span class="sm-glyph" data-i="${i}"></span> ${esc(r.name)}</td>
      <td class="num income">${fmt(r.income)}</td>
      <td class="num expense">${fmt(r.expense)}</td>
      <td class="num ${r.balance >= 0 ? 'income' : 'expense'}">${fmt(r.balance)}</td>
      <td class="num">${r.count}</td>
    </tr>`).join('')
  $('#sm-tbody').querySelectorAll('.sm-glyph').forEach((el) => {
    const r = s.rows[Number(el.dataset.i)]
    glyphFn?.(el, r.iconImage, '📒')
  })

  $('#sm-foot').innerHTML =
    `<tr>
      <td><b>合计（${s.rows.length} 个账本）</b></td>
      <td class="num income"><b>${fmt(s.income)}</b></td>
      <td class="num expense"><b>${fmt(s.expense)}</b></td>
      <td class="num ${s.balance >= 0 ? 'income' : 'expense'}"><b>${fmt(s.balance)}</b></td>
      <td class="num"><b>${s.count}</b></td>
    </tr>`

  if (!trendChart) trendChart = window.echarts.init($('#sm-trend-chart'))
  trendChart.setOption({
    tooltip: { trigger: 'axis', valueFormatter: (v) => fmt(v) },
    legend: { data: ['收入', '支出'], top: 0 },
    grid: { left: 56, right: 16, top: 34, bottom: 28 },
    xAxis: { type: 'category', data: s.trend.map((t) => t.month.slice(2)) },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => (v >= 10000 ? v / 10000 + '万' : v) } },
    series: [
      { name: '收入', type: 'line', smooth: true, areaStyle: { opacity: 0.12 }, itemStyle: { color: '#2f9e44' }, data: s.trend.map((t) => t.income) },
      { name: '支出', type: 'line', smooth: true, areaStyle: { opacity: 0.12 }, itemStyle: { color: '#e03131' }, data: s.trend.map((t) => t.expense) }
    ]
  }, true)

  if (!catChart) catChart = window.echarts.init($('#sm-cat-chart'))
  catChart.setOption({
    title: s.categories.length ? null : { text: '暂无支出', left: 'center', top: 'middle', textStyle: { color: '#aaa', fontSize: 14 } },
    tooltip: { trigger: 'item', valueFormatter: (v) => fmt(v) },
    legend: { type: 'scroll', orient: 'vertical', right: 8, top: 'middle' },
    color: PIE_COLORS,
    series: [{
      type: 'pie', radius: ['38%', '64%'], center: ['38%', '50%'],
      itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
      label: { formatter: '{b} {d}%' },
      data: s.categories
    }]
  }, true)
}

export function initSummaryPanel(deps = {}) {
  glyphFn = deps.setGlyph || null
  document.querySelectorAll('.tab').forEach((t) =>
    t.addEventListener('click', () => { if (t.dataset.tab === 'summary') renderSummary() }))
  window.addEventListener('resize', () => { trendChart?.resize(); catChart?.resize() })
}
