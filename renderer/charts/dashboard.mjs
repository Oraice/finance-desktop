// ---------------------------------------------------------------------------
// dashboard.mjs —— 财务看板：纯聚合函数 + ECharts 渲染
// 聚合与渲染分离，聚合函数可在 Node 单元测试中直接验证。
// ---------------------------------------------------------------------------

const PALETTE = ['#d9480f', '#e8590c', '#f08c00', '#fab005', '#94d82d',
  '#20c997', '#22b8cf', '#4263eb', '#7048e8', '#e64980']

const fmtY = (n) => '¥' + Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })

// ------------------------------ 纯聚合 --------------------------------------

/** 时间范围过滤：month=本月 last3=近3个月 half=近6个月 year=本年 all=全部 */
export function filterByRange(records, range) {
  if (range === 'all' || !records.length) return records
  const now = new Date()
  const y = now.getFullYear()
  const cur = y * 12 + now.getMonth()
  const monthKeyOf = (r) => {
    const [ry, rm] = String(r.date).split('-').map(Number)
    return ry * 12 + (rm || 1) - 1
  }
  switch (range) {
    case 'month': return records.filter((r) => monthKeyOf(r) === cur)
    case 'last3': return records.filter((r) => monthKeyOf(r) > cur - 3)
    case 'half': return records.filter((r) => monthKeyOf(r) > cur - 6)
    case 'year': return records.filter((r) => Math.floor(monthKeyOf(r) / 12) === y)
    default: return records
  }
}

/** 月度收支趋势：[{month:'YYYY-MM', income, expense}]，最多最近 12 个有数据的月 */
export function monthlyTrend(records) {
  const map = new Map()
  for (const r of records) {
    const m = String(r.date).slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(m)) continue
    if (!map.has(m)) map.set(m, { month: m, income: 0, expense: 0 })
    const row = map.get(m)
    if (r.type === 'income') row.income += Number(r.amount) || 0
    else row.expense += Number(r.amount) || 0
  }
  return [...map.values()].sort((a, b) => (a.month < b.month ? -1 : 1)).slice(-12)
}

/** 支出分类占比：降序 [{name, value}] */
export function categoryShare(records) {
  const map = new Map()
  for (const r of records) {
    if (r.type !== 'expense') continue
    const cat = r.category || '未分类'
    map.set(cat, (map.get(cat) || 0) + (Number(r.amount) || 0))
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value)
}

/** 主要支出明细（按金额降序，取前 n 条） */
export function topExpenses(records, n = 8) {
  return records
    .filter((r) => r.type === 'expense')
    .sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))
    .slice(0, n)
}

// ------------------------------ 预算管理 ------------------------------------

/** 统计指定月份（默认本月）的支出总额 */
export function monthSpent(records, now = new Date()) {
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  let spent = 0
  for (const r of records) {
    if (r.type === 'expense' && String(r.date).startsWith(key)) spent += Number(r.amount) || 0
  }
  return Math.round(spent * 100) / 100
}

/**
 * 本月时间节奏（纯函数）：
 * dim 本月天数 · today 今天几号 · elapsed 已进入天数（含今天）·
 * remainDays 今天之后剩余完整天数 · timePct 时间进度百分比
 */
export function monthPace(now = new Date()) {
  const y = now.getFullYear()
  const m = now.getMonth()
  const dim = new Date(y, m + 1, 0).getDate()
  const today = now.getDate()
  const elapsed = today
  const remainDays = Math.max(0, dim - today)
  const timePct = Math.round((elapsed / dim) * 1000) / 10
  return { y, m, dim, today, elapsed, remainDays, timePct }
}

/**
 * 预算执行状态：
 * level = unset 未设置 / safe 使用率<80% / near 80%~100% / over 已超支
 * paceLevel = ahead 支出偏快 / track 与时间同步 / behind 支出偏慢（对比时间进度，容差 8%）
 * daily = 剩余天数里每天可花；dailyOver = 超支后日均超支额
 */
