// ---------------------------------------------------------------------------
// pdf-report.mjs —— 生成自包含 A4 月度财务报告 HTML（内联 CSS + ECharts 图片）
// 由主进程隐藏窗口 printToPDF 输出。
// ---------------------------------------------------------------------------

import { toPnlRecords } from './lib/record-flags.mjs'
const pad2 = (n) => String(n).padStart(2, '0')
const fmt = (n) => '¥' + Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt0 = (n) => '¥' + Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function monthSums(records, y, m) {
  const key = `${y}-${pad2(m)}`
  let income = 0
  let expense = 0
  let count = 0
  const cats = new Map()
  const days = new Set()
  for (const r of records) {
    if (String(r.date || '').slice(0, 7) !== key) continue
    const amt = Number(r.amount) || 0
    if (r.type === 'income') income += amt
    else if (r.type === 'expense') {
      expense += amt
      cats.set(r.category || '未分类', (cats.get(r.category || '未分类') || 0) + amt)
    } else continue
    count++; days.add(r.date)
  }
  return { key, income, expense, count, cats, days: days.size }
}

function recentMonths(records, y, m, n = 6) {
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - i, 1)
    const s = monthSums(records, d.getFullYear(), d.getMonth() + 1)
    out.push({ key: s.key, income: s.income, expense: s.expense })
  }
  return out
}

const pctOf = (cur, prev) => (prev > 0 ? ((cur - prev) / prev) * 100 : null)

/** 用离屏 ECharts 渲染并取 PNG dataURL */
function chartImage(option, w = 920, h = 300) {
  const el = document.createElement('div')
  el.style.cssText = `width:${w}px;height:${h}px;position:absolute;left:-9999px;top:0`
  document.body.appendChild(el)
  const chart = window.echarts.init(el, null, { renderer: 'canvas' })
  // 导出图必须关闭动画：setOption 后立即取图，否则抓拍到动画初始帧（饼图扇区角度为 0 → 只剩图例、扇区空白）
  chart.setOption(Object.assign({ animation: false }, option))
  const url = chart.getDataURL({ type: 'png', pixelRatio: 3, backgroundColor: '#fff' })
  chart.dispose(); el.remove()
  return url
}

function pctCell(cur, prev) {
  const p = pctOf(cur, prev)
  if (p === null) return '<span class="muted">—</span>'
  const up = p >= 0
  return `<span class="${up ? 'txt-inc' : 'txt-exp'}">${up ? '▲' : '▼'} ${Math.abs(p).toFixed(1)}%</span>`
}

function budgetSection(cur, profile) {
  const mb = Number(profile?.monthlyBudget) || 0
  let html = ''
  if (mb > 0) {
    const over = cur.expense > mb
    const p = Math.min((cur.expense / mb) * 100, 100)
    html += `
      <div class="box budget-main">
        <div class="box-title">月度预算执行</div>
        <div class="bar"><div class="bar-fill ${over ? 'bar-over' : ''}" style="width:${p}%"></div></div>
        <div class="budget-nums">预算 ${fmt0(mb)}　·　已花 ${fmt0(cur.expense)}　·　${over ? '超支 ' + fmt0(cur.expense - mb) : '剩余 ' + fmt0(mb - cur.expense)}</div>
      </div>`
  }
  const cb = profile?.categoryBudgets || {}
  const rows = Object.entries(cb).filter(([, v]) => Number(v) > 0)
  if (rows.length) {
    html += '<table class="rep-table"><thead><tr><th>分类预算</th><th>限额</th><th>已花</th><th>进度</th></tr></thead><tbody>'
    for (const [name, limit] of rows) {
      const used = cur.cats.get(name) || 0
      const over = used > limit
      const p = Math.min((used / limit) * 100, 100)
      html += `<tr><td>${esc(name)}</td><td>${fmt0(limit)}</td><td>${fmt0(used)}</td>
        <td style="min-width:150px"><div class="bar sm"><div class="bar-fill ${over ? 'bar-over' : ''}" style="width:${p}%"></div></div>
        ${over ? '<span class="txt-exp">超支</span>' : p >= 80 ? '<span class="txt-warn">接近</span>' : '<span class="txt-inc">正常</span>'}</td></tr>`
    }
    html += '</tbody></table>'
  }
  return html || `<p class='muted'>未设置预算。可在「个人资料」中设置月度预算与分类预算后，月报将展示执行情况。</p>`
}

