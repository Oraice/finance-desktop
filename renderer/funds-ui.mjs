'use strict'

// ---------------------------------------------------------------------------
// funds-ui.mjs —— 资金账户与转账界面：净资产总览、资产/负债账户卡片、
// 新建/编辑账户、转账/还款、转账记录。从 app.js 接线。
// ---------------------------------------------------------------------------

import { askConfirm, showToastWithAction, bindModalEsc } from './ui/dialog.mjs'
import { emptyState, showEmpty } from './ui/empty.mjs'
import { fmtMoney, isoLocal, esc } from './lib/util.mjs'
import { pushUndo } from './lib/undo.mjs'
import { toCashRecords } from './lib/record-flags.mjs'
import { openReconcile } from './reconcile-ui.mjs'
import {
  accountBalances,
  netWorth,
  normalizeAccount,
  validateTransfer,
  assertTransferAffordable,
  withAccountRestored,
  withoutAccount,
  withAccountReverted,
  withoutTransfer,
  withTransferRestored,
  ACCOUNT_TYPES,
  isLiabilityType
} from './charts/funds.mjs'

const $ = (s) => document.querySelector(s)

const newFundId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
const typeMeta = (t) => ACCOUNT_TYPES.find((x) => x.value === t) || { icon: '📁', label: t }

let getLedger = () => null
let afterChange = async () => {}

export function initFundsUI(deps) {
  getLedger = deps.getLedger
  afterChange = deps.afterChange
  wire()
}

function data() {
  const l = getLedger()
  const accounts = l?.accounts || []
  const records = l?.records || []
  const transfers = l?.transfers || []
  return { l, accounts, records, transfers, balances: accountBalances(accounts, toCashRecords(records), transfers) }
}

async function persist(accounts, transfers) {
  const l = getLedger()
  await window.ledgerAPI.saveFunds(l.id, accounts, transfers)
  await afterChange()
}

// ------------------------------ 主渲染 -------------------------------------

export function renderFunds() {
  const { l, balances, transfers } = data()
  if (!l) return
  const w = netWorth(balances)
  $('#nw-assets').textContent = fmtMoney(w.assets)
  $('#nw-debts').textContent = fmtMoney(w.debts)
  $('#nw-net').textContent = fmtMoney(w.net)
  $('#funds-hint').textContent = balances.length ? `共 ${balances.length} 个账户` : ''

  renderAccountGrid($('#asset-grid'), balances.filter((a) => !isLiabilityType(a.type)), false)
  renderAccountGrid($('#liability-grid'), balances.filter((a) => isLiabilityType(a.type)), true)
  renderTransfers(balances, transfers)
}

function renderAccountGrid(box, list, isLiab) {
  if (!list.length) {
    showEmpty(box, {
      icon: isLiab ? '💳' : '💼',
      title: isLiab ? '还没有信用卡 / 负债' : '还没有资产账户',
      desc: isLiab ? '添加信用卡或借贷账户，可管理额度、账单日与还款' : '添加现金、储蓄卡或电子钱包，掌握每笔钱的去向',
      action: { text: '＋ 新建账户', onClick: () => openAccountEditor(null) },
      compact: true
    })
    return
  }
  box.innerHTML = ''
  for (const a of list) {
    const main = isLiab ? a.debt : a.balance
    let extra = ''
    if (a.type === 'credit') {
      extra = `
        <div class="fund-sub">可用 ${esc(fmtMoney(a.available))} · 额度 ${esc(fmtMoney(a.creditLimit))}</div>
        <div class="fund-sub">账单日 ${a.statementDay} · 还款日 ${a.dueDay}</div>`
    }
    const card = document.createElement('div')
    card.className = 'fund-card' + (isLiab ? ' is-liab' : '')
    card.innerHTML = `
      <div class="fund-top">
        <span class="fund-ic">${a.icon || typeMeta(a.type).icon}</span>
        <div class="fund-meta">
          <div class="fund-name">${esc(a.name)}</div>
          <div class="fund-type">${typeMeta(a.type).label}</div>
        </div>
      </div>
      <div class="fund-amount ${isLiab ? 'expense' : 'income'}">${isLiab ? '欠款 ' : ''}${esc(fmtMoney(main))}</div>
      ${extra}
      <div class="fund-card-actions">
        <button class="btn btn-sm" data-act="reconcile">对账</button>
        <button class="btn btn-sm" data-act="edit">编辑</button>
        <button class="btn btn-sm btn-danger" data-act="del">删除</button>
      </div>`
    card.querySelector('.fund-card-actions').onclick = (e) => {
      const btn = e.target.closest('button')
      if (!btn) return
      if (btn.dataset.act === 'reconcile') openReconcile(a.id)
      else if (btn.dataset.act === 'edit') openAccountEditor(a.id)
      else removeAccount(a)
    }
    box.appendChild(card)
  }
}

