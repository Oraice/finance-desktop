// ---------------------------------------------------------------------------
// auth-ui.mjs —— 登录门（全屏覆盖层）：登录/注册切换、口令提交、锁定倒计时、
// 密码强度条。安全校验以主进程为准，这里的强度条只是输入体验。
// 协议：register/login 返回 {ok, username} 或 {ok:false, error, lockRemainingMs?}
// ---------------------------------------------------------------------------

const $ = (sel) => document.querySelector(sel)

export function initAuth({ onAuthorized }) {
  const mask = $('#auth-mask')
  const user = $('#auth-user')
  const pass = $('#auth-pass')
  const pass2 = $('#auth-pass2')
  const auto = $('#auth-auto')
  const err = $('#auth-error')
  const submit = $('#auth-submit')
  const hint = $('#auth-hint')
  const meter = $('#pw-meter')
  const fill = $('#pw-meter-fill')
  const meterText = $('#pw-meter-text')

  let mode = 'login'
  let lockTimer = null

  function setMode(m) {
    mode = m
    document.querySelectorAll('#auth-tabs .seg-btn').forEach((b) =>
      b.classList.toggle('active', b.dataset.mode === m))
    $('#auth-pass2-wrap').classList.toggle('hidden', m !== 'register')
    meter.classList.toggle('hidden', m !== 'register')
    submit.textContent = m === 'register' ? '注册并进入' : '登 录'
    err.textContent = ''
  }

  document.querySelectorAll('#auth-tabs .seg-btn').forEach((b) =>
    b.addEventListener('click', () => { if (!lockTimer) setMode(b.dataset.mode) }))

  // 强度镜像主进程规则：<8 位 = 0；此后按 字母/数字/符号 种类数 1-4
  function strengthOf(v) {
    if (v.length < 8) return -1
    const kinds = (/[a-z]/.test(v) ? 1 : 0) + (/[A-Z]/.test(v) ? 1 : 0) +
      (/\d/.test(v) ? 1 : 0) + (/[^A-Za-z0-9]/.test(v) ? 1 : 0)
    return kinds
  }

  pass.addEventListener('input', () => {
    const k = strengthOf(pass.value)
    if (!pass.value) { fill.style.width = '0%'; meterText.textContent = '密码强度'; return }
    if (k < 0) { fill.style.width = '15%'; fill.style.background = '#e03131'; meterText.textContent = '太短（至少 8 位）'; return }
    const pct = k >= 4 ? '100%' : k === 3 ? '75%' : '50%'
    const color = k >= 3 ? '#2f9e44' : '#f08c00'
    fill.style.width = pct
    fill.style.background = color
    meterText.textContent = k >= 4 ? '密码强度：极强' : k === 3 ? '密码强度：强' : '密码强度：中'
  })

  function startLock(ms) {
    let left = Math.ceil(ms / 1000)
    lockTimer = setInterval(() => {
      left -= 1
      if (left <= 0) {
        clearInterval(lockTimer)
        lockTimer = null
        hint.textContent = ''
        submit.disabled = false
        submit.textContent = mode === 'register' ? '注册并进入' : '登 录'
      } else {
        hint.textContent = `已锁定，${left} 秒后可重试`
      }
    }, 1000)
    hint.textContent = `已锁定，${left} 秒后可重试`
    submit.disabled = true
    submit.textContent = '锁定中…'
  }

  async function doSubmit() {
    if (lockTimer || submit.disabled) return
    const u = user.value.trim()
    const p = pass.value
    err.textContent = ''
    if (!u || !p) { err.textContent = '请填写用户名和密码'; return }
    if (mode === 'register' && p !== pass2.value) { err.textContent = '两次输入的密码不一致'; return }
    submit.disabled = true
    submit.textContent = '验证中…'
    try {
      const res = mode === 'register'
        ? await window.authAPI.register(u, p, auto.checked)
        : await window.authAPI.login(u, p, auto.checked)
      if (!res || !res.ok) {
        err.textContent = (res && res.error) || '操作失败'
        if (res && res.lockRemainingMs) startLock(res.lockRemainingMs)
        else { submit.disabled = false; submit.textContent = mode === 'register' ? '注册并进入' : '登 录' }
        return
      }
      enter(res.username)
    } catch (e) {
      err.textContent = e.message || String(e)
      submit.disabled = false
      submit.textContent = mode === 'register' ? '注册并进入' : '登 录'
    }
  }

  submit.addEventListener('click', doSubmit)
  ;[user, pass, pass2].forEach((el) =>
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSubmit() }))

  // 法律文档查看（《用户协议》/《隐私政策》），在应用内弹窗加载
  const legalMask = $('#legal-mask')
  const legalFrame = $('#legal-frame')
  const legalTitle = $('#legal-title')
  function openLegal(name) {
    legalTitle.textContent = name
    legalFrame.src = encodeURI('legal/' + name + '.html')
    legalMask.classList.remove('hidden')
  }
  function closeLegal() {
    legalMask.classList.add('hidden')
    legalFrame.removeAttribute('src')
  }
  document.querySelectorAll('.legal-link').forEach((a) =>
    a.addEventListener('click', (e) => { e.preventDefault(); openLegal(a.dataset.legal) }))
  $('#legal-close').addEventListener('click', closeLegal)
  legalMask.addEventListener('click', (e) => { if (e.target === legalMask) closeLegal() })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !legalMask.classList.contains('hidden')) closeLegal()
  })

  function enter(username) {
    mask.classList.add('hidden')
    onAuthorized(username)
  }

  function show(defaultMode = 'login') {
    mask.classList.remove('hidden')
    setMode(defaultMode)
    // 复位表单：退出登录后不应残留上次的账号、密码与自动登录勾选
    user.value = ''
    pass.value = ''
    pass2.value = ''
    err.textContent = ''
    auto.checked = false
    user.focus()
  }

  return { enter, show, setMode }
}
