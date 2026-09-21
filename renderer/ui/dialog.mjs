// ---------------------------------------------------------------------------
// dialog.mjs —— 自绘的精致弹窗：输入 askText / 确认 askConfirm / 提示 showAlert
// 替代丑陋的原生 alert/confirm/prompt，并接管 window.alert。
// 依赖 index.html 中的 #modal-mask 与 #notice-mask 结构及对应 CSS。
// ---------------------------------------------------------------------------

const $ = (s) => document.querySelector(s)

/**
 * 自绘输入弹窗。
 * options: { password, placeholder, emptyHint }
 * 返回 Promise<string|null>：确定为输入值，取消为 null。
 */
export function askText(title, initialValue = '', options = {}) {
  return new Promise((resolve) => {
    const mask = $('#modal-mask')
    const input = $('#modal-input')
    const err = $('#modal-error')
    input.type = options.password ? 'password' : 'text'
    input.placeholder = options.placeholder || ''
    input.classList.remove('hidden') // 防御：确认框可能残留隐藏状态
    input.value = initialValue
    err.textContent = ''
    mask.classList.remove('hidden')
    input.focus()
    if (initialValue) input.select()

    const done = (val) => {
      mask.classList.add('hidden')
      input.type = 'text' // 关闭后恢复普通文本框，避免影响后续名称输入
      input.placeholder = ''
      $('#modal-ok').onclick = $('#modal-cancel').onclick = onKey = null
      resolve(val)
    }
    let onKey = null
    const submit = () => {
      // 密码不 trim（保留原始输入），普通文本去首尾空格
      const v = options.password ? input.value : input.value.trim()
      if (!v) { err.textContent = options.emptyHint || '内容不能为空'; input.focus(); return }
      done(v)
    }
    $('#modal-ok').onclick = submit
    $('#modal-cancel').onclick = () => done(null)
    onKey = (e) => {
      if (e.key === 'Enter') submit()
      else if (e.key === 'Escape') done(null)
    }
    input.onkeydown = onKey
  })
}

/** 自绘确认弹窗，返回 Promise<boolean> */
export function askConfirm(title, message, okText = '确定') {
  return new Promise((resolve) => {
    const mask = $('#modal-mask')
    const input = $('#modal-input')
    const messageEl = $('#modal-message')
    const err = $('#modal-error')
    $('#modal-title').textContent = title
    messageEl.textContent = message
    messageEl.classList.remove('hidden')
    input.classList.add('hidden')
    err.textContent = ''
    $('#modal-ok').textContent = okText
    mask.classList.remove('hidden')

    let onKey = null
    const done = (val) => {
      document.removeEventListener('keydown', onKey)
      mask.classList.add('hidden')
      messageEl.classList.add('hidden')
      input.classList.remove('hidden')
      $('#modal-ok').textContent = '确定'
      resolve(val)
    }
    onKey = (e) => {
      if (e.key === 'Enter') done(true)
      else if (e.key === 'Escape') done(false)
    }
    $('#modal-ok').onclick = () => done(true)
    $('#modal-cancel').onclick = () => done(false)
    document.addEventListener('keydown', onKey)
  })
}

const NOTICE_ICONS = { success: '✓', error: '✕', warn: '!', info: 'i' }
const NOTICE_TITLES = { success: '操作成功', error: '操作失败', warn: '提醒', info: '提示' }

/** 自绘消息提示，返回 Promise，点"知道了"或按 Enter/Esc/空格后 resolve */
export function showAlert(message, type = 'info', title = '') {
  return new Promise((resolve) => {
    const mask = $('#notice-mask')
    const icon = $('#notice-icon')
    $('#notice-title').textContent = title || NOTICE_TITLES[type] || '提示'
    $('#notice-body').textContent = message
    icon.className = 'notice-icon ' + type
    icon.textContent = NOTICE_ICONS[type] || 'i'
    mask.classList.remove('hidden')

    const done = () => {
      mask.classList.add('hidden')
      $('#notice-ok').onclick = null
      document.removeEventListener('keydown', onKey)
      resolve()
    }
    const onKey = (e) => {
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') done()
    }
    $('#notice-ok').onclick = done
    document.addEventListener('keydown', onKey)
  })
}

// ------------------------------ 轻量 Toast ----------------------------------

