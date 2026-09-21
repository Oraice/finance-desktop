// ---------------------------------------------------------------------------
// export-ui.mjs —— 报表导出面板：生成工作簿 → 系统“另存为” → 主进程落盘
// ---------------------------------------------------------------------------

import { buildWorkbook, workbookToBytes, reportFileName } from './xlsx/export-core.mjs'

const $ = (sel) => document.querySelector(sel)

let deps = null

export function initExportPanel(_deps) {
  deps = _deps
  $('#btn-export').addEventListener('click', doExport)
}

export function updateExportView() {
  const ledger = deps ? deps.getLedger() : null
  const meta = $('#export-meta')
  const btn = $('#btn-export')
  if (!ledger) {
    meta.textContent = '请先在左侧创建 / 选择账本'
    btn.disabled = true
    return
  }
  const records = ledger.records || []
  meta.textContent = `当前账本「${ledger.name}」· ${records.length} 条流水`
  btn.disabled = records.length === 0
}

async function doExport() {
  const ledger = deps.getLedger()
  if (!ledger || !(ledger.records || []).length) return
  const status = $('#export-status')
  status.textContent = '生成中…'
  try {
    const wb = buildWorkbook(window.XLSX, ledger, {
      typeFilter: $('#x-type').value,
      categoryFilter: 'all',
      keyword: ''
    })
    const bytes = workbookToBytes(window.XLSX, wb)
    status.textContent = '等待选择保存位置…'
    const res = await window.ledgerAPI.saveBinary(reportFileName(ledger.name), bytes)
    status.textContent = res.ok
      ? `✅ 已保存：${res.path}`
      : '已取消'
  } catch (e) {
    status.textContent = '❌ 导出失败：' + e.message
  }
}