export function budgetStatus(budget, spent, now = new Date()) {
  const b = Number(budget) || 0
  const s = Math.round((Number(spent) || 0) * 100) / 100
  const pace = monthPace(now)
  if (b <= 0) {
    return {
      budget: 0, spent: s, remaining: 0, over: 0, ratio: 0, pct: 0, spentPct: 0,
      level: 'unset', pace, paceLevel: 'none', daily: 0, dailyOver: 0
    }
  }
  const ratio = s / b
  const level = s > b ? 'over' : ratio >= 0.8 ? 'near' : 'safe'
  const spentPct = ratio * 100
  let paceLevel = 'track'
  if (spentPct - pace.timePct > 8) paceLevel = 'ahead'
  else if (pace.timePct - spentPct > 8) paceLevel = 'behind'

  let daily = 0
  let dailyOver = 0
  if (s > b) {
    dailyOver = Math.round(((s - b) / Math.max(1, pace.elapsed)) * 100) / 100
  } else {
    daily = Math.round(((b - s) / Math.max(1, pace.remainDays)) * 100) / 100
  }

  return {
    budget: b,
    spent: s,
    remaining: Math.round((b - s) * 100) / 100,
    over: s > b ? Math.round((s - b) * 100) / 100 : 0,
    ratio,
    pct: Math.min(ratio, 1) * 100,
    spentPct,
    level,
    pace,
    paceLevel,
    daily,
    dailyOver
  }
}

/**
 * 分类预算执行（纯函数）：对 categoryBudgets 中每个分类，
 * 统计本月该分类支出，返回 [{name,budget,spent,remaining,over,ratio,pct,level}]，
 * 超支优先、其余按使用率降序。
 */
export function categoryBudgetStatus(catBudgets, records, now = new Date()) {
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const spentMap = new Map()
  for (const r of records) {
    if (r.type !== 'expense' || !String(r.date).startsWith(key)) continue
    const cat = r.category || '未分类'
    spentMap.set(cat, (spentMap.get(cat) || 0) + (Number(r.amount) || 0))
  }
  const rows = []
  for (const [name, rawB] of Object.entries(catBudgets || {})) {
    const budget = Number(rawB) || 0
    const spent = Math.round((spentMap.get(name) || 0) * 100) / 100
    const ratio = budget > 0 ? spent / budget : 0
    rows.push({
      name,
      budget,
      spent,
      remaining: Math.round((budget - spent) * 100) / 100,
      over: spent > budget ? Math.round((spent - budget) * 100) / 100 : 0,
      ratio,
      pct: Math.min(ratio, 1) * 100,
      level: spent > budget ? 'over' : ratio >= 0.8 ? 'near' : 'safe'
    })
  }
  return rows.sort((a, c) => {
    if ((a.level === 'over') !== (c.level === 'over')) return a.level === 'over' ? -1 : 1
    return c.ratio - a.ratio
  })
}

// ------------------------------ 图表渲染 ------------------------------------

let trendChart = null
let catChart = null

function ensureCharts() {
  if (trendChart) return
  trendChart = window.echarts.init(document.getElementById('chart-trend'))
  catChart = window.echarts.init(document.getElementById('chart-cat'))
  window.addEventListener('resize', () => {
    trendChart.resize()
    catChart.resize()
  })
}

/** 看板面板变为可见后必须重算尺寸（面板隐藏时 init 会得到 0×0） */
export function resizeDashboard() {
  if (trendChart) trendChart.resize()
  if (catChart) catChart.resize()
}

