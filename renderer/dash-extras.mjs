// ---------------------------------------------------------------------------
// dash-extras.mjs —— 看板增强：收支环比卡片 + 记账日历热力图（DOM 渲染）
// 纯聚合来自 charts/report.mjs。
// ---------------------------------------------------------------------------

import { chainRatio, calendarHeatmap } from './charts/report.mjs'

const $ = (s) => document.querySelector(s)
const fmt = (n) => '¥' + Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })

// ------------------------------ 收支环比 ------------------------------------

function trendHtml(p, goodWhenUp) {
  if (p.pct === null) return '<span class="chain-pct chain-na">— 新增</span>'
  const up = p.pct >= 0
  const good = goodWhenUp ? up : !up
  const cls = good ? 'up' : 'down'
  const arrow = up ? '▲' : '▼'
  return `<span class="chain-pct chain-${cls}">${arrow} ${Math.abs(p.pct).toFixed(1)}%</span>`
}

export function renderChainCard(records, now = new Date()) {
  const box = $('#chain-card')
  if (!box) return
  const d = chainRatio(records, now)
  box.innerHTML = `
    <div class="chain-head">
      <span class="chain-title">📈 收支环比</span>
      <span class="muted">${d.curKey} vs ${d.prevKey}</span>
    </div>
    <div class="chain-grid">
      <div class="chain-cell">
        <span class="chain-label">收入</span>
        <span class="chain-val">${fmt(d.income.cur)}</span>
        ${trendHtml(d.income, true)}
      </div>
      <div class="chain-cell">
        <span class="chain-label">支出</span>
        <span class="chain-val">${fmt(d.expense.cur)}</span>
        ${trendHtml(d.expense, false)}
      </div>
      <div class="chain-cell">
        <span class="chain-label">结余</span>
        <span class="chain-val">${fmt(d.balance.cur)}</span>
        ${trendHtml(d.balance, true)}
      </div>
    </div>`
}

// ---------------------------- 记账日历热力图 ---------------------------------

function heatColor(expense, max) {
  if (!expense) return '#eef0f3'
  const t = Math.max(0.12, expense / max)
  return `rgba(217,72,15,${(0.18 + 0.82 * t).toFixed(2)})`
}

const DOW = ['日', '一', '二', '三', '四', '五', '六']

export function renderCalendarHeatmap(records, year = new Date().getFullYear()) {
  const box = $('#cal-heatmap')
  if (!box) return
  const data = calendarHeatmap(records, year)

  const monthsHtml = data.months.map((mm) => {
    const weeks = mm.weeks.map((week) =>
      `<div class="cal-week">${week.map((c) => {
        if (!c) return '<span class="cal-dot cal-empty"></span>'
        const dateStr = `${year}-${String(mm.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`
        return `<span class="cal-dot${c.expense > 0 ? ' cal-lit' : ''}" style="background:${heatColor(c.expense, data.max)}" data-date="${dateStr}" data-expense="${c.expense}" data-income="${c.income}" data-count="${c.count}">${c.day}</span>`
      }).join('')}</div>`).join('')
    return `
      <div class="cal-month">
        <div class="cal-month-name">${mm.month} 月</div>
        <div class="cal-dow">${DOW.map((x) => `<span>${x}</span>`).join('')}</div>
        ${weeks}
      </div>`
  }).join('')

  box.innerHTML = `
    <div class="cal-year">${monthsHtml}</div>
    <div class="cal-legend">
      <span class="muted">少</span>
      <span class="cal-dot" style="background:#eef0f3"></span>
      <span class="cal-dot" style="background:rgba(217,72,15,.35)"></span>
      <span class="cal-dot" style="background:rgba(217,72,15,.6)"></span>
      <span class="cal-dot" style="background:rgba(217,72,15,.92)"></span>
      <span class="muted">多</span>
    </div>`
  bindCalTip(box)
}

// ----------------------- 日历自定义悬浮提示 ----------------------------------

let calTipEl = null
function ensureCalTip() {
  if (calTipEl) return calTipEl
  calTipEl = document.createElement('div')
  calTipEl.className = 'cal-tip'
  calTipEl.hidden = true
  document.body.appendChild(calTipEl)
  return calTipEl
}

function showCalTip(dot, ev) {
  const tip = ensureCalTip()
  const expense = Number(dot.dataset.expense)
  const income = Number(dot.dataset.income)
  const count = Number(dot.dataset.count)
  const rows = []
  if (count > 0) rows.push('<div class="cal-tip-row cal-tip-count"><span>' + count + ' 笔记录</span></div>')
  if (income > 0) rows.push('<div class="cal-tip-row cal-tip-in"><span>收入</span><b>' + fmt(income) + '</b></div>')
  if (expense > 0) rows.push('<div class="cal-tip-row cal-tip-ex"><span>支出</span><b>' + fmt(expense) + '</b></div>')
  if (!rows.length) rows.push('<div class="cal-tip-row"><span class="muted">当天无记录</span></div>')
  tip.innerHTML = '<div class="cal-tip-date">' + dot.dataset.date + '</div>' + rows.join('')
  tip.hidden = false
  positionCalTip(ev)
}

function positionCalTip(ev) {
  const tip = ensureCalTip()
  const gap = 14
  let x = ev.clientX + gap
  let y = ev.clientY + gap
  const r = tip.getBoundingClientRect()
  if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - gap
  if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - gap
  tip.style.left = x + 'px'
  tip.style.top = y + 'px'
}

function hideCalTip() {
  if (!calTipEl) return
  calTipEl.hidden = true
}

function bindCalTip(box) {
  box.querySelectorAll('.cal-dot[data-date]').forEach((dot) => {
    dot.addEventListener('mouseenter', (ev) => showCalTip(dot, ev))
    dot.addEventListener('mousemove', positionCalTip)
    dot.addEventListener('mouseleave', hideCalTip)
  })
}
