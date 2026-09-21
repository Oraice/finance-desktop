'use strict'

// ---------------------------------------------------------------------------
// settings-ui.mjs —— 应用品牌、修改密码、应用个性化（名称/Logo）、
// 数据备份与恢复。从 app.js 抽离。
// 依赖 index.html 中的 #pw-mask / #appearance 卡片及对应弹窗结构。
// ---------------------------------------------------------------------------

import { askText, askConfirm, showAlert, showToast, bindModalEsc } from './ui/dialog.mjs'
import { setGlyph, fileToSquare, esc } from './lib/util.mjs'

const $ = (s) => document.querySelector(s)

// ------------------------------ 品牌渲染 -----------------------------------

export function applyBrand(s) {
  setGlyph($('#brand-logo'), s.appLogo, '🦞')
  setGlyph($('#auth-brand-logo'), s.appLogo, '🦞')
  $('#brand-name').textContent = s.appName
  $('#auth-brand-name').textContent = s.appName
  document.title = `${s.appName} · 本地财务效率`
}

export async function loadBrand() {
  try {
    applyBrand(await window.settingsAPI.get())
  } catch (e) {
    console.error('加载应用品牌失败:', e.message)
  }
}

// ------------------------------ 修改密码 -----------------------------------

export function openChangePassword() {
  $('#pw-old').value = $('#pw-new').value = $('#pw-new2').value = ''
  $('#pw-error').textContent = ''
  $('#pw-mask').classList.remove('hidden')
  $('#pw-old').focus()
}
$('#pw-cancel').addEventListener('click', () => $('#pw-mask').classList.add('hidden'))
$('#pw-mask').addEventListener('click', (e) => {
  if (e.target === $('#pw-mask')) $('#pw-mask').classList.add('hidden')
})
bindModalEsc($('#pw-mask'), () => $('#pw-mask').classList.add('hidden'))
$('#pw-save').addEventListener('click', async () => {
  const errEl = $('#pw-error')
  errEl.textContent = ''
  const oldPw = $('#pw-old').value
  const newPw = $('#pw-new').value
  if (newPw !== $('#pw-new2').value) { errEl.textContent = '两次输入的新密码不一致'; return }
  try {
    await window.authAPI.changePassword(oldPw, newPw)
    $('#pw-mask').classList.add('hidden')
    showToast('密码修改成功', 'success')
  } catch (e) {
    errEl.textContent = e.message || String(e)
  }
})

// ---------------------------- 应用个性化 -----------------------------------

let apLogo = ''

export async function loadAppearance() {
  const s = await window.settingsAPI.get()
  apLogo = s.appLogo || ''
  $('#ap-name').value = s.appName
  setGlyph($('#ap-logo'), apLogo, '🦞')
  $('#ap-error').textContent = ''
  await loadDiagnostics(s)
}

$('#ap-btn-logo').addEventListener('click', () => $('#app-logo-file').click())
$('#app-logo-file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!file) return
  try {
    apLogo = await fileToSquare(file, 256)
    setGlyph($('#ap-logo'), apLogo, '🦞')
  } catch (err) {
    showToast(err.message, 'error')
  }
})
$('#ap-btn-remove').addEventListener('click', () => {
  apLogo = ''
  setGlyph($('#ap-logo'), '', '🦞')
})
$('#ap-save').addEventListener('click', async () => {
  const errEl = $('#ap-error')
  errEl.textContent = ''
  try {
    const s = await window.settingsAPI.update({ appName: $('#ap-name').value, appLogo: apLogo })
    applyBrand(s)
    await showAlert('应用名称与 Logo 已更新。\n任务栏图标若未立即刷新，重启应用后完全生效。', 'success', '保存成功')
  } catch (e) {
    errEl.textContent = e.message || String(e)
  }
})

// ---------------------------- 数据备份与恢复 --------------------------------

$('#btn-backup').addEventListener('click', async () => {
  const encrypt = await askConfirm(
    '备份数据',
    '是否为备份文件设置密码？\n\n确定 = 设置密码加密（恢复时需要密码）\n取消 = 不加密直接备份',
    '加密备份'
  )
  let password = ''
  if (encrypt) {
    password = await askText('设置备份密码（至少 6 位）', '', { password: true, placeholder: '请输入备份密码', emptyHint: '密码不能为空' })
    if (password === null) return
    if (password.length < 6) { await showAlert('备份密码至少 6 位', 'warn'); return }
    const again = await askText('再次输入备份密码确认', '', { password: true, placeholder: '请再次输入密码', emptyHint: '密码不能为空' })
    if (again === null) return
    if (again !== password) { await showAlert('两次输入不一致，已取消备份', 'warn'); return }
  }
  try {
    const res = await window.backupAPI.export(password)
    if (res.ok) await showAlert('文件已保存到：\n' + res.path, 'success', '备份成功')
  } catch (e) {
    await showAlert(e.message, 'error', '备份失败')
  }
})