export function renderDashboard(allRecords, scopedRecords = allRecords) {
  ensureCharts()
  const trend = monthlyTrend(allRecords) // 趋势恒看全量近 12 个月，不随筛选变
  const cats = categoryShare(scopedRecords) // 占比跟随时间筛选
  const empty = allRecords.length === 0

  trendChart.setOption({
    title: empty ? { text: '暂无数据', left: 'center', top: 'middle', textStyle: { color: '#999', fontSize: 14 } } : null,
    color: ['#2f9e44', '#e03131'],
    tooltip: { trigger: 'axis', valueFormatter: (v) => fmtY(v) },
    legend: { data: ['收入', '支出'], top: 0 },
    grid: { left: 60, right: 20, top: 36, bottom: 28 },
    xAxis: { type: 'category', data: trend.map((t) => t.month.slice(2)) },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => (v >= 10000 ? v / 10000 + '万' : v) } },
    series: [
      { name: '收入', type: 'line', smooth: true, symbolSize: 6,
        areaStyle: { opacity: 0.08 }, data: trend.map((t) => Math.round(t.income * 100) / 100) },
      { name: '支出', type: 'line', smooth: true, symbolSize: 6,
        areaStyle: { opacity: 0.08 }, data: trend.map((t) => Math.round(t.expense * 100) / 100) }
    ]
  }, true)

  catChart.setOption({
    title: cats.length === 0
      ? { text: '暂无支出数据', left: 'center', top: 'middle', textStyle: { color: '#999', fontSize: 14 } } : null,
    color: PALETTE,
    tooltip: { trigger: 'item', valueFormatter: (v) => fmtY(v) },
    legend: { type: 'scroll', orient: 'horizontal', bottom: 0 },
    series: [{
      type: 'pie', radius: ['42%', '68%'], center: ['50%', '44%'],
      itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
      label: { formatter: '{b}\n{d}%' },
      data: cats
    }]
  }, true)
  resizeDashboard()
}

export function renderTopList(records) {
  const box = document.getElementById('top-expense-tbody')
  const tops = topExpenses(records)
  if (!tops.length) {
    box.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center;padding:16px">暂无支出流水</td></tr>'
    return
  }
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  box.innerHTML = tops.map((r) => `
    <tr>
      <td>${esc(r.date)}</td>
      <td>${esc(r.category)}</td>
      <td class="num expense">-${Number(r.amount).toFixed(2)}</td>
      <td>${esc(r.note)}</td>
      <td class="muted">${r.source && String(r.source).startsWith('imp-') ? 'Excel 导入' : r.source === 'demo' ? '演示' : '手动'}</td>
    </tr>`).join('')
}

// ------------------------------ 预算卡片渲染 ---------------------------------

const fmtBudget = (n) => '¥' + Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtBudget0 = (n) => '¥' + Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })

