'use strict'

// ---------------------------------------------------------------------------
// reminders-ui.mjs —— 账单日 / 还款日提醒：事件列表、提醒设置（开关 + 提前
// 天数，存个人资料）、打开账本时自动检查。从 app.js 接线。
// ---------------------------------------------------------------------------

import { bindModalEsc } from './ui/dialog.mjs'
import { isoLocal, esc, fmtMoney } from './lib/util.mjs'
import { upcomingCreditEvents, EVENT_LABEL } from './charts/reminders.mjs'
import { accountBalances } from './charts/funds.mjs'

const $ = (s) => document.querySelector(s)

let getLedger = () => null
let getProfile = () => null
let updateProfile = async () => {}

export function initRemindersUI(deps) {
  getLedger = deps.getLedger
  getProfile = deps.getProfile
  updateProfile = deps.updateProfile
  wire()
}

function reminderDays() {
  const v = Number(getProfile()?.profile?.reminderDays)
  return Number.isFinite(v) ? v : 3
}

function renderEvents() {
  const l = getLedger()
  const days = reminderDays()
  const today = isoLocal(new Date())
  const events = l ? upcomingCreditEvents(l.accounts || [], today, days) : []

  const balances = new Map()
  if (l) {
    for (const b of accountBalances(l.accounts || [], l.records || [], l.transfers || [])) {
      balances.set(b.id, b)
    }
  }

  const box = $('#reminders-body')
  if (!l) {
    box.innerHTML = '<div class="crash-empty">请先打开一个账本</div>'
  } else if (!events.length) {
    box.innerHTML = `<div class="crash-empty">未来 ${days} 天内没有账单日 / 还款日</div>`
  } else {
    box.innerHTML = ''
    for (const e of events) {
      const b = balances.get(e.accountId)
      const debt = b ? b.debt : 0
      const row = document.createElement('div')
      row.className = 'reminder-row'
      row.innerHTML = `
        <div class="rmr-main">
          <span class="rmr-ic">${e.kind === 'statement' ? '📋' : '💳'}</span>
          <div class="rmr-meta">
            <div class="rmr-title">${esc(e.accountName)} · ${EVENT_LABEL[e.kind]}</div>
            <div class="rmr-sub">${e.date}${debt ? ' · 当前待还 ' + esc(fmtMoney(debt)) : ''}</div>
          </div>
        </div>
        <span class="rmr-days${e.daysLeft <= 2 ? ' urgent' : ''}">${e.daysLeft === 0 ? '今天' : e.daysLeft + ' 天后'}</span>`
      box.appendChild(row)
    }
  }

  const prof = getProfile()?.profile || {}
  $('#rm-enabled').checked = prof.remindersEnabled !== false
  $('#rm-days').value = days
}

export async function openReminders() {
  renderEvents()
  $('#reminders-mask').classList.remove('hidden')
  $('#reminders-close').focus()
}

/** 打开账本时：仅在启用且确有事件时自动弹出 */
export async function checkReminders() {
  const prof = getProfile()?.profile
  if (!prof || prof.remindersEnabled === false) return
  const l = getLedger()
  if (!l) return
  const events = upcomingCreditEvents(l.accounts || [], isoLocal(new Date()), reminderDays())
  if (events.length) await openReminders()
}

async function saveSettings() {
  const full = getProfile()
  if (!full) return
  const dayVal = parseInt($('#rm-days').value, 10)
  const profile = await updateProfile({
    ...full.profile,
    remindersEnabled: $('#rm-enabled').checked,
    reminderDays: Math.min(30, Math.max(0, Number.isFinite(dayVal) ? dayVal : 0))
  })
  return profile
}

function wire() {
  $('#btn-reminders').onclick = openReminders
  $('#reminders-close').onclick = async () => {
    await saveSettings()
    $('#reminders-mask').classList.add('hidden')
  }
  $('#rm-enabled').addEventListener('change', renderEvents)
  $('#rm-days').addEventListener('change', renderEvents)
  bindModalEsc($('#reminders-mask'), async () => {
    await saveSettings()
    $('#reminders-mask').classList.add('hidden')
  })
}
