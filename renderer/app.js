'use strict'

// ---------------------------------------------------------------------------
// 财账簿 · 渲染进程入口（精简版）
// 本文件只负责：全局状态、账本/账本设置、主看板渲染编排、各功能模块接线与启动。
// 弹窗、资料头像、预算编辑、品牌外观、备份恢复均已抽离到独立模块：
//   lib/util.mjs        通用工具（金额/日期/转义/图标/图片裁剪）
//   ui/dialog.mjs       自绘弹窗（askText/askConfirm/showAlert）
//   profile-ui.mjs      个人资料 / 头像菜单 / 图片裁剪
//   budget-ui.mjs       预算编辑
//   settings-ui.mjs     品牌 / 改密 / 外观 / 备份恢复
// 所有数据读写都通过 preload 暴露的白名单 IPC，无网络依赖。
// ---------------------------------------------------------------------------

import { initImportPanel } from './xlsx/import-ui.mjs'
import { filterByRange, renderDashboard, renderTopList, renderBudgetCard, resizeDashboard } from './charts/dashboard.mjs'
import { initRecordsPanel, refreshRecords } from './records-ui.mjs'
import { initExportPanel, updateExportView } from './export-ui.mjs'
import { enhanceSelects } from './ui/select.mjs'
import { initAuth } from './auth-ui.mjs'
import { renderChainCard, renderCalendarHeatmap } from './dash-extras.mjs'
import { initYearPanel } from './year-ui.mjs'
import { initSummaryPanel } from './summary-ui.mjs'
import { initFundsUI, renderFunds } from './funds-ui.mjs'
import { initRecurringUI, checkDue } from './recurring-ui.mjs'
import { initRemindersUI, checkReminders } from './reminders-ui.mjs'
import { initReconcileUI } from './reconcile-ui.mjs'
import { initOnboarding, openOnboarding } from './onboarding-ui.mjs'
import { buildMonthlyReportHTML } from './pdf-report.mjs'
import { fmtMoney, isoLocal, setGlyph, fileToSquare, esc as escapeText } from './lib/util.mjs'
import { askConfirm, showAlert, showToast, bindModalEsc, installNativeOverrides } from './ui/dialog.mjs'
import { renderAccountSidebar, initProfileUI } from './profile-ui.mjs'
import { openBudgetEditor, initBudgetUI } from './budget-ui.mjs'
import { loadBrand, loadAppearance, openChangePassword } from './settings-ui.mjs'
import { setAfterUndo, clearUndo, pushUndo } from './lib/undo.mjs'
import { toPnlRecords } from './lib/record-flags.mjs'

// 启动标记：模块图成功加载即置位，供冒烟断言（依赖模块 404 / 顶层抛错时不会执行到这里）
window.__appBooted = true

const $ = (sel) => document.querySelector(sel)

const state = {
  ledgers: [],      // [{id, name, recordCount, ...}]
  currentId: null,  // 当前打开的账本 id
  ledger: null      // 当前账本完整数据（含 records）
}

// 当前登录账户的资料：{ username, createdAt, profile }，由资料/预算模块共享
let currentProfile = null
const getCurrentProfile = () => currentProfile
const setCurrentProfile = (p) => { currentProfile = p }

async function refreshLedgers() {
  state.ledgers = await window.ledgerAPI.list()
  renderLedgerList()
  // 没有打开中的账本时，自动进入最近使用的一个（列表已按更新时间倒序），
  // 覆盖「刚登录」与「删除当前账本后」两种空状态。
  if (!state.currentId && state.ledgers.length) {
    await openLedger(state.ledgers[0].id)
  }
}

async function openLedger(id) {
  state.currentId = id
  state.ledger = await window.ledgerAPI.get(id)
  renderLedgerList()
  renderMain()
  await checkDue()
  await checkReminders()
}

// ------------------------------ 渲染逻辑 -----------------------------------

