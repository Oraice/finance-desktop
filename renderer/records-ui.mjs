// ---------------------------------------------------------------------------
// records-ui.mjs —— 流水明细管理：补录、编辑、删除、筛选、分页，
// 以及退款冲正 / 代垫 / 报销的登记入口。
// filterRecords / paginate 为纯函数，可脱离 DOM 单元测试。
// ---------------------------------------------------------------------------

import { askConfirm } from './ui/dialog.mjs'
import { pushUndo } from './lib/undo.mjs'
import { makeRefund, makeAdvance, makeReimburse, advanceStatus } from './lib/record-flags.mjs'

const PAGE_SIZE = 20

// ------------------------------ 纯函数 --------------------------------------

/** 按指定方式排序：date-desc / date-asc / amount-desc / amount-asc；同值以登记时刻、id 兜底，保证稳定 */
export function sortRecords(list, sort = 'date-desc') {
  const d = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
  const c = (a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
  const idC = (a, b) => String(a.id).localeCompare(String(b.id))
  switch (sort) {
    case 'date-asc':
      return [...list].sort((a, b) => d(a, b) || c(a, b) || idC(a, b))
    case 'amount-desc':
      return [...list].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || d(b, a) || idC(a, b))
    case 'amount-asc':
      return [...list].sort((a, b) => Math.abs(a.amount) - Math.abs(b.amount) || d(a, b) || idC(a, b))
    default: // date-desc
      return [...list].sort((a, b) => d(b, a) || c(b, a) || idC(a, b))
  }
}

/** 按 收支类型 / 分类 / 关键字（备注+分类）过滤，并按 sort 排序 */
export function filterRecords(records, { type = 'all', category = 'all', keyword = '', sort = 'date-desc' } = {}) {
  const kw = String(keyword || '').trim().toLowerCase()
  const kept = records.filter((r) => {
    if (type !== 'all' && r.type !== type) return false
    if (category !== 'all' && (r.category || '未分类') !== category) return false
    if (kw) {
      const hay = `${r.note || ''} ${r.category || ''}`.toLowerCase()
      if (!hay.includes(kw)) return false
    }
    return true
  })
  return sortRecords(kept, sort)
}

/** 返回 { slice, from, to, page, pages } */
export function paginate(list, page) {
  const total = list.length
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const p = Math.min(Math.max(1, page), pages)
  const start = (p - 1) * PAGE_SIZE
  const slice = list.slice(start, start + PAGE_SIZE)
  return { slice, from: total ? start + 1 : 0, to: start + slice.length, page: p, pages }
}

