'use strict'

// ---------------------------------------------------------------------------
// budget-ui.mjs —— 预算编辑弹窗（每月总预算 + 分类预算），从 app.js 抽离。
// 数据保存在 profile（authAPI.updateProfile）。
// 依赖 index.html 中的 #budget-edit-mask 结构。
// ---------------------------------------------------------------------------

import { showToast, bindModalEsc } from './ui/dialog.mjs'

const $ = (s) => document.querySelector(s)

const COMMON_BUDGET_CATS = ['餐饮', '交通', '购物', '居家', '娱乐', '医疗', '教育', '人情']

let getCurrentProfile = () => null
let setCurrentProfile = () => {}
let getLedgerRecords = () => []
let renderMain = () => {}

export function initBudgetUI(deps) {
  getCurrentProfile = deps.getCurrentProfile
  setCurrentProfile = deps.setCurrentProfile
  getLedgerRecords = deps.getLedgerRecords
  renderMain = deps.renderMain
}

export async function openBudgetEditor() {
  if (!getCurrentProfile()) {
    try {
      setCurrentProfile(await window.authAPI.getProfile())
    } catch (e) {
      showToast('读取资料失败：' + e.message, 'error')
      return
    }
  }
  const p = getCurrentProfile().profile || {}
  $('#be-total').value = p.monthlyBudget ? p.monthlyBudget : ''
  $('#be-error').textContent = ''
  const rows = $('#be-rows')
  rows.innerHTML = ''
  for (const [name, amt] of Object.entries(p.categoryBudgets || {})) addBudgetRow(name, amt)
  renderQuickCats()
  $('#budget-edit-mask').classList.remove('hidden')
  $('#be-total').focus()
}

function addBudgetRow(name = '', amt = '') {
  const row = document.createElement('div')
  row.className = 'be-row'
  row.innerHTML = `
    <input type="text" class="be-cat-name" maxlength="10" placeholder="分类名" />
    <input type="number" class="be-cat-amt" min="0" step="50" placeholder="月限额" />
    <button type="button" class="be-row-del" aria-label="删除">✕</button>`
  row.querySelector('.be-cat-name').value = name
  row.querySelector('.be-cat-amt').value = amt
  row.querySelector('.be-row-del').onclick = () => row.remove()
  $('#be-rows').appendChild(row)
}

function renderQuickCats() {
  const box = $('#be-quick')
  box.innerHTML = ''
  const cats = new Set(COMMON_BUDGET_CATS)
  for (const r of getLedgerRecords()) {
    if (r.type === 'expense' && r.category) cats.add(r.category)
  }
  for (const c of [...cats].slice(0, 12)) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'be-quick-chip'
    chip.textContent = c
    chip.onclick = () => {
      const names = [...document.querySelectorAll('#be-rows .be-cat-name')]
      if (names.some((i) => i.value.trim() === c)) return
      addBudgetRow(c, '')
      $('#be-rows').lastElementChild.querySelector('.be-cat-amt').focus()
    }
    box.appendChild(chip)
  }
}

$('#be-add').addEventListener('click', () => addBudgetRow())
$('#be-cancel').addEventListener('click', () => $('#budget-edit-mask').classList.add('hidden'))
$('#budget-edit-mask').addEventListener('click', (e) => {
  if (e.target === $('#budget-edit-mask')) $('#budget-edit-mask').classList.add('hidden')
})
bindModalEsc($('#budget-edit-mask'), () => $('#budget-edit-mask').classList.add('hidden'))

$('#be-save').addEventListener('click', async () => {
  const errEl = $('#be-error')
  errEl.textContent = ''
  const total = Number($('#be-total').value) || 0
  const catBudgets = {}
  let bad = false
  for (const row of document.querySelectorAll('#be-rows .be-row')) {
    const name = row.querySelector('.be-cat-name').value.trim()
    const amt = Number(row.querySelector('.be-cat-amt').value)
    if (!name) continue
    if (!Number.isFinite(amt) || amt <= 0) { bad = true; row.querySelector('.be-cat-amt').focus(); continue }
    catBudgets[name] = amt
  }
  if (bad) { errEl.textContent = '分类限额需为大于 0 的数字'; return }
  try {
    const base = getCurrentProfile()?.profile || {}
    const profile = await window.authAPI.updateProfile({
      ...base, monthlyBudget: total, categoryBudgets: catBudgets
    })
    const cp = getCurrentProfile()
    if (cp) cp.profile = profile
    $('#budget-edit-mask').classList.add('hidden')
    renderMain()
  } catch (e) {
    errEl.textContent = e.message || String(e)
  }
})