function renderLedgerList() {
  const box = $('#ledger-list')
  box.innerHTML = ''
  if (!state.ledgers.length) {
    const empty = document.createElement('div')
    empty.className = 'sidebar-label'
    empty.textContent = '还没有账本，点击上方新建'
    box.appendChild(empty)
    return
  }
  for (const l of state.ledgers) {
    const item = document.createElement('div')
    item.className = 'ledger-item' + (l.id === state.currentId ? ' active' : '')
    item.innerHTML = `<span class="ledger-glyph"></span><span class="name"></span><span class="count">${l.recordCount} 条</span>`
    setGlyph(item.querySelector('.ledger-glyph'), l.iconImage, '📒')
    item.querySelector('.name').textContent = l.name
    item.addEventListener('click', () => openLedger(l.id))
    box.appendChild(item)
  }
}

function renderMain() {
  const has = !!state.ledger
  $('#btn-rename').hidden = !has
  $('#btn-delete').hidden = !has

  if (!has) {
    $('#ledger-title').textContent = '请选择或创建一个账本'
    $('#sum-income').textContent = $('#sum-expense').textContent = $('#sum-balance').textContent = '¥0.00'
    $('#budget-card-wrap').classList.add('hidden')
    $('#chain-card-wrap').classList.add('hidden')
    renderDashboard([], [])
    renderTopList([])
    renderChainCard([])
    renderCalendarHeatmap([])
    refreshRecords()
    renderImportHistory()
    updateExportView()
    return
  }

  const records = toPnlRecords(state.ledger.records || [])
  $('#ledger-title').textContent = state.ledger.name

  // 预算面板：总预算 / 分类预算取自个人资料，支出恒按当前账本全量流水计算（不受看板时间筛选影响）
  $('#budget-card-wrap').classList.remove('hidden')
  $('#chain-card-wrap').classList.remove('hidden')
  const prof = currentProfile?.profile
  renderBudgetCard(prof?.monthlyBudget || 0, prof?.categoryBudgets || {}, records, openBudgetEditor)

  // 概览卡 / 饼图 / TOP 榜跟随时间筛选；趋势图恒看全量近 12 个月
  const scoped = filterByRange(records, $('#dash-range').value)
  let income = 0
  let expense = 0
  for (const r of scoped) {
    if (r.type === 'income') income += Number(r.amount) || 0
    else if (r.type === 'expense') expense += Number(r.amount) || 0
  }
  $('#sum-income').textContent = fmtMoney(income)
  $('#sum-expense').textContent = fmtMoney(expense)
  $('#sum-balance').textContent = fmtMoney(income - expense)
  renderDashboard(records, scoped)
  renderTopList(scoped)
  renderChainCard(records)
  renderCalendarHeatmap(records, new Date().getFullYear())
  refreshRecords()
  renderImportHistory()
  updateExportView()
  renderFunds()
}

// ---------------------------- 导入历史与撤销 ----------------------------------

function renderImportHistory() {
  const box = $('#import-history')
  const batches = state.ledger ? state.ledger.batches || [] : []
  if (!batches.length) {
    box.innerHTML = '<span class="muted">暂无</span>'
    return
  }
  box.innerHTML = ''
  for (const b of [...batches].reverse()) {
    const row = document.createElement('div')
    row.className = 'history-row'
    const t = new Date(b.importedAt).toLocaleString('zh-CN', { hour12: false })
    row.innerHTML = `<span>📦 ${escapeText(b.fileName)}（${escapeText(b.sheet)}）· ${b.count} 条 · ${t}</span>`
    const undo = document.createElement('button')
    undo.className = 'btn btn-danger btn-sm'
    undo.textContent = '撤销本批'
    undo.addEventListener('click', () => undoBatch(b.id))
    row.appendChild(undo)
    box.appendChild(row)
  }
}