function categoryBars(cur) {
  const PIE_COLORS = ['#d9480f', '#e8590c', '#f08c00', '#fab005', '#94d82d', '#20c997', '#22b8cf', '#4263eb', '#7048e8', '#e64980']
  const list = [...cur.cats.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  const max = list[0]?.value || 1
  if (!list.length) return '<p class="muted">本月暂无支出。</p>'
  return list.map((c, i) => `
    <div class="cat-row">
      <span class="cat-name">${esc(c.name)}</span>
      <span class="cat-bar"><span class="cat-fill" style="width:${(c.value / max) * 100}%;background:${PIE_COLORS[i % PIE_COLORS.length]}"></span></span>
      <span class="cat-val">${fmt0(c.value)}</span>
    </div>`).join('')
}

/**
 * 构建月报 HTML。
 * @param ledger 当前账本（含 name/iconImage/records）
 * @param target {year,month}（month 1-12）
 * @param profile 用户资料（monthlyBudget/categoryBudgets）
 * @param app {appName,appLogo}
 */
export function buildMonthlyReportHTML(ledger, target, profile, app) {
  const records = toPnlRecords(ledger?.records || [])
  const y = Number(target.year)
  const m = Number(target.month)
  const cur = monthSums(records, y, m)
  const prevDate = new Date(y, m - 2, 1)
  const prev = monthSums(records, prevDate.getFullYear(), prevDate.getMonth() + 1)
  const balance = cur.income - cur.expense
  const prevBalance = prev.income - prev.expense

  const trend = recentMonths(records, y, m, 6)
  const trendImg = chartImage({
    tooltip: { trigger: 'axis', valueFormatter: (v) => fmt0(v) },
    legend: { data: ['收入', '支出'], top: 0 },
    grid: { left: 60, right: 20, top: 36, bottom: 30 },
    xAxis: { type: 'category', data: trend.map((t) => t.key.slice(2)) },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => (v >= 10000 ? v / 10000 + '万' : v) } },
    series: [
      { name: '收入', type: 'line', smooth: true, areaStyle: { opacity: 0.12 }, itemStyle: { color: '#2f9e44' }, data: trend.map((t) => t.income) },
      { name: '支出', type: 'line', smooth: true, areaStyle: { opacity: 0.12 }, itemStyle: { color: '#e03131' }, data: trend.map((t) => t.expense) }
    ]
  })

  const catList = [...cur.cats.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  const pieImg = chartImage({
    tooltip: { trigger: 'item', valueFormatter: (v) => fmt0(v) },
    legend: { type: 'scroll', orient: 'vertical', right: 8, top: 'middle' },
    color: ['#d9480f', '#e8590c', '#f08c00', '#fab005', '#94d82d', '#20c997', '#22b8cf', '#4263eb', '#7048e8', '#e64980'],
    series: [{
      type: 'pie', radius: ['40%', '66%'], center: ['38%', '50%'],
      itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
      label: { formatter: '{b}\n{d}%' }, data: catList
    }]
  }, 920, 320)

  const appName = esc(app?.appName || '财账簿')
  const logoHtml = app?.appLogo
    ? `<img class="brand-logo" src="${app.appLogo}" alt="">`
    : '<span class="brand-logo brand-emoji">💰</span>'
  const nowText = new Date().toLocaleString('zh-CN', { hour12: false })

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${esc(ledger?.name || '')} ${y}年${m}月月报</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; font-family:"Microsoft YaHei","PingFang SC","Segoe UI",sans-serif; color:#2b2d33; background:#fff; font-size:13px; line-height:1.6; }
  .page { width:100%; padding:0; }
  .brandbar { display:flex; align-items:center; gap:10px; background:linear-gradient(120deg,#d9480f,#e8590c); color:#fff; padding:22px 30px; }
  .brandbar .brand-logo { width:42px; height:42px; border-radius:11px; background:rgba(255,255,255,.18); display:flex; align-items:center; justify-content:center; font-size:22px; object-fit:cover; }
  .brandbar .brand-name { font-size:18px; font-weight:700; letter-spacing:1px; }
  .brandbar .brand-sub { font-size:12px; opacity:.85; }
  .report-head { padding:30px 30px 8px; display:flex; align-items:center; justify-content:center; gap:18px; }
  .rh-badge { flex:none; width:76px; height:76px; border-radius:18px; background:linear-gradient(135deg,#f08c00,#d9480f); color:#fff; display:flex; flex-direction:column; align-items:center; justify-content:center; box-shadow:0 12px 24px rgba(217,72,15,.32); }
  .rh-badge .rh-m { font-size:30px; font-weight:800; line-height:1; }
  .rh-badge .rh-y { font-size:11px; opacity:.92; margin-top:4px; }
  .report-head h1 { margin:0; font-size:23px; color:#222; }
  .report-head .sub { color:#999; margin-top:8px; font-size:12px; }
  .section { padding:14px 30px; page-break-inside:avoid; }
  .section-title { font-size:14px; font-weight:700; margin:8px 0 14px; display:flex; align-items:center; gap:9px; color:#222; }
  .st-no { flex:none; width:23px; height:23px; border-radius:50%; background:linear-gradient(135deg,#f08c00,#d9480f); color:#fff; font-size:12px; font-weight:700; display:flex; align-items:center; justify-content:center; }
  .kpi-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; }
  .kpi { border:1px solid #eef0f2; border-radius:14px; padding:14px 16px; background:#fff; box-shadow:0 2px 10px rgba(31,35,41,.05); position:relative; overflow:hidden; }
  .kpi::before { content:""; position:absolute; left:0; top:0; bottom:0; width:4px; }
  .kpi.k-in::before { background:#2f9e44; } .kpi.k-ex::before { background:#e03131; }
  .kpi.k-bal::before { background:#1971c2; } .kpi.k-neutral::before { background:#f08c00; }
  .kpi .kpi-label { color:#888; font-size:12px; }
  .kpi .kpi-val { font-size:21px; font-weight:800; margin-top:6px; }
  .inc { color:#2f9e44; } .exp { color:#e03131; } .bal { color:#1971c2; }
  table.rep-table { width:100%; border-collapse:collapse; font-size:12.5px; }
  .rep-table th,.rep-table td { border:1px solid #ececef; padding:8px 10px; text-align:left; }
  .rep-table th { background:#fff4ec; color:#b45309; font-weight:600; }
  .rep-table tbody tr:nth-child(even) { background:#faf8f6; }
  .rep-table td.num { text-align:right; font-variant-numeric:tabular-nums; }
  .box { border:1px solid #ececef; border-radius:12px; padding:16px; margin-bottom:14px; }
  .box-title { font-weight:700; margin-bottom:12px; }
  .bar { height:10px; background:#f0f0f2; border-radius:6px; overflow:hidden; }
  .bar.sm { height:8px; display:inline-block; width:110px; vertical-align:middle; margin-right:8px; }
  .bar-fill { height:100%; background:linear-gradient(90deg,#f08c00,#d9480f); border-radius:6px; }
  .bar-over { background:linear-gradient(90deg,#fa5252,#e03131); }
  .budget-nums { margin-top:10px; color:#666; font-size:12.5px; }
  .cat-row { display:flex; align-items:center; gap:12px; margin:7px 0; }
  .cat-name { width:96px; color:#444; font-size:12.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .cat-bar { flex:1; height:14px; background:#f4f4f6; border-radius:7px; overflow:hidden; }
  .cat-fill { display:block; height:100%; background:linear-gradient(90deg,#f08c00,#d9480f); border-radius:7px; }
  .cat-val { width:110px; text-align:right; font-variant-numeric:tabular-nums; font-weight:600; }
  .chart-img { width:100%; border:1px solid #ececef; border-radius:12px; }
  .two-col { display:grid; grid-template-columns:1fr; gap:16px; }
  .txt-inc { color:#2f9e44; font-weight:600; } .txt-exp { color:#e03131; font-weight:600; } .txt-warn { color:#f08c00; font-weight:600; }
  .muted { color:#999; }
  .foot { padding:18px 30px 26px; color:#aaa; font-size:11px; text-align:center; border-top:1px solid #f0f0f0; margin-top:10px; }
  .page-break { page-break-before:always; }
</style>
</head>
<body>
  <div class="brandbar">
    ${logoHtml}
    <div>
      <div class="brand-name">${appName}</div>
      <div class="brand-sub">本地 · 安全 · 离线可用的个人财务管家</div>
    </div>
  </div>

  <div class="report-head">
    <div class="rh-badge"><div class="rh-m">${pad2(m)}</div><div class="rh-y">${y} 年</div></div>
    <div style="text-align:left">
      <h1>${esc(ledger?.name || '默认账本')} · 月度财务报告</h1>
      <div class="sub">报告生成时间：${nowText}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title"><span class="st-no">1</span>本月核心指标</div>
    <div class="kpi-grid">
      <div class="kpi k-in"><div class="kpi-label">本月收入</div><div class="kpi-val inc">${fmt(cur.income)}</div></div>
      <div class="kpi k-ex"><div class="kpi-label">本月支出</div><div class="kpi-val exp">${fmt(cur.expense)}</div></div>
      <div class="kpi k-bal"><div class="kpi-label">本月结余</div><div class="kpi-val ${balance >= 0 ? 'bal' : 'exp'}">${fmt(balance)}</div></div>
      <div class="kpi k-neutral"><div class="kpi-label">记账笔数 / 天数</div><div class="kpi-val" style="color:#333">${cur.count} 笔 / ${cur.days} 天</div></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title"><span class="st-no">2</span>收支环比<span class="muted" style="font-weight:400;margin-left:2px">对比上月 ${prev.key}</span></div>
    <table class="rep-table">
      <thead><tr><th>项目</th><th class="num">本月</th><th class="num">上月</th><th class="num">环比</th></tr></thead>
      <tbody>
        <tr><td>收入</td><td class="num">${fmt(cur.income)}</td><td class="num">${fmt(prev.income)}</td><td class="num">${pctCell(cur.income, prev.income)}</td></tr>
        <tr><td>支出</td><td class="num">${fmt(cur.expense)}</td><td class="num">${fmt(prev.expense)}</td><td class="num">${pctCell(cur.expense, prev.expense)}</td></tr>
        <tr><td>结余</td><td class="num">${fmt(balance)}</td><td class="num">${fmt(prevBalance)}</td><td class="num">${pctCell(balance, prevBalance)}</td></tr>
      </tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title"><span class="st-no">3</span>预算执行</div>
    ${budgetSection(cur, profile)}
  </div>

  <div class="section page-break">
    <div class="section-title"><span class="st-no">4</span>近 6 个月收支趋势</div>
    <img class="chart-img" src="${trendImg}" alt="趋势图">
  </div>

  <div class="section">
    <div class="section-title"><span class="st-no">5</span>本月支出分类占比</div>
    <img class="chart-img" src="${pieImg}" alt="分类占比">
  </div>

  <div class="section">
    <div class="section-title"><span class="st-no">6</span>分类支出明细</div>
    <div class="box">${categoryBars(cur)}</div>
  </div>

  <div class="foot">本报告由 ${appName} 在本机离线生成，数据仅保存在你的电脑上。</div>
</body>
</html>`
}