const LEVEL_META = {
  safe: { label: '预算充足', cls: 'safe' },
  near: { label: '临近上限', cls: 'near' },
  over: { label: '已超支', cls: 'over' }
}
const PACE_META = {
  ahead: { label: '支出偏快', cls: 'near' },
  track: { label: '节奏正常', cls: 'safe' },
  behind: { label: '支出偏慢', cls: 'safe' }
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 渲染本月预算面板（总预算节奏 + 每天可花 + 分类预算）。
 * @param {number} budget 每月总预算
 * @param {object} categoryBudgets {分类名: 月限额}
 * @param {array} records 当前账本流水
 * @param {function} onEdit 打开预算编辑弹窗的回调
 */
export function renderBudgetCard(budget, categoryBudgets, records, onEdit, now = new Date()) {
  const box = document.getElementById('budget-card')
  if (!box) return
  const spent = monthSpent(records, now)
  const status = budgetStatus(budget, spent, now)
  const catRows = categoryBudgetStatus(categoryBudgets, records, now)

  if (status.level === 'unset' && catRows.length === 0) {
    box.innerHTML = `
      <div class="budget-inner budget-unset">
        <div class="budget-head">
          <span class="budget-title">💰 本月预算</span>
          <button type="button" class="btn btn-sm btn-primary" id="budget-set">设置预算</button>
        </div>
        <div class='muted'>尚未设置预算。设置总预算或分类预算后，可在看板实时查看支出节奏、每天可花额度与超支提醒。</div>
      </div>`
    box.querySelector('#budget-set').onclick = onEdit
    return
  }

  const hasTotal = status.level !== 'unset'
  const meta = LEVEL_META[hasTotal ? status.level : 'safe']
  const pace = PACE_META[status.paceLevel === 'none' ? 'track' : status.paceLevel]
  const headTag = hasTotal
    ? `<span class="budget-pace-tag budget-pace-${pace.cls}">${pace.label}</span>`
    : '<span class="budget-pace-tag budget-pace-safe">分类预算</span>'

  const totalNums = hasTotal ? `
    <div class="budget-nums">
      <span>预算 <b>${fmtBudget(status.budget)}</b></span>
      <span>已支出 <b class="budget-spent">${fmtBudget(status.spent)}</b></span>
      <span>${status.level === 'over' ? '超支' : '剩余'} <b class="budget-remain budget-${meta.cls}">${fmtBudget(status.level === 'over' ? status.over : status.remaining)}</b></span>
      <span class="budget-pct">${status.spentPct.toFixed(0)}%</span>
    </div>` : `
    <div class="budget-nums">
      <span>本月已支出 <b class="budget-spent">${fmtBudget(status.spent)}</b></span>
    </div>`

  const barSection = hasTotal ? `
    <div class="budget-bar budget-bar-pace">
      <i class="budget-fill budget-${meta.cls}" style="width:${status.pct}%"></i>
      <span class="budget-time-mark" style="left:${status.pace.timePct}%" title="时间进度"></span>
    </div>
    <div class="budget-pace-line muted">
      本月已过 ${status.pace.elapsed}/${status.pace.dim} 天（时间进度 ${status.pace.timePct}%）　<span class="budget-edit" id="budget-edit">修改预算</span>
    </div>` : `
    <div class="budget-pace-line muted">仅设置了分类预算，未设总预算　<span class="budget-edit" id="budget-edit">设置总预算</span></div>`

  let dailyLine = ''
  if (status.level === 'over') {
    dailyLine = `日均超支约 ${fmtBudget(status.dailyOver)}，建议立即控制支出`
  } else if (hasTotal) {
    dailyLine = status.pace.remainDays > 0
      ? `剩余 ${status.pace.remainDays} 天，每天可花 ${fmtBudget(status.daily)}`
      : `今天还可花 ${fmtBudget(status.daily)}`
  }

  const catSection = catRows.length ? `
    <div class="bc-divider">分类预算</div>
    <div class="bc-list">
      ${catRows.map((r) => `
        <div class="bc-row bc-${r.level}">
          <span class="bc-name">${escHtml(r.name)}</span>
          <span class="bc-bar"><i class="bc-fill bc-fill-${r.level}" style="width:${r.pct}%"></i></span>
          <span class="bc-meta">${fmtBudget0(r.spent)} / ${fmtBudget0(r.budget)}</span>
          <span class="bc-state">${r.level === 'over' ? `超 ${fmtBudget0(r.over)}` : r.pct.toFixed(0) + '%'}</span>
        </div>`).join('')}
    </div>` : ''

  box.innerHTML = `
    <div class="budget-inner">
      <div class="budget-head">
        <span class="budget-title">💰 本月预算</span>
        ${headTag}
      </div>
      ${totalNums}
      ${barSection}
      ${dailyLine ? `<div class="budget-daily">${dailyLine}</div>` : ''}
      ${catSection}
      <div class="budget-manage-line"><span class="budget-edit" id="budget-manage">${catRows.length ? '管理分类预算' : '添加分类预算'}</span></div>
    </div>`
  const editInline = box.querySelector('#budget-edit')
  if (editInline) editInline.onclick = onEdit
  box.querySelector('#budget-manage').onclick = onEdit
}