async function undoBatch(batchId) {
  if (!state.ledger) return
  const ok = await askConfirm(
    '撤销导入批次',
    '确定删除该批次导入的全部流水吗？\n手动记录与其他批次不受影响。',
    '撤销本批'
  )
  if (!ok) return
  const kept = (state.ledger.records || []).filter((r) => r.source !== `imp-${batchId}`)
  const batches = (state.ledger.batches || []).filter((b) => b.id !== batchId)
  await window.ledgerAPI.saveRecords(state.ledger.id, kept, batches)
  await refreshLedgers()
  await openLedger(state.ledger.id)
}

// ---------------------------- 导入面板接入 ------------------------------------

async function handleImported(newRecords, batch) {
  if (!state.ledger) throw new Error('未选择账本')
  const merged = [...newRecords, ...(state.ledger.records || [])]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  const batches = [...(state.ledger.batches || []), batch]
  await window.ledgerAPI.saveRecords(state.ledger.id, merged, batches)
  await refreshLedgers()
  await openLedger(state.ledger.id)
  // 导入成功后跳到流水页核对
  document.querySelector('.tab[data-tab="records"]').click()
}

// ---------------------------- 账本操作 -------------------------------------

$('#btn-new-ledger').addEventListener('click', () => openLedgerSettings('create'))

$('#btn-rename').addEventListener('click', () => {
  if (state.ledger) openLedgerSettings('edit')
})

// 账本设置弹窗（新建 / 重命名 + 图标图片）
let lsCtx = null // { mode, id, icon }

function openLedgerSettings(mode) {
  const isEdit = mode === 'edit'
  lsCtx = {
    mode,
    id: isEdit ? state.ledger.id : null,
    icon: isEdit ? state.ledger.iconImage || '' : ''
  }
  $('#ls-title').textContent = isEdit ? '账本设置' : '新建账本'
  $('#ls-name').value = isEdit ? state.ledger.name : ''
  setGlyph($('#ls-icon'), lsCtx.icon, '📒')
  $('#ls-error').textContent = ''
  $('#ledger-settings-mask').classList.remove('hidden')
  $('#ls-name').focus()
}

$('#ls-btn-icon').addEventListener('click', () => $('#ledger-icon-file').click())
$('#ledger-icon-file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!file) return
  try {
    lsCtx.icon = await fileToSquare(file, 256)
    setGlyph($('#ls-icon'), lsCtx.icon, '📒')
  } catch (err) {
    showToast(err.message, 'error')
  }
})
$('#ls-btn-remove').addEventListener('click', () => {
  lsCtx.icon = ''
  setGlyph($('#ls-icon'), '', '📒')
})
$('#ls-cancel').addEventListener('click', () => $('#ledger-settings-mask').classList.add('hidden'))
$('#ledger-settings-mask').addEventListener('click', (e) => {
  if (e.target === $('#ledger-settings-mask')) $('#ledger-settings-mask').classList.add('hidden')
})
bindModalEsc($('#ledger-settings-mask'), () => $('#ledger-settings-mask').classList.add('hidden'))
$('#ls-ok').addEventListener('click', async () => {
  const name = $('#ls-name').value.trim()
  if (!name) { $('#ls-error').textContent = '账本名称不能为空'; return }
  try {
    if (lsCtx.mode === 'create') {
      const ledger = await window.ledgerAPI.create(name, lsCtx.icon)
      await refreshLedgers()
      await openLedger(ledger.id)
    } else {
      await window.ledgerAPI.rename(lsCtx.id, name, lsCtx.icon)
      await refreshLedgers()
      await openLedger(lsCtx.id)
    }
    $('#ledger-settings-mask').classList.add('hidden')
  } catch (e) {
    $('#ls-error').textContent = e.message || String(e)
  }
})

$('#btn-delete').addEventListener('click', async () => {
  if (!state.ledger) return
  const l = state.ledger
  const ok = await askConfirm(
    '删除账本',
    `确定删除账本「${l.name}」吗？\n其中 ${l.records.length} 条流水将一并删除，且无法恢复（如需保留请先备份）。`,
    '删除'
  )
  if (!ok) return
  const backup = structuredClone(l)
  await window.ledgerAPI.remove(l.id)
  state.currentId = null
  state.ledger = null
  pushUndo(`已删除账本「${l.name}」`, async () => {
    await window.ledgerAPI.restoreFile(backup)
  }, 8000)
  await refreshLedgers()
  renderMain()
})