$('#btn-restore').addEventListener('click', async () => {
  let picked
  try {
    picked = await window.backupAPI.pick()
  } catch (e) {
    showToast('选择文件失败：' + e.message, 'error')
    return
  }
  if (!picked || picked.canceled) return

  let password = ''
  if (picked.encrypted) {
    password = await askText('该备份已加密，请输入备份密码', '', { password: true, placeholder: '请输入备份密码', emptyHint: '密码不能为空' })
    if (password === null) return
  }

  let info
  try {
    info = await window.backupAPI.inspect(picked.path, password)
  } catch (e) {
    showToast('读取备份失败：' + e.message, 'error')
    return
  }
  const s = info.summary
  const confirmRestore = await askConfirm(
    '确认恢复',
    `备份时间：${new Date(s.createdAt).toLocaleString('zh-CN')}\n账户：${s.accountCount} 个\n账本：${s.ledgerCount} 个，共 ${s.recordCount} 条流水\n\n恢复会先自动备份一份当前数据，然后用备份内容替换；恢复后需要重新登录。`,
    '确认恢复'
  )
  if (!confirmRestore) return

  try {
    await window.backupAPI.restore(picked.path, password)
    await showAlert('应用将返回登录界面，请使用备份中的账号密码登录。', 'success', '恢复成功')
    location.reload()
  } catch (e) {
    await showAlert(e.message, 'error', '恢复失败')
  }
})

// ---------------------------- 诊断与崩溃记录 -------------------------------

async function refreshCrashCount() {
  let list = []
  try {
    list = await window.crashAPI.list()
    $('#cz-count').textContent = `崩溃记录 ${list.length} 条`
  } catch { /* ignore */ }
  return list
}

async function loadDiagnostics(s) {
  $('#cz-local').checked = s.crashLocalLog !== false
  $('#cz-upload').checked = s.crashUpload === true
  $('#cz-endpoint').value = s.crashEndpoint || ''
  await refreshCrashCount()
}

function renderCrashList(list) {
  const body = $('#cl-body')
  if (!list.length) { body.innerHTML = '<div class="crash-empty">暂无崩溃记录</div>'; return }
  body.innerHTML = list.map((c) => {
    const tag = esc(c.source || 'main')
    const stack = c.stack ? `<div class="crash-stack">${esc(c.stack)}</div>` : ''
    return `<div class="crash-item">
      <div class="crash-item-head">
        <span class="crash-tag ${tag}">${tag}</span>
        <span class="crash-time">${esc(c.at || '')}</span>
        <span class="crash-ver">v${esc(c.appVersion || '')} · ${esc(c.os || c.platform || '')}</span>
      </div>
      <div class="crash-msg">${esc(c.name || 'Error')}: ${esc(c.message || '')}</div>
      ${stack}
    </div>`
  }).join('')
}

$('#cz-save').addEventListener('click', async () => {
  try {
    const cur = await window.settingsAPI.get()
    const s = await window.settingsAPI.update({
      appName: cur.appName,
      appLogo: cur.appLogo,
      crashLocalLog: $('#cz-local').checked,
      crashUpload: $('#cz-upload').checked,
      crashEndpoint: $('#cz-endpoint').value
    })
    await loadDiagnostics(s)
    await showAlert('诊断设置已保存。', 'success', '保存成功')
  } catch (e) {
    await showAlert(e.message, 'error', '保存失败')
  }
})

$('#cz-view').addEventListener('click', async () => {
  renderCrashList(await refreshCrashCount())
  $('#crash-list-mask').classList.remove('hidden')
  $('#cl-close').focus()
})
$('#cl-close').addEventListener('click', () => $('#crash-list-mask').classList.add('hidden'))
$('#crash-list-mask').addEventListener('click', (e) => {
  if (e.target === $('#crash-list-mask')) $('#crash-list-mask').classList.add('hidden')
})
bindModalEsc($('#crash-list-mask'), () => $('#crash-list-mask').classList.add('hidden'))

$('#cz-clear').addEventListener('click', async () => {
  const ok = await askConfirm('清空崩溃记录', '确定清空全部崩溃记录吗？', '清空')
  if (!ok) return
  await window.crashAPI.clear()
  await refreshCrashCount()
})
$('#cl-clear').addEventListener('click', async () => {
  const ok = await askConfirm('清空崩溃记录', '确定清空全部崩溃记录吗？此操作不可撤销。', '清空')
  if (!ok) return
  await window.crashAPI.clear()
  renderCrashList([])
  await refreshCrashCount()
})

$('#cl-export').addEventListener('click', async () => {
  const list = await window.crashAPI.list()
  if (!list.length) { await showAlert('暂无崩溃记录可导出。', 'info'); return }
  try {
    const res = await window.crashAPI.export(list)
    if (res && res.ok) await showAlert('崩溃记录已导出到：\n' + res.path, 'success', '导出成功')
  } catch (e) {
    await showAlert(e.message, 'error', '导出失败')
  }
})
