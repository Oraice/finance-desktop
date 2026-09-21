// ---------------------------------------------------------------------------
// export-core.mjs —— 报表工作簿生成（纯逻辑，XLSX 实例注入，便于 Node 测试）
// 输出三张 Sheet：月度汇总 / 分类占比 / 收支明细
// ---------------------------------------------------------------------------

import { monthlyTrend, categoryShare } from '../charts/dashboard.mjs'
import { toPnlRecords } from '../lib/record-flags.mjs'

export function buildMonthlySheet(XLSX, records) {
  const rows = monthlyTrend(records)
  const aoa = [['月份', '收入', '支出', '结余']]
  let ti = 0
  let te = 0
  for (const r of rows) {
    ti += r.income
    te += r.expense
    aoa.push([r.month, round2(r.income), round2(r.expense), round2(r.income - r.expense)])
  }
  aoa.push(['合计', round2(ti), round2(te), round2(ti - te)])
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }]
  styleMoney(XLSX, ws, [1, 2, 3])
  return ws
}

export function buildCategorySheet(XLSX, records) {
  const exp = categoryShare(records)
  const inc = categoryShareIncome(records)
  const expTotal = exp.reduce((s, x) => s + x.value, 0) || 1
  const incTotal = inc.reduce((s, x) => s + x.value, 0) || 1

  const aoa = [['支出分类', '金额', '占比']]
  for (const c of exp) aoa.push([c.name, c.value, c.value / expTotal])
  aoa.push(['合计', round2(exp.reduce((s, x) => s + x.value, 0)), 1])
  aoa.push([], ['收入分类', '金额', '占比'])
  for (const c of inc) aoa.push([c.name, c.value, c.value / incTotal])
  aoa.push(['合计', round2(inc.reduce((s, x) => s + x.value, 0)), 1])

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 10 }]
  styleMoney(XLSX, ws, [1])
  stylePercent(XLSX, ws, [2])
  return ws
}

export function buildDetailSheet(XLSX, records, { typeFilter = 'all', categoryFilter = 'all', keyword = '' } = {}) {
  const kw = String(keyword || '').trim().toLowerCase()
  const list = records
    .filter((r) =>
      (typeFilter === 'all' || r.type === typeFilter) &&
      (categoryFilter === 'all' || (r.category || '未分类') === categoryFilter) &&
      (!kw || `${r.note || ''} ${r.category || ''}`.toLowerCase().includes(kw)))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  const aoa = [['日期', '收支', '分类', '金额', '备注', '来源']]
  for (const r of list) {
    aoa.push([
      r.date,
      r.type === 'income' ? '收入' : '支出',
      r.category || '未分类',
      Number(r.amount) || 0,
      r.note || '',
      sourceLabel(r.source)
    ])
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 14 }, { wch: 28 }, { wch: 12 }]
  styleMoney(XLSX, ws, [3])
  return { ws, count: list.length }
}

/** 组装完整工作簿 */
export function buildWorkbook(XLSX, ledger, detailFilter) {
  const records = toPnlRecords(ledger.records || [])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, buildMonthlySheet(XLSX, records), '月度汇总')
  XLSX.utils.book_append_sheet(wb, buildCategorySheet(XLSX, records), '分类占比')
  const { ws, count } = buildDetailSheet(XLSX, records, detailFilter)
  XLSX.utils.book_append_sheet(wb, ws, `收支明细(${count})`)
  return wb
}

/** 工作簿 → Uint8Array（供 IPC 交给主进程落盘） */
export function workbookToBytes(XLSX, wb) {
  return new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }))
}

/** 默认文件名：过滤 Windows 非法字符 */
export function reportFileName(ledgerName, date = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}`
  const safe = String(ledgerName || '账本').replace(/[\\/:*?"<>|]/g, '_')
  return `${safe}_财务报表_${stamp}.xlsx`
}

// ------------------------------ 内部小工具 ----------------------------------

function categoryShareIncome(records) {
  const map = new Map()
  for (const r of records) {
    if (r.type !== 'income') continue
    const cat = r.category || '未分类'
    map.set(cat, (map.get(cat) || 0) + (Number(r.amount) || 0))
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value: round2(value) }))
    .sort((a, b) => b.value - a.value)
}

function round2(n) { return Math.round(n * 100) / 100 }

function sourceLabel(s) {
  return !s || s === '手动' ? '手动' : s === 'demo' ? '演示数据' : String(s).startsWith('imp-') ? 'Excel导入' : String(s)
}

function styleMoney(XLSX, ws, cols, fromRow = 1) {
  const range = XLSX.utils.decode_range(ws['!ref'])
  for (let R = fromRow; R <= range.e.r; R++) {
    for (const C of cols) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })]
      if (cell && typeof cell.v === 'number') cell.z = '#,##0.00'
    }
  }
}

function stylePercent(XLSX, ws, cols, fromRow = 1) {
  const range = XLSX.utils.decode_range(ws['!ref'])
  for (let R = fromRow; R <= range.e.r; R++) {
    for (const C of cols) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })]
      if (cell && typeof cell.v === 'number') cell.z = '0.0%'
    }
  }
}