export function uniqueCategories(records) {
  const set = new Set(records.map((r) => r.category || '未分类'))
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

// ---------------------------- 撤销数据变换（纯函数） -------------------------

/** 撤销删除：被删记录若已不存在则加回，不影响其他记录 */
export function withRecordRestored(records, r) {
  return records.some((x) => x.id === r.id) ? records : [...records, r]
}

/** 撤销新增：移除指定 id */
export function withoutRecord(records, id) {
  return records.filter((x) => x.id !== id)
}

/** 撤销编辑：用旧记录覆盖同 id，其余不动 */
export function withRecordReverted(records, old) {
  return records.map((x) => (x.id === old.id ? old : x))
}

// ------------------------------ DOM 接线 ------------------------------------

const $ = (sel) => document.querySelector(sel)
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const newRecId = () => 'rec-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
const todayStr = () => new Date().toISOString().slice(0, 10)

const DEFAULT_CATS = ['餐饮', '交通', '购物', '居家', '娱乐', '医疗', '工资', '奖金', '报销', '其他收入', '未分类']

// 分类色点：按分类名稳定取色，增强列表识别（柔和色，避免与收支红绿混淆）
const CAT_DOT_COLORS = ['#f08c00', '#1971c2', '#2f9e44', '#9c36b5', '#e8590c', '#1098ad', '#be4bdb', '#7048e8', '#f76707', '#0ca678', '#e64980', '#4263eb']
function catCell(cat) {
  const label = String(cat || '未分类')
  let h = 0
  for (const ch of label) h = (h + ch.charCodeAt(0)) % CAT_DOT_COLORS.length
  return `<span class="cat-cell"><span class="cat-dot" style="background:${CAT_DOT_COLORS[h]}"></span>${esc(label)}</span>`
}

const view = {
  filtered: [],
  page: 1,
  editingId: null, // null=新增；string=编辑既有 id
  formType: 'expense', // 弹窗内当前选中的收支类型（normal 模式使用）
  formMode: 'normal', // normal | refund | reimburse
  ctx: null // refund=原消费记录；reimburse=代垫记录
}

let deps = null // { getLedger, save }

export function initRecordsPanel(_deps) {
  deps = _deps
  $('#btn-add-record').addEventListener('click', () => openForm(null))
  $('#btn-empty-add').addEventListener('click', () => openForm(null))
  $('#flt-type').addEventListener('change', applyFilter)
  $('#flt-cat').addEventListener('change', applyFilter)
  $('#flt-sort').addEventListener('change', applyFilter)
  $('#btn-flt-reset').addEventListener('click', () => {
    $('#flt-type').value = 'all'
    $('#flt-cat').value = 'all'
    $('#flt-kw').value = ''
    applyFilter()
  })
  let kwTimer = null
  $('#flt-kw').addEventListener('input', () => {
    clearTimeout(kwTimer)
    kwTimer = setTimeout(applyFilter, 250)
  })
  $('#pg-prev').addEventListener('click', () => { view.page--; renderPage() })
  $('#pg-next').addEventListener('click', () => { view.page++; renderPage() })
  $('#form-cancel').addEventListener('click', closeForm)
  $('#form-x')?.addEventListener('click', closeForm)
  $('#form-save').addEventListener('click', submitForm)
  $('#form-category').addEventListener('input', syncChipActive)
  $('#form-mask').addEventListener('click', (e) => { if (e.target === $('#form-mask')) closeForm() })
  $('#form-mask').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') submitForm()
    else if (e.key === 'Escape') closeForm()
  })
  $('#form-type-seg').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn')
    if (btn) setFormType(btn.dataset.type)
  })
  $('#form-date').value = todayStr()
}

function setFormType(type) {
  view.formType = type === 'income' ? 'income' : 'expense'
  document
    .querySelectorAll('#form-type-seg .seg-btn')
    .forEach((b) => b.classList.toggle('active', b.dataset.type === view.formType))
  setFormFieldsForMode()
}

/** 按当前模式显隐：类型 / 分类 / 芯片 / 代垫勾选 */
function setFormFieldsForMode() {
  const special = view.formMode !== 'normal'
  $('#form-type-seg').closest('label').hidden = special
  $('#form-category').closest('label').hidden = special
  $('#cat-chips').closest('label').hidden = special
  const aw = $('#form-advance-wrap')
  if (special) {
    aw.hidden = true
    return
  }
  const origFlag = view.editingId ? (findById(view.editingId)?.flag || null) : null
  aw.hidden = view.formType !== 'expense' || origFlag === 'refund' || origFlag === 'reimburse'
}

export function refreshRecords() {
  const ledger = deps.getLedger()
  const records = ledger ? ledger.records || [] : []
  $('#records-empty').classList.toggle('hidden', records.length > 0 || !ledger)
  $('#records-ui').classList.toggle('hidden', records.length === 0 || !ledger)
  if (!ledger || !records.length) return
  rebuildCategoryOptions()
  applyFilter()
}

function rebuildCategoryOptions() {
  const cats = uniqueCategories(deps.getLedger()?.records || [])
  const sel = $('#flt-cat')
  const keep = sel.value
  sel.innerHTML = '<option value="all">全部分类</option>' +
    cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')
  if ([...sel.options].some((o) => o.value === keep)) sel.value = keep
}

function applyFilter() {
  rebuildCategoryOptions() // 每次应用筛选都重建，杜绝任何时序导致的空选项
  const ledger = deps.getLedger()
  view.filtered = filterRecords(ledger ? ledger.records || [] : [], {
    type: $('#flt-type').value,
    category: $('#flt-cat').value,
    keyword: $('#flt-kw').value,
    sort: $('#flt-sort').value
  })
  view.page = 1
  renderPage()
}

