'use strict'

// ---------------------------------------------------------------------------
// recurring-ui.mjs —— 周期记账：模板管理（新建/编辑/停用/删除）+
// 打开账本时的到期检查与确认入账。从 app.js 接线。
// ---------------------------------------------------------------------------

import { askConfirm, bindModalEsc } from './ui/dialog.mjs'
import { fmtMoney, isoLocal, esc } from './lib/util.mjs'
import { pushUndo } from './lib/undo.mjs'
import { normalizeRecurring, dueDates, FREQUENCIES } from './charts/recurring.mjs'

const $ = (s) => document.querySelector(s)
const newId = () => 'rec-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
const freqUnit = (f) => (f === 'daily' ? '天' : f === 'weekly' ? '周' : f === 'monthly' ? '月' : '年')

let getLedger = () => null
let afterChange = async () => {}

export function initRecurringUI(deps) {
  getLedger = deps.getLedger
  afterChange = deps.afterChange
  wire()
}

const templates = () => getLedger()?.recurring || []

async function persist(list) {
  const l = getLedger()
  await window.ledgerAPI.saveRecurring(l.id, list)
  await afterChange()
}

function fillAccountOptions() {
  const accounts = getLedger()?.accounts || []
  $('#re-account').innerHTML = '<option value="">不关联账户</option>' +
    accounts.filter((a) => !a.archived)
      .map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')
}

// ------------------------------ 管理列表 -----------------------------------

function renderList() {
  const box = $('#recurring-list-body')
  const list = templates()
  if (!list.length) {
    box.innerHTML = '<div class="crash-empty">还没有周期账单，点下方按钮新建</div>'
    return
  }
  box.innerHTML = ''
  for (const t of list) {
    const fLabel = FREQUENCIES.find((f) => f.value === t.frequency)?.label || t.frequency
    const freqText = t.interval === 1 ? fLabel : `每 ${t.interval} ${freqUnit(t.frequency)}`
    const row = document.createElement('div')
    row.className = 'recurring-row' + (t.active ? '' : ' is-off')
    row.innerHTML = `
      <div class="rr-main">
        <span class="rr-ic">${t.type === 'income' ? '💰' : '🧾'}</span>
        <div class="rr-meta">
          <div class="rr-title">${esc(t.category)} · ${esc(fmtMoney(t.amount))}${t.active ? '' : ' <span class="rr-off-tag">已停用</span>'}</div>
          <div class="rr-sub">${esc(freqText)} · 开始 ${t.startDate}${t.endDate ? ' · 结束 ' + t.endDate : ''}</div>
        </div>
      </div>
      <div class="rr-actions">
        <button type="button" class="btn btn-sm" data-act="toggle">${t.active ? '停用' : '启用'}</button>
        <button type="button" class="btn btn-sm" data-act="edit">编辑</button>
        <button type="button" class="btn btn-sm btn-danger" data-act="del">删除</button>
      </div>`
    row.querySelector('.rr-actions').onclick = (e) => {
      const b = e.target.closest('button')
      if (!b) return
      if (b.dataset.act === 'edit') openEditor(t.id)
      else if (b.dataset.act === 'toggle') toggle(t.id)
      else remove(t.id)
    }
    box.appendChild(row)
  }
}

export function openList() {
  renderList()
  $('#recurring-list-mask').classList.remove('hidden')
}
const closeList = () => $('#recurring-list-mask').classList.add('hidden')

// ------------------------------ 编辑模板 -----------------------------------

let editingId = null
let editType = 'expense'

