'use strict'

// ---------------------------------------------------------------------------
// reconcile-ui.mjs —— 账户对账：输入实际盘点值、实时差额，可“记一笔对账调整”
// （自动生成带账户的收支流水，支持撤销）或“仅标记已对账”，并保留对账历史。
// ---------------------------------------------------------------------------

import { bindModalEsc, showToast } from './ui/dialog.mjs'
import { isoLocal, esc, fmtMoney } from './lib/util.mjs'
import { accountBalances, isLiabilityType } from './charts/funds.mjs'
import { reconcileDiff, normalizeReconciliation, adjustmentRecord } from './charts/reconcile.mjs'
import { pushUndo } from './lib/undo.mjs'
import { toCashRecords } from './lib/record-flags.mjs'

const $ = (s) => document.querySelector(s)
const newId = () => 'rcn-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

let getLedger = () => null
let afterChange = async () => {}
let current = null // { account }

export function initReconcileUI(deps) {
  getLedger = deps.getLedger
  afterChange = deps.afterChange
  wire()
}

function freshAccount(accountId) {
  const l = getLedger()
  const bals = accountBalances(l.accounts || [], toCashRecords(l.records || []), l.transfers || [])
  return bals.find((a) => a.id === accountId) || null
}

export function openReconcile(accountId) {
  const account = freshAccount(accountId)
  if (!account) { showToast('账户不存在'); return }
  current = { account }
  const isLiab = isLiabilityType(account.type)
  $('#rc-head').innerHTML = `
    <span class="rc-ic">${account.icon || '💼'}</span>
    <div>
      <div class="rc-name">${esc(account.name)}</div>
      <div class="rc-sub">${isLiab ? '核对实际欠款' : '核对实际余额'}</div>
    </div>`
  const dr = reconcileDiff(account, isLiab ? account.debt : account.balance)
  $('#rc-system').textContent = fmtMoney(dr.systemValue)
  $('#rc-actual').value = dr.actualValue
  paintDiff(dr)
  renderHistory(accountId)
  $('#rc-error').textContent = ''
  $('#reconcile-mask').classList.remove('hidden')
  $('#rc-actual').focus()
  $('#rc-actual').select()
}

function paintDiff(dr) {
  const el = $('#rc-diff')
  const sign = dr.diff > 0 ? '+' : dr.diff < 0 ? '-' : ''
  el.textContent = sign + fmtMoney(Math.abs(dr.diff))
  el.className = dr.diff === 0 ? ''
    : dr.diff > 0 ? (dr.isLiab ? 'expense' : 'income')
    : (dr.isLiab ? 'income' : 'expense')
}

function currentDiff() {
  const v = parseFloat($('#rc-actual').value)
  if (!Number.isFinite(v) || v < 0) {
    $('#rc-error').textContent = '请输入正确的实际盘点金额（不小于 0）'
    return null
  }
  $('#rc-error').textContent = ''
  const dr = reconcileDiff(current.account, v)
  dr.date = isoLocal(new Date())
  paintDiff(dr)
  return dr
}

function renderHistory(accountId) {
  const l = getLedger()
  const list = (l.reconciliations || [])
    .filter((r) => r.accountId === accountId)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 5)
  const box = $('#rc-history')
  if (!list.length) {
    box.innerHTML = '<div class="muted rc-no-hist">暂无对账记录</div>'
    return
  }
  box.innerHTML = list.map((r) => {
    const sign = r.diff > 0 ? '+' : r.diff < 0 ? '-' : ''
    return `
    <div class="rc-hist-row">
      <span>${r.date}</span>
      <span>账面 ${fmtMoney(r.systemValue)}</span>
      <span>实际 ${fmtMoney(r.actualValue)}</span>
      <span>差额 ${sign}${fmtMoney(Math.abs(r.diff))}</span>
      <span>${r.adjusted ? '已调整' : '已标记'}</span>
    </div>`
  }).join('')
}

async function finish(adjust) {
  const dr = currentDiff()
  if (!dr) return
  const l = getLedger()
  const today = isoLocal(new Date())

  let rec = null
  if (adjust) {
    rec = adjustmentRecord(current.account, dr)
    if (!rec) {
      $('#rc-error').textContent = '账面值与实际值一致，无需调整；可直接“仅标记已对账”'
      return
    }
    rec.date = today
    rec.id = newId()
  }

  const recon = normalizeReconciliation({
    accountId: current.account.id,
    accountName: current.account.name,
    date: today,
    systemValue: dr.systemValue,
    actualValue: dr.actualValue,
    diff: dr.diff,
    adjusted: !!rec
  })
  const reconId = newId()

  const newRecords = rec ? [...l.records, rec] : l.records
  const newRecons = [...(l.reconciliations || []), { id: reconId, ...recon }]

  if (rec) await window.ledgerAPI.saveRecords(l.id, newRecords, l.batches || [])
  await window.ledgerAPI.saveReconcile(l.id, newRecons)

  pushUndo({
    label: rec ? '对账调整' : '账户对账',
    undo: async () => {
      const cur = getLedger()
      const rr = (cur.records || []).filter((x) => x.id !== (rec && rec.id))
      const cc = (cur.reconciliations || []).filter((x) => x.id !== reconId)
      if (rec) await window.ledgerAPI.saveRecords(cur.id, rr, cur.batches || [])
      await window.ledgerAPI.saveReconcile(cur.id, cc)
      await afterChange()
    }
  })

  $('#reconcile-mask').classList.add('hidden')
  await afterChange()
  showToast(rec ? '已记一笔对账调整' : '已标记对账完成')
}

function wire() {
  $('#rc-actual').addEventListener('input', currentDiff)
  $('#rc-adjust').onclick = () => finish(true)
  $('#rc-mark').onclick = () => finish(false)
  bindModalEsc($('#reconcile-mask'), () => $('#reconcile-mask').classList.add('hidden'))
}