const TOAST_STYLE_ID = 'app-toast-style'
const TOAST_ICONS = { success: '✓', error: '✕', warn: '!', info: 'i' }
const TOAST_COLORS = { success: '#2f9e44', error: '#e03131', warn: '#f08c00', info: '#1971c2' }

function ensureToastHost() {
  let host = document.getElementById('toast-host')
  if (host) return host
  if (!document.getElementById(TOAST_STYLE_ID)) {
    const st = document.createElement('style')
    st.id = TOAST_STYLE_ID
    st.textContent = `
      #toast-host{position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:12000;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none}
      .app-toast{min-width:150px;max-width:440px;padding:9px 16px 9px 12px;border-radius:10px;background:#fff;color:#212529;font-size:13px;line-height:1.4;box-shadow:0 10px 26px rgba(0,0,0,.14);display:flex;align-items:center;gap:10px;opacity:0;transform:translateY(-8px);transition:opacity .18s ease,transform .18s ease;border-left:4px solid #ccc}
      .app-toast.show{opacity:1;transform:translateY(0)}
      .app-toast .toast-ico{width:20px;height:20px;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex:0 0 auto}
      .app-toast .toast-action{pointer-events:auto;margin-left:2px;background:transparent;border:none;color:#1971c2;font-size:13px;font-weight:600;cursor:pointer;padding:3px 8px;border-radius:6px}
      .app-toast .toast-action:hover{background:#e7f1fb}`
    document.head.appendChild(st)
  }
  host = document.createElement('div')
  host.id = 'toast-host'
  document.body.appendChild(host)
  return host
}

/** 轻量提示条：自动消失、不阻塞。type=success/error/warn/info。 */
export function showToast(message, type = 'success', duration = 2000) {
  const host = ensureToastHost()
  const el = document.createElement('div')
  el.className = 'app-toast'
  const color = TOAST_COLORS[type] || TOAST_COLORS.info
  el.style.borderLeftColor = color
  el.innerHTML = '<span class="toast-ico"></span><span class="toast-msg"></span>'
  el.querySelector('.toast-ico').textContent = TOAST_ICONS[type] || 'i'
  el.querySelector('.toast-ico').style.background = color
  el.querySelector('.toast-msg').textContent = message
  host.appendChild(el)
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')))
  const remove = () => {
    el.classList.remove('show')
    setTimeout(() => el.remove(), 220)
  }
  setTimeout(remove, duration)
}

/**
 * 带操作按钮的提示条：到时自动消失；点操作按钮立即关闭并触发回调。
 * options: { actionText='撤销', onAction, type='info', duration=5000 }
 */
export function showToastWithAction(message, options = {}) {
  const { actionText = '撤销', onAction = null, type = 'info', duration = 5000 } = options
  const host = ensureToastHost()
  const el = document.createElement('div')
  el.className = 'app-toast'
  const color = TOAST_COLORS[type] || TOAST_COLORS.info
  el.style.borderLeftColor = color
  el.innerHTML = '<span class="toast-ico"></span><span class="toast-msg"></span><button type="button" class="toast-action"></button>'
  el.querySelector('.toast-ico').textContent = TOAST_ICONS[type] || 'i'
  el.querySelector('.toast-ico').style.background = color
  el.querySelector('.toast-msg').textContent = message
  const btn = el.querySelector('.toast-action')
  btn.textContent = actionText
  host.appendChild(el)
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')))
  const remove = () => {
    el.classList.remove('show')
    setTimeout(() => el.remove(), 220)
  }
  const timer = setTimeout(remove, duration)
  btn.addEventListener('click', () => {
    clearTimeout(timer)
    remove()
    if (typeof onAction === 'function') {
      try { onAction() } catch (e) { console.error('toast action 异常:', e.message) }
    }
  })
}

/**
 * 为弹窗绑定 Esc 关闭（键盘无障碍）。弹窗打开时焦点在其内部输入框 / 按钮，
 * Esc 事件冒泡到遮罩即触发 onClose。
 * @param mask 遮罩元素
 * @param onClose 关闭回调（通常 () => mask.classList.add('hidden')）
 */
export function bindModalEsc(mask, onClose) {
  mask.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose() }
  })
}

/** 接管原生 window.alert（自绘弹窗不阻塞，需继续执行处请 await showAlert） */
export function installNativeOverrides() {
  window.alert = (msg) => { showAlert(String(msg ?? ''), 'info') }
}
