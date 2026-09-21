// ---------------------------------------------------------------------------
// import-ui.mjs —— Excel 导入面板：选文件 → 识别 → 列映射确认 → 预览 → 入库
// ---------------------------------------------------------------------------

import {
  sheetToGrid, detectHeaderRow, guessMapping, normalizeRecords
} from './import-core.mjs'
import { syncAllSelects } from '../ui/select.mjs'

const $ = (sel) => document.querySelector(sel)

let workbook = null
let fileName = ''
let grid = []
let headers = []
let guess = null
let lastParsed = { records: [], skipped: 0 }

/**
 * @param opts.getLedger    () => 当前账本完整数据 | null
 * @param opts.onImported   (records, batch) => Promise  入库回调
 * @param opts.refreshHistory () => void  重绘导入历史
 */
export function initImportPanel(opts) {
  const zone = $('#import-zone')
  const fileInput = $('#file-input')

  zone.addEventListener('click', () => fileInput.click())
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag') })
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'))
  zone.addEventListener('drop', (e) => {
    e.preventDefault()
    zone.classList.remove('drag')
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0])
  })
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0])
    fileInput.value = ''
  })

  $('#sel-sheet').addEventListener('change', () => { parseSheet(); refreshPreview() })
  $('#inp-header-row').addEventListener('change', () => { applyHeaderRow(); refreshPreview() })
  $('#sel-mode').addEventListener('change', () => { syncModeVisibility(); refreshPreview() })
  ;['#map-date', '#map-amount', '#map-income', '#map-expense', '#map-type', '#map-category', '#map-note']
    .forEach((id) => $(id).addEventListener('change', refreshPreview))

  $('#btn-import-confirm').addEventListener('click', async () => {
    if (!opts.getLedger()) return showError('请先创建或选择一个账本，再导入流水')
    if (!lastParsed.records.length) return showError('没有可导入的记录，请检查列映射')
    const batchId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    const records = lastParsed.records.map((r, i) => ({
      ...r,
      id: `rec-${batchId}-${i}`,
      source: `imp-${batchId}`
    }))
    try {
      await opts.onImported(records, {
        id: batchId,
        fileName,
        sheet: $('#sel-sheet').value,
        count: records.length,
        importedAt: Date.now()
      })
      $('#import-config').classList.add('hidden')
      $('#import-zone').hidden = false
      opts.refreshHistory()
    } catch (e) {
      showError('导入失败：' + e.message)
    }
  })
}

// ------------------------------ 文件读取 ------------------------------------

async function handleFile(file) {
  clearError()
  if (!/\.(xlsx|xls)$/i.test(file.name)) return showError('仅支持 .xlsx / .xls 文件（如需 CSV 请先另存为 Excel）')
  try {
    const buf = new Uint8Array(await file.arrayBuffer())
    workbook = window.XLSX.read(buf, { type: 'array' })
    fileName = file.name
    const sel = $('#sel-sheet')
    sel.innerHTML = workbook.SheetNames
      .map((n) => `<option value="${n.replace(/"/g, '&quot;')}">${n.replace(/</g, '&lt;')}</option>`)
      .join('')
    parseSheet()
    refreshPreview()
    $('#import-zone').hidden = true
    $('#import-config').classList.remove('hidden')
    $('#import-file-title').textContent = `📄 ${fileName}`
  } catch (e) {
    showError('文件解析失败：' + e.message)
  }
}

function parseSheet() {
  const ws = workbook.Sheets[$('#sel-sheet').value]
  grid = sheetToGrid(ws, window.XLSX)
  const idx = detectHeaderRow(grid)
  $('#inp-header-row').value = String(idx + 1)
  applyHeaderRow()
}

function applyHeaderRow() {
  const idx = Math.max(0, parseInt($('#inp-header-row').value, 10) - 1 || 0)
  headers = (grid[idx] || []).map((h, i) => String(h ?? '').trim() || `第${i + 1}列`)
  guess = guessMapping(headers)
  buildColumnOptions()
  syncModeVisibility()
  syncAllSelects() // 程序化赋值不触发事件，主动刷新自绘下拉显示
}

// ------------------------------ 映射控件 ------------------------------------

function buildColumnOptions() {
  const options = '<option value="-1">—（无）</option>' +
    headers.map((h, i) => `<option value="${i}">${escapeHtml(h)}</option>`).join('')
  for (const id of ['#map-date', '#map-amount', '#map-income', '#map-expense', '#map-type', '#map-category', '#map-note']) {
    const el = $(id)
    el.innerHTML = options
  }
  setIfFound('#map-date', guess.date)
  setIfFound('#map-amount', guess.amount)
  setIfFound('#map-income', guess.income)
  setIfFound('#map-expense', guess.expense)
  setIfFound('#map-type', guess.type)
  setIfFound('#map-category', guess.category)
  setIfFound('#map-note', guess.note)
  $('#sel-mode').value = guess.mode
}

function setIfFound(id, idx) {
  if (idx >= 0) $(id).value = String(idx)
}

function syncModeVisibility() {
  const mode = $('#sel-mode').value
  show('#row-map-amount', mode !== 'twoCol')
  show('#row-map-income', mode === 'twoCol')
  show('#row-map-expense', mode === 'twoCol')
  show('#row-map-type', mode === 'typeCol')
}

function show(id, visible) {
  const el = $(id)
  if (el) el.classList.toggle('hidden', !visible)
}

function currentCfg() {
  return {
    mode: $('#sel-mode').value,
    date: +$('#map-date').value,
    amount: +$('#map-amount').value,
    income: +$('#map-income').value,
    expense: +$('#map-expense').value,
    type: +$('#map-type').value,
    category: +$('#map-category').value,
    note: +$('#map-note').value
  }
}

// ------------------------------ 预览与导入 ----------------------------------

function refreshPreview() {
  const cfg = currentCfg()
  const headerIdx = Math.max(0, parseInt($('#inp-header-row').value, 10) - 1 || 0)
  const { records, skipped } = normalizeRecords(grid, headerIdx, cfg)
  lastParsed = { records, skipped }

  const rows = records.slice(0, 8).map((r) => `
    <tr>
      <td>${r.date}</td>
      <td class="${r.type}">${r.type === 'income' ? '收入' : '支出'}</td>
      <td>${escapeHtml(r.category)}</td>
      <td class="num">${r.amount.toFixed(2)}</td>
      <td>${escapeHtml(r.note)}</td>
    </tr>`).join('')
  $('#import-preview').innerHTML = rows
    ? `<table class="data-table"><thead><tr><th>日期</th><th>收支</th><th>分类</th><th>金额</th><th>备注</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<div class='muted'>未识别到有效流水，请调整表头行 / 模式 / 列映射</div>`
  $('#import-summary').textContent =
    `识别到 ${records.length} 条有效流水${skipped ? `，跳过 ${skipped} 行（空行或无法解析）` : ''}`
  $('#btn-import-confirm').textContent = `确认导入 ${records.length} 条流水`
  $('#btn-import-confirm').disabled = records.length === 0
}

// ------------------------------ 小工具 --------------------------------------

function showError(msg) { $('#import-error').textContent = msg }
function clearError() { $('#import-error').textContent = '' }
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