// ------------------------------ 行内单元格 ----------------------------------

function badgeCell(r) {
  switch (r.flag) {
    case 'refund': return '<span class="type-badge tb-refund">退款</span>'
    case 'advance': return '<span class="type-badge tb-advance">代垫</span>'
    case 'reimburse': return '<span class="type-badge tb-reimb">报销</span>'
    default:
      return r.type === 'income'
        ? '<span class="type-badge tb-in">收入</span>'
        : '<span class="type-badge tb-ex">支出</span>'
  }
}

function amountCell(r) {
  const amt = Number(r.amount).toFixed(2)
  if (r.flag === 'refund') return `<td class="num refund"><b>+¥${amt}</b></td>`
  if (r.flag === 'advance') return `<td class="num expense"><b>-¥${amt}</b></td>`
  if (r.flag === 'reimburse') return `<td class="num income"><b>+¥${amt}</b></td>`
  const isIn = r.type === 'income'
  return `<td class="num ${isIn ? 'income' : 'expense'}"><b>${isIn ? '+' : '-'}¥${amt}</b></td>`
}

function actionsCell(r, allRecords) {
  let extra = ''
  if (r.flag === 'advance') {
    if (advanceStatus(allRecords, r.id) === 'pending')
      extra = '<button class="btn btn-sm act-reimburse">报销</button>'
  } else if (!r.flag && r.type === 'expense') {
    extra = '<button class="btn btn-sm act-refund">退款</button>'
  }
  return `<td class="row-actions">
    <button class="btn btn-sm act-edit">编辑</button>${extra}
    <button class="btn btn-sm act-del">删除</button>
  </td>`
}

function renderPage() {
  const { slice, from, to, page, pages } = paginate(view.filtered, view.page)
  const tbody = $('#records-tbody')
  const ledger = deps.getLedger()
  const accounts = ledger?.accounts || []
  const allRecords = ledger?.records || []
  const acctName = (id) => { const a = accounts.find((x) => x.id === id); return a ? a.name : '' }
  if (!slice.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="muted" style="text-align:center;padding:16px">没有符合筛选条件的流水</td></tr>'
  } else {
    tbody.innerHTML = slice.map((r, i) => {
      const acct = esc(acctName(r.accountId))
      const note = esc(r.note)
      let statusTag = ''
      if (r.flag === 'advance') {
        const done = advanceStatus(allRecords, r.id) === 'done'
        statusTag = `<span class="flag-tag ${done ? 'tag-done' : 'tag-pending'}">${done ? '已报销' : '待报销'}</span>`
      }
      const noteCell = statusTag
        ? `${note}${note ? ' ' : ''}${statusTag}`
        : (note || '<span class="muted">—</span>')
      const t = timeLabel(r)
      const seq = (page - 1) * PAGE_SIZE + i + 1
      return `
      <tr data-id="${esc(r.id)}">
        <td class="col-idx">${seq}</td>
        <td class="cell-date"><div class="cd-date">${esc(r.date)}</div>${t ? `<div class="cd-time">${t}</div>` : ''}</td>
        <td>${badgeCell(r)}</td>
        <td>${catCell(r.category)}</td>
        <td class="cell-acct">${acct || '<span class="muted">—</span>'}</td>
        ${amountCell(r)}
        <td class="cell-note">${noteCell}</td>
        <td class="muted cell-src">${esc(sourceLabel(r.source))}</td>
        ${actionsCell(r, allRecords)}
      </tr>`
    }).join('')
    tbody.querySelectorAll('tr').forEach((tr) => {
      const id = tr.dataset.id
      tr.querySelector('.act-edit').addEventListener('click', () => openForm(findById(id)))
      tr.querySelector('.act-del').addEventListener('click', () => removeRecord(id))
      tr.querySelector('.act-refund')?.addEventListener('click', () => openRefund(findById(id)))
      tr.querySelector('.act-reimburse')?.addEventListener('click', () => openReimburse(findById(id)))
    })
  }
  $('#rec-stat').textContent =
    `共 ${allRecords.length} 条 · 筛选出 ${view.filtered.length} 条 · 显示第 ${from}-${to} 条`
  $('#pg-info').textContent = `第 ${page} / ${pages} 页`
  $('#pg-prev').disabled = page <= 1
  $('#pg-next').disabled = page >= pages
}