// ------------------------------ 标签页 -------------------------------------

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'))
    tab.classList.add('active')
    document.querySelectorAll('.panel').forEach((p) => p.classList.add('hidden'))
    $(`#panel-${tab.dataset.tab}`).classList.remove('hidden')
    if (tab.dataset.tab === 'dashboard') requestAnimationFrame(resizeDashboard)
  })
})

// --------------------- 演示数据（存储层 + 看板验证用） ------------------------
// 按钮位于「流水」页空态中（#records-empty 内），有数据时随空态一起隐藏。

$('#btn-demo').addEventListener('click', async () => {
  if (!state.ledger) return showToast('请先创建/选择一个账本', 'warn')
  await window.ledgerAPI.saveRecords(state.ledger.id, makeDemoRecords(), state.ledger.batches || [])
  await refreshLedgers()
  await openLedger(state.ledger.id)
})

$('#btn-demo-clear').addEventListener('click', async () => {
  if (!state.ledger) return showToast('请先创建/选择一个账本', 'warn')
  const ok = await askConfirm('清空流水', '确定清空当前账本的全部流水吗？\n导入批次记录也会一并清除。', '清空')
  if (!ok) return
  await window.ledgerAPI.saveRecords(state.ledger.id, [], [])
  await refreshLedgers()
  await openLedger(state.ledger.id)
})

const CATS_EXP = ['餐饮', '交通', '购物', '居家', '娱乐', '医疗']
const CATS_INC = ['工资', '奖金', '报销', '其他收入']

function makeDemoRecords() {
  const today = new Date()
  const out = []
  let incN = 0
  for (let i = 0; i < 30; i++) {
    const isExp = i % 4 !== 0
    const d = new Date(today.getFullYear(), today.getMonth() - (i % 4), 1 + ((i * 7) % 27))
    const category = isExp ? CATS_EXP[i % CATS_EXP.length] : CATS_INC[incN++ % CATS_INC.length]
    out.push({
      id: 'demo-' + i,
      date: isoLocal(d),
      type: isExp ? 'expense' : 'income',
      category,
      amount: Math.round((isExp ? 30 + (i * 53) % 700 : 2000 + (i * 617) % 8000) * 100) / 100,
      note: '演示数据 ' + (i + 1),
      source: 'demo'
    })
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1))
}

// ------------------------------- 启动 --------------------------------------

// 全局异常捕获：console 落 renderer.log；同时按设置记录到崩溃日志（仅消息与代码位置）
window.addEventListener('error', (e) => {
  console.error('未捕获异常:', e.message, e.filename + ':' + e.lineno)
  try {
    window.crashAPI.report({ message: String((e.error && e.error.message) || e.message || 'error'), url: e.filename, line: e.lineno, col: e.colno })
  } catch { /* ignore */ }
})
window.addEventListener('unhandledrejection', (e) => {
  const msg = (e.reason && e.reason.message) || String(e.reason)
  console.error('Promise 异常:', msg)
  try { window.crashAPI.report({ message: '未处理的 Promise 异常: ' + msg }) } catch { /* ignore */ }
})

$('#dash-range').addEventListener('change', renderMain)

initImportPanel({
  getLedger: () => state.ledger,
  onImported: handleImported,
  refreshHistory: renderImportHistory
})

initRecordsPanel({
  getLedger: () => state.ledger,
  save: async (records) => {
    const ledger = state.ledger
    await window.ledgerAPI.saveRecords(ledger.id, records, ledger.batches || [])
    await refreshLedgers()
    await openLedger(ledger.id)
  }
})

initExportPanel({ getLedger: () => state.ledger })

// ---------------------------- PDF 月报导出 ----------------------------------