function openEditor(id = null) {
  editingId = id
  $('#re-error').textContent = ''
  fillAccountOptions()
  if (id) {
    const t = templates().find((x) => x.id === id)
    $('#re-title').textContent = '编辑周期账单'
    setEditType(t.type)
    $('#re-amount').value = t.amount
    $('#re-category').value = t.category
    $('#re-frequency').value = t.frequency
    $('#re-interval').value = t.interval
    $('#re-account').value = t.accountId || ''
    $('#re-start').value = t.startDate
    $('#re-end').value = t.endDate || ''
    $('#re-note').value = t.note
  } else {
    $('#re-title').textContent = '新建周期账单'
    setEditType('expense')
    $('#re-amount').value = ''
    $('#re-category').value = ''
    $('#re-frequency').value = 'monthly'
    $('#re-interval').value = 1
    $('#re-account').value = ''
    $('#re-start').value = isoLocal(new Date())
    $('#re-end').value = ''
    $('#re-note').value = ''
  }
  $('#recurring-list-mask').classList.add('hidden')
  $('#recurring-edit-mask').classList.remove('hidden')
  $('#re-amount').focus()
}

function setEditType(t) {
  editType = t === 'income' ? 'income' : 'expense'
  document.querySelectorAll('#re-type-seg .seg-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.type === editType))
}

async function saveFromForm() {
  const err = $('#re-error')
  err.textContent = ''
  try {
    const norm = normalizeRecurring({
      type: editType,
      amount: $('#re-amount').value,
      category: $('#re-category').value,
      frequency: $('#re-frequency').value,
      interval: $('#re-interval').value,
      accountId: $('#re-account').value,
      startDate: $('#re-start').value,
      endDate: $('#re-end').value,
      note: $('#re-note').value
    })
    const list = [...templates()]
    let old = null
    let created = null
    if (editingId) {
      const i = list.findIndex((x) => x.id === editingId)
      old = { ...list[i] }
      list[i] = { ...list[i], ...norm, lastRunDate: list[i].lastRunDate }
    } else {
      created = { id: newId(), ...norm }
      list.push(created)
    }
    $('#recurring-edit-mask').classList.add('hidden')
    await persist(list)
    openList()
    const ledgerId = getLedger().id
    if (old) {
      pushUndo('已保存周期账单修改', async () => {
        const full = await window.ledgerAPI.get(ledgerId)
        const rl = [...(full.recurring || [])]
        const i = rl.findIndex((x) => x.id === editingId)
        rl[i] = old
        await window.ledgerAPI.saveRecurring(ledgerId, rl)
      })
    } else {
      pushUndo('已添加周期账单', async () => {
        const full = await window.ledgerAPI.get(ledgerId)
        await window.ledgerAPI.saveRecurring(ledgerId,
          (full.recurring || []).filter((x) => x.id !== created.id))
      })
    }
  } catch (e) {
    err.textContent = e.message || String(e)
  }
}

async function toggle(id) {
  await persist(templates().map((t) => (t.id === id ? { ...t, active: !t.active } : t)))
  renderList()
}

async function remove(id) {
  const t = templates().find((x) => x.id === id)
  const ok = await askConfirm(
    '删除周期账单',
    `确定删除「${t.category} ${fmtMoney(t.amount)}」吗？已入账的历史流水不会被删除。`,
    '删除'
  )
  if (!ok) return
  const removed = { ...t }
  await persist(templates().filter((x) => x.id !== id))
  renderList()
  pushUndo('已删除周期账单', async () => {
    const full = await window.ledgerAPI.get(getLedger().id)
    await window.ledgerAPI.saveRecurring(full.id, [...(full.recurring || []), removed])
  })
}

// --------------------------- 到期检查 / 入账 -------------------------------

// 用户在本次运行中“暂不入账”的到期组签名，避免同一未处理账单反复弹窗
const skippedSignatures = new Set()
let currentSignature = ''
let pendingGroups = []

function signatureOf(l, groups) {
  return l.id + '|' + groups
    .map((g) => g.template.id + ':' + g.dates.join(','))
    .join(';')
}

/** 打开账本后调用：若有到期未入账的周期账单，弹窗让用户确认 */
export async function checkDue() {
  const l = getLedger()
  if (!l) return
  const today = isoLocal(new Date())
  const groups = []
  for (const t of (l.recurring || []).filter((x) => x.active)) {
    const dates = dueDates(t, today)
    if (dates.length) groups.push({ template: t, dates, beforeLastRun: t.lastRunDate })
  }
  if (!groups.length) return
  const sig = signatureOf(l, groups)
  if (skippedSignatures.has(sig)) return
  currentSignature = sig

  const body = $('#recurring-due-body')
  body.innerHTML = ''
  for (const g of groups) {
    const wrap = document.createElement('div')
    wrap.className = 'due-group'
    wrap.innerHTML =
      `<div class="due-group-title">${g.template.type === 'income' ? '收入' : '支出'} · ${g.dates.length} 笔 · ${esc(g.template.category)}</div>` +
      g.dates.map((d) => `
        <div class="due-line">
          <span>${d}</span>
          <span class="${g.template.type === 'income' ? 'income' : 'expense'}">${g.template.type === 'income' ? '+' : '-'}${esc(fmtMoney(g.template.amount))}</span>
        </div>`).join('')
    body.appendChild(wrap)
  }
  pendingGroups = groups
  $('#recurring-due-mask').classList.remove('hidden')
  $('#due-confirm').focus()
}

async function confirmDue() {
  const l = getLedger()
  const ledgerId = l.id
  const full = await window.ledgerAPI.get(ledgerId)
  let records = [...(full.records || [])]
  let recurringList = [...(full.recurring || [])]
  const createdIds = new Set()

  for (const g of pendingGroups) {
    for (const d of g.dates) {
      const rec = {
        id: newId(),
        date: d,
        type: g.template.type,
        category: g.template.category,
        amount: g.template.amount,
        note: g.template.note,
        accountId: g.template.accountId || '',
        source: '周期'
      }
      records.push(rec)
      createdIds.add(rec.id)
    }
    const ti = recurringList.findIndex((x) => x.id === g.template.id)
    recurringList[ti] = {
      ...recurringList[ti],
      lastRunDate: g.dates[g.dates.length - 1]
    }
  }
  records.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  $('#recurring-due-mask').classList.add('hidden')
  await window.ledgerAPI.saveRecords(ledgerId, records, full.batches || [])
  await window.ledgerAPI.saveRecurring(ledgerId, recurringList)
  const beforeMap = new Map(pendingGroups.map((g) => [g.template.id, g.beforeLastRun]))
  const count = createdIds.size
  pushUndo(`已入账 ${count} 笔周期账单`, async () => {
    const f2 = await window.ledgerAPI.get(ledgerId)
    const kept = (f2.records || []).filter((r) => !createdIds.has(r.id))
    await window.ledgerAPI.saveRecords(ledgerId, kept, f2.batches || [])
    const rl2 = (f2.recurring || []).map((t) =>
      beforeMap.has(t.id) ? { ...t, lastRunDate: beforeMap.get(t.id) } : t)
    await window.ledgerAPI.saveRecurring(ledgerId, rl2)
  })
  await afterChange()
}

const skipDue = () => {
  if (currentSignature) skippedSignatures.add(currentSignature)
  $('#recurring-due-mask').classList.add('hidden')
}

// ------------------------------- 接线 --------------------------------------

function wire() {
  $('#btn-recurring').onclick = openList
  $('#recurring-list-close').onclick = closeList
  $('#btn-recurring-add').onclick = () => openEditor(null)
  $('#re-cancel').onclick = () => {
    $('#recurring-edit-mask').classList.add('hidden')
    openList()
  }
  $('#re-save').onclick = saveFromForm
  $('#re-type-seg').addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn')
    if (b) setEditType(b.dataset.type)
  })
  $('#due-confirm').onclick = confirmDue
  $('#due-skip').onclick = skipDue

  bindModalEsc($('#recurring-list-mask'), closeList)
  bindModalEsc($('#recurring-edit-mask'), () => {
    $('#recurring-edit-mask').classList.add('hidden')
    openList()
  })
  bindModalEsc($('#recurring-due-mask'), skipDue)
}