function findById(id) {
  return (deps.getLedger()?.records || []).find((r) => r.id === id) || null
}

// ------------------------------ 表单弹窗 ------------------------------------

function openForm(record) {
  view.formMode = 'normal'
  view.ctx = null
  view.editingId = record ? record.id : null
  $('#form-title').textContent = record ? '编辑流水' : '补录流水'
  $('#form-date').value = record?.date || todayStr()
  setFormType(record?.type || 'expense')
  $('#form-amount').value = record ? String(record.amount) : ''
  $('#form-category').value = record?.category || ''
  $('#form-note').value = record?.note || ''
  $('#form-advance').checked = record?.flag === 'advance'
  $('#form-error').textContent = ''
  fillFormAccount(record)
  renderCategoryChips()
  setFormFieldsForMode()
  $('#form-mask').classList.remove('hidden')
  $('#form-amount').focus()
}

/** 退款登记：对一笔支出登记退款冲正 */
function openRefund(original) {
  if (!original) return
  view.formMode = 'refund'
  view.ctx = original
  view.editingId = null
  $('#form-title').textContent = '登记退款（冲正原消费）'
  $('#form-date').value = todayStr()
  $('#form-amount').value = String(original.amount)
  $('#form-category').value = original.category || ''
  $('#form-note').value = ''
  $('#form-advance').checked = false
  $('#form-error').textContent = ''
  fillFormAccount(original)
  setFormFieldsForMode()
  $('#form-mask').classList.remove('hidden')
  $('#form-amount').focus()
  $('#form-amount').select()
}

/** 报销登记：对一条代垫登记报销收回 */
function openReimburse(advance) {
  if (!advance) return
  view.formMode = 'reimburse'
  view.ctx = advance
  view.editingId = null
  $('#form-title').textContent = '登记报销（收回代垫）'
  $('#form-date').value = todayStr()
  $('#form-amount').value = String(advance.amount)
  $('#form-category').value = '报销'
  $('#form-note').value = ''
  $('#form-advance').checked = false
  $('#form-error').textContent = ''
  fillFormAccount(advance)
  setFormFieldsForMode()
  $('#form-mask').classList.remove('hidden')
  $('#form-amount').focus()
  $('#form-amount').select()
}

function fillFormAccount(record) {
  const sel = $('#form-account')
  const accounts = deps.getLedger()?.accounts || []
  sel.innerHTML = '<option value="">不关联账户</option>' +
    accounts.filter((a) => !a.archived)
      .map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')
  sel.value = record?.accountId || ''
}

// ------------------------- 分类芯片（自绘，替代原生 datalist） ----------------

function currentCategoryPool() {
  const inLedger = deps.getLedger() ? uniqueCategories(deps.getLedger().records || []) : []
  return [...new Set([...inLedger, ...DEFAULT_CATS])]
}

function renderCategoryChips() {
  const box = $('#cat-chips')
  box.innerHTML = ''
  for (const cat of currentCategoryPool()) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'cat-chip'
    chip.textContent = cat
    chip.addEventListener('click', () => {
      $('#form-category').value = cat
      syncChipActive()
    })
    box.appendChild(chip)
  }
  syncChipActive()
}

function syncChipActive() {
  const cur = $('#form-category').value.trim()
  document.querySelectorAll('#cat-chips .cat-chip')
    .forEach((c) => c.classList.toggle('active', c.textContent === cur))
}

function closeForm() {
  $('#form-mask').classList.add('hidden')
  view.formMode = 'normal'
  view.ctx = null
}