function initPdfReport() {
  const sel = $('#pdf-month')
  const now = new Date()
  const opts = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    opts.push(`<option value="${key}">${d.getFullYear()} 年 ${d.getMonth() + 1} 月</option>`)
  }
  sel.innerHTML = opts.join('')

  $('#btn-pdf').addEventListener('click', async () => {
    const status = $('#pdf-status')
    status.textContent = ''
    if (!state.ledger) { status.textContent = '请先打开一个账本'; return }
    const [yy, mm] = sel.value.split('-').map(Number)
    const btn = $('#btn-pdf')
    btn.disabled = true
    btn.textContent = '正在生成…'
    try {
      const settings = await window.settingsAPI.get()
      const html = buildMonthlyReportHTML(state.ledger, { year: yy, month: mm }, currentProfile?.profile, settings)
      const r = await window.reportAPI.exportPDF(html, `${state.ledger.name}_${sel.value}月报.pdf`)
      if (r.ok) await showAlert('PDF 月报已保存到：\n' + r.path, 'success', '导出成功')
      else if (r.busy) status.textContent = '目标文件被占用：请关闭已打开的同名 PDF（或资源管理器预览窗格），换个文件名或位置后重试'
      else if (!r.canceled) status.textContent = '导出失败，请重试'
    } catch (err) {
      status.textContent = '生成失败：' + (err.message || err)
    } finally {
      btn.disabled = false
      btn.textContent = '生成并导出 PDF…'
    }
  })
}
initPdfReport()

// ----------------------------- 自动更新 ----------------------------------
if (window.updaterAPI) {
  // 新版本下载完成：自绘弹窗确认后重启安装
  window.updaterAPI.onDownloaded(async (info) => {
    const v = info && info.version ? ` v${info.version}` : ''
    const yes = await askConfirm(
      '发现新版本',
      `新版本${v}已下载完成，重启后生效。是否立即重启？`,
      '立即重启'
    )
    if (yes) window.updaterAPI.install()
  })

  $('#btn-check-update').addEventListener('click', async () => {
    const meta = $('#upd-meta')
    meta.textContent = '正在检查…'
    try {
      const r = await window.updaterAPI.check()
      if (r.status === 'available') meta.textContent = `发现新版本 v${r.version}，正在后台下载…`
      else if (r.status === 'not-available') meta.textContent = '当前已是最新版本'
      else if (r.status === 'dev') meta.textContent = '开发环境不检查更新（安装包内生效）'
      else meta.textContent = '暂时无法检查（无网络或尚未发布更新）'
    } catch {
      meta.textContent = '暂时无法检查，请稍后再试'
    }
  })
}

// 年度账单 / 多账本汇总
initYearPanel({ getLedger: () => state.ledger })
initSummaryPanel({ setGlyph })

// 资金账户与转账
initFundsUI({
  getLedger: () => state.ledger,
  afterChange: async () => {
    await refreshLedgers()
    await openLedger(state.currentId)
  }
})

// 周期记账
initRecurringUI({
  getLedger: () => state.ledger,
  afterChange: async () => {
    await refreshLedgers()
    await openLedger(state.currentId)
  }
})

// 账单 / 还款提醒
const updateProfile = async (patch) => {
  const profile = await window.authAPI.updateProfile(patch)
  if (currentProfile) currentProfile.profile = profile
  return profile
}
initRemindersUI({
  getLedger: () => state.ledger,
  getProfile: getCurrentProfile,
  updateProfile
})

// 账户对账
initReconcileUI({
  getLedger: () => state.ledger,
  afterChange: async () => {
    await refreshLedgers()
    await openLedger(state.currentId)
  }
})

// 首次切到看板时 ECharts 容器才有实际宽度，切页后触发一次 resize
document.querySelectorAll('.tab').forEach((tab) =>
  tab.addEventListener('click', () =>
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
  )
)

// 原生 select 弹层在本机 Win11/Electron 下不稳定：统一替换为自绘下拉（数据仍存于原生 select）
enhanceSelects()