function renderTransfers(balances, transfers) {
  const tbody = $('#transfer-tbody')
  const nameById = new Map(balances.map((a) => [a.id, a.name]))
  if (!transfers.length) {
    tbody.innerHTML = ''
    const td = document.createElement('td')
    td.colSpan = 6
    td.style.padding = '0'
    td.appendChild(emptyState({
      icon: '🔁', title: '暂无转账 / 还款记录',
      desc: '账户间转账、信用卡还款都会显示在这里', compact: true
    }))
    const tr = document.createElement('tr')
    tr.appendChild(td)
    tbody.appendChild(tr)
    return
  }
  tbody.innerHTML = ''
  for (const t of [...transfers].sort((a, b) => (a.date < b.date ? 1 : -1))) {
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td>${t.date}</td>
      <td>${esc(nameById.get(t.fromId) || '已删除账户')}</td>
      <td>${esc(nameById.get(t.toId) || '已删除账户')}</td>
      <td class="expense">${esc(fmtMoney(t.amount))}</td>
      <td>${esc(t.note || '')}</td>
      <td><button class="btn btn-sm btn-danger">删除</button></td>`
    tr.querySelector('button').onclick = () => removeTransfer(t.id)
    tbody.appendChild(tr)
  }
}

// ---------------------------- 账户 新建/编辑 --------------------------------

let editingId = null

function openAccountEditor(id = null) {
  editingId = id
  const mask = $('#account-edit-mask')
  $('#acct-edit-error').textContent = ''
  $('#acct-name').value = ''
  $('#acct-opening').value = 0
  $('#acct-limit').value = ''
  $('#acct-statement').value = ''
  $('#acct-due').value = ''

  if (id) {
    const a = data().balances.find((x) => x.id === id)
    $('#acct-edit-title').textContent = '编辑账户'
    $('#acct-type').value = a.type
    $('#acct-name').value = a.name
    $('#acct-opening').value = a.openingBalance
    if (a.type === 'credit') {
      $('#acct-limit').value = a.creditLimit
      $('#acct-statement').value = a.statementDay
      $('#acct-due').value = a.dueDay
    }
  } else {
    $('#acct-edit-title').textContent = '新建账户'
    $('#acct-type').value = 'cash'
  }
  toggleCcFields()
  mask.classList.remove('hidden')
  $('#acct-name').focus()
}

function toggleCcFields() {
  const isCc = $('#acct-type').value === 'credit'
  $('#cc-fields').classList.toggle('hidden', !isCc)
  // 只改文字 span；切勿直接对 label 设 textContent，否则会连带删掉内部的 #acct-opening 输入框
  $('#acct-opening-text').textContent = isCc ? '当前欠款（元，选填）' : '初始金额（元）'
}

async function saveAccountFromForm() {
  const err = $('#acct-edit-error')
  err.textContent = ''
  try {
    const norm = normalizeAccount({
      type: $('#acct-type').value,
      name: $('#acct-name').value,
      openingBalance: $('#acct-opening').value,
      creditLimit: $('#acct-limit').value,
      statementDay: $('#acct-statement').value,
      dueDay: $('#acct-due').value
    })
    const { accounts, transfers } = data()
    const ledgerId = getLedger().id
    let oldAcct = null
    let created = null
    if (editingId) {
      const idx = accounts.findIndex((a) => a.id === editingId)
      oldAcct = { ...accounts[idx] }
      accounts[idx] = { ...accounts[idx], ...norm }
    } else {
      created = { id: newFundId(), ...norm }
      accounts.push(created)
    }
    $('#account-edit-mask').classList.add('hidden')
    await persist(accounts, transfers)
    if (oldAcct) {
      pushUndo('已保存账户修改', async () => {
        const full = await window.ledgerAPI.get(ledgerId)
        await window.ledgerAPI.saveFunds(ledgerId, withAccountReverted(full.accounts || [], oldAcct), full.transfers || [])
      })
    } else {
      pushUndo('已添加账户', async () => {
        const full = await window.ledgerAPI.get(ledgerId)
        await window.ledgerAPI.saveFunds(ledgerId, withoutAccount(full.accounts || [], created.id), full.transfers || [])
      })
    }
  } catch (e) {
    err.textContent = e.message || String(e)
  }
}

async function removeAccount(a) {
  const { records, transfers, accounts } = data()
  const used = records.some((r) => r.accountId === a.id)
    || transfers.some((t) => t.fromId === a.id || t.toId === a.id)
  const ok = await askConfirm(
    '删除账户',
    used
      ? `账户「${a.name}」已有流水或转账记录，删除后这些记录仍保留但不再显示该账户，确定删除？`
      : `确定删除账户「${a.name}」吗？`,
    '删除'
  )
  if (!ok) return
  const ledgerId = getLedger().id
  const removed = { ...(accounts.find((x) => x.id === a.id) || a) }
  await persist(accounts.filter((x) => x.id !== a.id), data().transfers)
  pushUndo('已删除账户', async () => {
    const full = await window.ledgerAPI.get(ledgerId)
    await window.ledgerAPI.saveFunds(ledgerId, withAccountRestored(full.accounts || [], removed), full.transfers || [])
  })
}

// ------------------------------ 转账 ---------------------------------------

function openTransfer() {
  const { balances } = data()
  if (balances.length < 2) {
    showToastWithAction('至少需要两个账户才能转账', {
      actionText: '新建账户', type: 'warn', onAction: () => openAccountEditor(null)
    })
    return
  }
  const mask = $('#transfer-mask')
  $('#tr-error').textContent = ''
  fillAccountSelect($('#tr-from'), balances)
  fillAccountSelect($('#tr-to'), balances)
  if ($('#tr-to').options[1]) $('#tr-to').selectedIndex = 1
  $('#tr-amount').value = ''
  $('#tr-note').value = ''
  $('#tr-date').value = isoLocal(new Date())
  mask.classList.remove('hidden')
  $('#tr-amount').focus()
}

function fillAccountSelect(sel, balances) {
  sel.innerHTML = balances
    .map((a) => `<option value="${a.id}">${esc(a.name)}（${typeMeta(a.type).label}）</option>`)
    .join('')
  sel.selectedIndex = 0
}

async function confirmTransfer() {
  const err = $('#tr-error')
  err.textContent = ''
  try {
    const { accounts, transfers, balances } = data()
    const t = validateTransfer({
      fromId: $('#tr-from').value,
      toId: $('#tr-to').value,
      amount: $('#tr-amount').value,
      date: $('#tr-date').value,
      note: $('#tr-note').value
    }, accounts)
    assertTransferAffordable(t, balances)
    const created = { id: newFundId(), source: 'manual', ...t }
    transfers.push(created)
    const ledgerId = getLedger().id
    $('#transfer-mask').classList.add('hidden')
    await persist(accounts, transfers)
    pushUndo('已完成转账', async () => {
      const full = await window.ledgerAPI.get(ledgerId)
      await window.ledgerAPI.saveFunds(full.accounts || [], withoutTransfer(full.transfers || [], created.id))
    })
  } catch (e) {
    err.textContent = e.message || String(e)
  }
}

async function removeTransfer(id) {
  const ok = await askConfirm('删除转账', '删除后各账户余额将相应回退，确定删除该记录？', '删除')
  if (!ok) return
  const { accounts, transfers } = data()
  const ledgerId = getLedger().id
  const removed = { ...transfers.find((t) => t.id === id) }
  await persist(accounts, transfers.filter((t) => t.id !== id))
  pushUndo('已删除转账记录', async () => {
    const full = await window.ledgerAPI.get(ledgerId)
    await window.ledgerAPI.saveFunds(full.accounts || [], withTransferRestored(full.transfers || [], removed))
  })
}

// ------------------------------ 接线 ---------------------------------------

function wire() {
  $('#btn-add-account').onclick = () => openAccountEditor(null)
  $('#btn-transfer').onclick = openTransfer
  $('#acct-type').addEventListener('change', toggleCcFields)

  $('#acct-edit-cancel').onclick = () => $('#account-edit-mask').classList.add('hidden')
  $('#acct-edit-ok').onclick = saveAccountFromForm
  $('#account-edit-mask').addEventListener('click', (e) => {
    if (e.target === $('#account-edit-mask')) $('#account-edit-mask').classList.add('hidden')
  })

  $('#tr-cancel').onclick = () => $('#transfer-mask').classList.add('hidden')
  $('#tr-ok').onclick = confirmTransfer
  $('#transfer-mask').addEventListener('click', (e) => {
    if (e.target === $('#transfer-mask')) $('#transfer-mask').classList.add('hidden')
  })

  bindModalEsc($('#account-edit-mask'), () => $('#account-edit-mask').classList.add('hidden'))
  bindModalEsc($('#transfer-mask'), () => $('#transfer-mask').classList.add('hidden'))
}