async function submitForm() {
  const err = $('#form-error')
  const date = $('#form-date').value
  const amount = parseFloat($('#form-amount').value)
  const categoryRaw = $('#form-category').value.trim()
  const note = $('#form-note').value.trim()
  const accountId = $('#form-account').value || ''
  if (!date) { err.textContent = '请选择日期'; return }
  if (!Number.isFinite(amount) || amount <= 0) { err.textContent = '金额必须为大于 0 的数字'; return }

  const ledger = deps.getLedger()
  if (!ledger) { err.textContent = '请先选择账本'; return }
  const ledgerId = ledger.id
  const records = [...(ledger.records || [])]
  let oldRec = null
  let createdId = null
  let undoLabel = '已添加一条流水'
  try {
    if (view.formMode === 'refund') {
      const rec = makeRefund(view.ctx, { date, amount, note, accountId })
      records.push(rec); createdId = rec.id; undoLabel = '已登记退款'
    } else if (view.formMode === 'reimburse') {
      const rec = makeReimburse(view.ctx, { date, amount, note, accountId })
      records.push(rec); createdId = rec.id; undoLabel = '已登记报销'
    } else if (view.editingId) {
      const idx = records.findIndex((r) => r.id === view.editingId)
      if (idx < 0) { err.textContent = '目标记录已不存在'; return }
      oldRec = { ...records[idx] }
      const updated = {
        ...records[idx],
        date,
        type: view.formType,
        amount: round2(amount),
        category: categoryRaw || '未分类',
        note,
        accountId
      }
      // 仅普通 / 代垫记录在此调整 advance 标记；退款、报销保留原 flag/linkId
      if (updated.flag !== 'refund' && updated.flag !== 'reimburse') {
        if ($('#form-advance').checked) {
          updated.flag = 'advance'
          if (!categoryRaw) updated.category = '代垫'
        } else if (updated.flag === 'advance') {
          delete updated.flag
        }
      }
      records[idx] = updated
    } else {
      let created
      if ($('#form-advance').checked && view.formType === 'expense') {
        created = makeAdvance({ date, amount, accountId, note, category: categoryRaw || '代垫' })
        undoLabel = '已登记代垫'
      } else {
        created = {
          id: newRecId(),
          date, type: view.formType, amount: round2(amount),
          category: categoryRaw || '未分类', note, accountId, source: '手动',
          createdAt: new Date().toISOString()
        }
      }
      records.push(created)
      createdId = created.id
    }
    await deps.save(records)
    closeForm()
    if (oldRec) {
      pushUndo('已保存修改', async () => {
        const full = await window.ledgerAPI.get(ledgerId)
        await window.ledgerAPI.saveRecords(ledgerId, withRecordReverted(full.records || [], oldRec), full.batches || [])
      })
    } else {
      pushUndo(undoLabel, async () => {
        const full = await window.ledgerAPI.get(ledgerId)
        await window.ledgerAPI.saveRecords(ledgerId, withoutRecord(full.records || [], createdId), full.batches || [])
      })
    }
  } catch (e) {
    err.textContent = '保存失败：' + e.message
  }
}

async function removeRecord(id) {
  const r = findById(id)
  if (!r) return
  const flagLabel = r.flag === 'refund' ? '退款' : r.flag === 'advance' ? '代垫' : r.flag === 'reimburse' ? '报销' : r.type === 'income' ? '收入' : '支出'
  const ok = await askConfirm(
    '删除流水',
    `${r.date} ${flagLabel} ¥${r.amount}${r.note ? ' ' + r.note : ''}`,
    '删除'
  )
  if (!ok) return
  const ledger = deps.getLedger()
  const ledgerId = ledger.id
  const removed = { ...r }
  await deps.save((ledger.records || []).filter((x) => x.id !== id))
  pushUndo('已删除一条流水', async () => {
    const full = await window.ledgerAPI.get(ledgerId)
    await window.ledgerAPI.saveRecords(ledgerId, withRecordRestored(full.records || [], removed), full.batches || [])
  })
}

function round2(n) { return Math.round(n * 100) / 100 }

/** 记录登记时刻的本地 HH:mm（无 createdAt 或非法时返回空；导入的历史数据不显示） */
function timeLabel(r) {
  if (!r.createdAt) return ''
  const d = new Date(r.createdAt)
  if (Number.isNaN(d.getTime())) return ''
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}
function sourceLabel(s) {
  return !s || s === '手动' ? '手动' : s === 'demo' ? '演示' : String(s).startsWith('imp-') ? 'Excel 导入' : String(s)
}