// ---------------------------- 账户与登录门 ---------------------------------

/** 登录进入后：若上次未正常退出，提示并可查看崩溃记录（仅提示一次） */
async function checkPendingCrash() {
  let pending = null
  try { pending = await window.crashAPI.getPending() } catch { return }
  if (!pending) return
  const when = pending.liveness && pending.liveness.startedAt
    ? new Date(pending.liveness.startedAt).toLocaleString('zh-CN', { hour12: false })
    : '上一次运行'
  const recent = pending.recentCrash
    ? `\n\n检测到错误：${pending.recentCrash.name}: ${pending.recentCrash.message}`
    : ''
  const view = await askConfirm(
    '检测到上次未正常退出',
    `${when}程序未正常关闭（可能是崩溃、被强制结束或断电）。${recent}\n\n是否查看崩溃记录？`,
    '查看记录'
  )
  await window.crashAPI.markSeen()
  if (view) { document.querySelector('.tab[data-tab="export"]').click(); $('#cz-view').click() }
}

const authCtl = initAuth({
  onAuthorized: async () => {
    let needGuide = false
    try {
      currentProfile = await window.authAPI.getProfile()
      renderAccountSidebar(currentProfile)
      needGuide = currentProfile.profile.onboarded !== true
    } catch (e) {
      console.error('读取个人资料失败:', e.message)
    }
    refreshLedgers().catch((e) => showToast('读取账本失败：' + e.message, 'error'))
    checkPendingCrash()
    if (needGuide) setTimeout(() => openOnboarding(), 800)
  }
})

$('#btn-logout').addEventListener('click', async () => {
  const ok = await askConfirm(
    '退出登录',
    '确定要退出当前账户吗？所有数据都已实时保存在本机，不会丢失。',
    '退出'
  )
  if (!ok) return
  try { await window.authAPI.logout() } catch { /* ignore */ }
  clearUndo() // 身份变更，作废原账户的撤销栈
  // 平滑回到登录门：重置内存状态即可，不整页刷新（避免白屏闪烁）
  state.ledgers = []
  state.currentId = null
  state.ledger = null
  currentProfile = null
  renderAccountSidebar(null)
  renderLedgerList()
  renderMain()
  authCtl.show('login')
})

// 新手引导：完成后把 profile.onboarded 置 true；报表页可再次查看
initOnboarding({
  afterDone: async () => {
    const full = await window.authAPI.getProfile()
    if (full.profile.onboarded === true) return
    const profile = await window.authAPI.updateProfile({ ...full.profile, onboarded: true })
    if (currentProfile) currentProfile.profile = profile
  }
})
$('#btn-replay-onboarding').addEventListener('click', () => openOnboarding())

// 资料 / 预算模块接线：共享 currentProfile，资料弹窗可跳转改密
initProfileUI({ getCurrentProfile, setCurrentProfile, openChangePassword })
initBudgetUI({
  getCurrentProfile,
  setCurrentProfile,
  getLedgerRecords: () => state.ledger?.records || [],
  renderMain
})

// 撤销成功后统一重渲染当前视图（反向操作已按账本 id 自行落盘）
setAfterUndo(async () => {
  await refreshLedgers()
  if (state.currentId) await openLedger(state.currentId)
})

// 启动：先加载品牌（登录页也要显示），再试自动登录，失败则弹登录门
async function bootApp() {
  const cur = await window.authAPI.auto()
  console.info('[boot] auth.auto =>', cur ? cur.username : '需登录')
  if (cur) authCtl.enter(cur.username)
  else authCtl.show((await window.authAPI.hasAccounts()) ? 'login' : 'register')
}

installNativeOverrides()
loadBrand()
loadAppearance().catch((e) => console.error('加载个性化卡片失败:', e.message))
bootApp().catch((e) => {
  console.error('[boot] 启动失败:', e.message)
  showAlert('启动失败：' + e.message, 'error')
})
