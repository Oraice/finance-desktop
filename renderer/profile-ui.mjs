'use strict'

// ---------------------------------------------------------------------------
// profile-ui.mjs —— 账户侧边栏头像、个人资料弹窗、Telegram 风格头像菜单、
// 头像图片裁剪、修改登录用户名。从 app.js 抽离。
// 依赖 index.html 中的 #profile-mask / #avatar-menu-mask / #crop-mask 等结构。
// ---------------------------------------------------------------------------

import { askText, showToast, bindModalEsc } from './ui/dialog.mjs'

const $ = (s) => document.querySelector(s)

export const AVATAR_COLORS = ['#d9480f', '#1971c2', '#2f9e44', '#9c36b5', '#e8590c', '#1098ad', '#be4bdb', '#f08c00']

const avatarChar = (name) => String(name || '?').trim().charAt(0).toUpperCase()

/** 统一渲染圆形头像：照片优先，其次 emoji，最后昵称首字 */
export function paintAvatar(el, p, fallbackName) {
  el.style.backgroundRepeat = 'no-repeat'
  el.style.backgroundPosition = 'center'
  el.style.backgroundSize = 'cover'
  el.style.backgroundImage = ''
  if (p.avatarImage) {
    el.textContent = ''
    el.style.background = p.avatarColor
    el.style.backgroundImage = `url("${p.avatarImage}")`
    return
  }
  el.style.background = p.avatarColor
  el.textContent = p.avatarEmoji || avatarChar(fallbackName)
}

/** 渲染左下角账户区（无登录时隐藏） */
export function renderAccountSidebar(profile) {
  const has = !!profile
  $('#btn-profile').hidden = !has
  $('#acct-actions').hidden = !has
  if (!has) return
  const p = profile.profile
  paintAvatar($('#acct-avatar'), p, p.displayName)
  $('#acct-avatar').style.fontSize = p.avatarEmoji ? '16px' : ''
  $('#acct-label').textContent = p.displayName
}

// ---------------------------- 个人资料弹窗 ---------------------------------

const AVATAR_EMOJIS = ['', '🦊', '🐱', '🐼', '🦁', '🐶', '🐰', '🐯', '🐨', '🦄', '🐳', '🌟', '🔥', '💰', '🎯', '🎈']

let pfSelectedColor = '#d9480f'
let pfSelectedEmoji = ''
let pfSelectedImage = ''
let pfSelectedGender = 'secret'

let getCurrentProfile = () => null
let setCurrentProfile = () => {}
let openChangePassword = () => {}

export function initProfileUI(deps) {
  getCurrentProfile = deps.getCurrentProfile
  setCurrentProfile = deps.setCurrentProfile
  openChangePassword = deps.openChangePassword
}

function updatePfAvatar() {
  const av = $('#pf-avatar')
  av.style.backgroundRepeat = 'no-repeat'
  av.style.backgroundPosition = 'center'
  av.style.backgroundSize = 'cover'
  av.style.backgroundImage = ''
  if (pfSelectedImage) {
    av.textContent = ''
    av.style.background = pfSelectedColor
    av.style.backgroundImage = `url("${pfSelectedImage}")`
    return
  }
  av.style.background = pfSelectedColor
  if (pfSelectedEmoji) {
    av.textContent = pfSelectedEmoji
    av.style.fontSize = '30px'
  } else {
    av.textContent = avatarChar($('#pf-display').value)
    av.style.fontSize = ''
  }
}

async function openProfile() {
  let cp
  try {
    cp = await window.authAPI.getProfile()
  } catch (e) {
    showToast('读取资料失败：' + e.message, 'error')
    return
  }
  setCurrentProfile(cp)
  const { username, createdAt, profile } = cp
  $('#pf-username').value = username
  $('#pf-display').value = profile.displayName
  $('#pf-email').value = profile.email
  $('#pf-bio').value = profile.bio
  $('#pf-birthday').value = profile.birthday || ''
  $('#pf-city').value = profile.city
  $('#pf-phone').value = profile.phone
  $('#pf-occupation').value = profile.occupation
  $('#pf-website').value = profile.website
  $('#pf-budget').value = profile.monthlyBudget ? profile.monthlyBudget : ''
  $('#pf-goal').value = profile.financeGoal
  pfSelectedColor = profile.avatarColor
  pfSelectedEmoji = profile.avatarEmoji || ''
  pfSelectedImage = profile.avatarImage || ''
  pfSelectedGender = profile.gender || 'secret'

  // 每次打开先收起头像相关面板与菜单
  $('#pf-style-emoji').classList.add('hidden')
  $('#pf-style-color').classList.add('hidden')
  $('#avatar-menu-mask').classList.add('hidden')
  $('#crop-mask').classList.add('hidden')

  // 渲染 emoji 选项（首项为空 = 昵称首字模式）
  const emojis = $('#pf-emojis')
  emojis.innerHTML = ''
  for (const e of AVATAR_EMOJIS) {
    const dot = document.createElement('button')
    dot.type = 'button'
    dot.className = 'emoji-dot' + (e === pfSelectedEmoji ? ' active' : '')
    dot.textContent = e || '字'
    if (!e) dot.title = '使用昵称首字'
    dot.addEventListener('click', () => {
      // 再次点击已选表情则取消（回到昵称首字）；选择表情即放弃照片
      pfSelectedEmoji = pfSelectedEmoji === e ? '' : e
      pfSelectedImage = ''
      emojis.querySelectorAll('.emoji-dot').forEach((d, i) =>
        d.classList.toggle('active', AVATAR_EMOJIS[i] === pfSelectedEmoji))
      updatePfAvatar()
    })
    emojis.appendChild(dot)
  }

  // 渲染头像颜色块
  const colors = $('#pf-colors')
  colors.innerHTML = ''
  for (const c of AVATAR_COLORS) {
    const dot = document.createElement('button')
    dot.type = 'button'
    dot.className = 'color-dot' + (c === pfSelectedColor ? ' active' : '')
    dot.style.background = c
    dot.addEventListener('click', () => {
      pfSelectedColor = c
      colors.querySelectorAll('.color-dot').forEach((d) => d.classList.remove('active'))
      dot.classList.add('active')
      updatePfAvatar()
    })
    colors.appendChild(dot)
  }

  // 性别分段
  document.querySelectorAll('#pf-gender .seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.gender === pfSelectedGender)
    b.onclick = () => {
      pfSelectedGender = b.dataset.gender
      document.querySelectorAll('#pf-gender .seg-btn').forEach((x) => x.classList.remove('active'))
      b.classList.add('active')
    }
  })

  updatePfAvatar()
  $('#pf-created').textContent = '注册时间：' + new Date(createdAt).toLocaleDateString('zh-CN')
  $('#pf-error').textContent = ''
  $('#profile-mask').classList.remove('hidden')
  $('#pf-display').focus()
}

$('#btn-profile').addEventListener('click', openProfile)

// --------------------- Telegram 风格头像菜单 ---------------------

function openAvatarMenu() {
  $('#avatar-menu-mask').classList.remove('hidden')
  $('#am-emoji').focus()
}
$('#pf-avatar-btn').addEventListener('click', openAvatarMenu)
$('#am-cancel').addEventListener('click', () => $('#avatar-menu-mask').classList.add('hidden'))
$('#avatar-menu-mask').addEventListener('click', (e) => {
  if (e.target === $('#avatar-menu-mask')) $('#avatar-menu-mask').classList.add('hidden')
})

// 选择表情：展开 / 收起 emoji 面板
$('#am-emoji').addEventListener('click', () => {
  $('#avatar-menu-mask').classList.add('hidden')
  $('#pf-style-color').classList.add('hidden')
  $('#pf-style-emoji').classList.toggle('hidden')
})
// 背景颜色：展开 / 收起颜色面板
$('#am-color').addEventListener('click', () => {
  $('#avatar-menu-mask').classList.add('hidden')
  $('#pf-style-emoji').classList.add('hidden')
  $('#pf-style-color').classList.toggle('hidden')
})
// 删除照片 / 恢复默认（回到昵称首字）
$('#am-remove').addEventListener('click', () => {
  $('#avatar-menu-mask').classList.add('hidden')
  pfSelectedImage = ''
  pfSelectedEmoji = ''
  document.querySelectorAll('#pf-style-emoji,#pf-style-color').forEach((el) => el.classList.add('hidden'))
  updatePfAvatar()
})
// 上传照片：触发隐藏的文件选择框
$('#am-upload').addEventListener('click', () => {
  $('#avatar-menu-mask').classList.add('hidden')
  $('#avatar-file').click()
})

$('#avatar-file').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0]
  e.target.value = '' // 允许再次选择同一个文件
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => openCrop(reader.result)
  reader.onerror = () => showToast('读取图片失败，请换一张', 'error')
  reader.readAsDataURL(file)
})

// --------------------- 照片裁剪（拖动定位 + 缩放） ---------------------

const crop = { iw: 0, ih: 0, base: 1, zoom: 1, ox: 0, oy: 0, size: 0, drag: null }

function openCrop(src) {
  const img = $('#crop-img')
  img.onload = () => {
    crop.iw = img.naturalWidth
    crop.ih = img.naturalHeight
    crop.size = $('#crop-stage').clientWidth || 260
    // cover：让较短边填满裁剪框
    crop.base = Math.max(crop.size / crop.iw, crop.size / crop.ih)
    crop.zoom = 1
    crop.ox = 0
    crop.oy = 0
    $('#crop-zoom').value = 1
    clampCrop()
    renderCrop()
    $('#crop-mask').classList.remove('hidden')
    $('#crop-ok').focus()
  }
  img.onerror = () => showToast('图片加载失败，请换一张', 'error')
  img.src = src
}

function renderCrop() {
  const eff = crop.base * crop.zoom
  const img = $('#crop-img')
  img.style.width = crop.iw * eff + 'px'
  img.style.height = crop.ih * eff + 'px'
  img.style.transform = `translate(-50%, -50%) translate(${crop.ox}px, ${crop.oy}px)`
}

// 限制拖动范围，保证照片始终覆盖裁剪框、不露空白
function clampCrop() {
  const eff = crop.base * crop.zoom
  const w = crop.iw * eff
  const h = crop.ih * eff
  const mx = Math.max(0, (w - crop.size) / 2)
  const my = Math.max(0, (h - crop.size) / 2)
  crop.ox = Math.min(mx, Math.max(-mx, crop.ox))
  crop.oy = Math.min(my, Math.max(-my, crop.oy))
}

$('#crop-zoom').addEventListener('input', () => {
  crop.zoom = Number($('#crop-zoom').value)
  clampCrop()
  renderCrop()
})

// 滚轮缩放（Telegram 桌面体验）
$('#crop-stage').addEventListener('wheel', (e) => {
  e.preventDefault()
  const z = Math.min(3, Math.max(1, crop.zoom + (e.deltaY < 0 ? 0.08 : -0.08)))
  crop.zoom = z
  $('#crop-zoom').value = z
  clampCrop()
  renderCrop()
}, { passive: false })

// 拖动定位
$('#crop-stage').addEventListener('mousedown', (e) => {
  e.preventDefault()
  crop.drag = { x: e.clientX, y: e.clientY, ox: crop.ox, oy: crop.oy }
})
window.addEventListener('mousemove', (e) => {
  if (!crop.drag) return
  crop.ox = crop.drag.ox + (e.clientX - crop.drag.x)
  crop.oy = crop.drag.oy + (e.clientY - crop.drag.y)
  clampCrop()
  renderCrop()
})
window.addEventListener('mouseup', () => { crop.drag = null })

$('#crop-cancel').addEventListener('click', () => $('#crop-mask').classList.add('hidden'))
$('#crop-mask').addEventListener('click', (e) => {
  if (e.target === $('#crop-mask')) $('#crop-mask').classList.add('hidden')
})

// 确定：按当前缩放 / 位置输出 256×256 正方形 JPEG
$('#crop-ok').addEventListener('click', () => {
  const eff = crop.base * crop.zoom
  const srcSize = crop.size / eff
  // 裁剪框中心对应的图片坐标（图片中心随拖动 ox,oy 偏移）
  const cx = crop.iw / 2 - crop.ox / eff
  const cy = crop.ih / 2 - crop.oy / eff
  let sx = cx - srcSize / 2
  let sy = cy - srcSize / 2
  sx = Math.max(0, Math.min(crop.iw - srcSize, sx))
  sy = Math.max(0, Math.min(crop.ih - srcSize, sy))
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage($('#crop-img'), sx, sy, srcSize, srcSize, 0, 0, 256, 256)
  const url = canvas.toDataURL('image/jpeg', 0.85)
  if (!/^data:image\/jpeg;base64,/.test(url)) { showToast('头像生成失败，请重试', 'error'); return }
  pfSelectedImage = url
  $('#crop-mask').classList.add('hidden')
  updatePfAvatar()
})

// 昵称输入实时更新头像预览（仅首字模式）
$('#pf-display').addEventListener('input', updatePfAvatar)

// 修改登录用户名
$('#pf-btn-username').addEventListener('click', async () => {
  const name = await askText('输入新的登录用户名', $('#pf-username').value)
  if (name === null) return
  try {
    const res = await window.authAPI.changeUsername(name)
    $('#pf-username').value = res.username
    $('#pf-display').value = res.profile.displayName
    const cp = getCurrentProfile()
    if (cp) {
      cp.username = res.username
      cp.profile = res.profile
    }
    renderAccountSidebar(cp)
    updatePfAvatar()
  } catch (e) {
    showToast('修改失败：' + e.message, 'error')
  }
})

// 从资料弹窗跳转到修改密码
$('#pf-btn-pw').addEventListener('click', () => {
  $('#profile-mask').classList.add('hidden')
  openChangePassword()
})

$('#pf-cancel').addEventListener('click', () => $('#profile-mask').classList.add('hidden'))
$('#profile-mask').addEventListener('click', (e) => {
  if (e.target === $('#profile-mask')) $('#profile-mask').classList.add('hidden')
})

// 保存个人资料
$('#pf-save').addEventListener('click', async () => {
  const errEl = $('#pf-error')
  errEl.textContent = ''
  try {
    const profile = await window.authAPI.updateProfile({
      displayName: $('#pf-display').value,
      avatarColor: pfSelectedColor,
      avatarEmoji: pfSelectedEmoji,
      avatarImage: pfSelectedImage,
      gender: pfSelectedGender,
      birthday: $('#pf-birthday').value,
      city: $('#pf-city').value,
      phone: $('#pf-phone').value,
      occupation: $('#pf-occupation').value,
      website: $('#pf-website').value,
      bio: $('#pf-bio').value,
      monthlyBudget: $('#pf-budget').value,
      financeGoal: $('#pf-goal').value
    })
    const cp = getCurrentProfile()
    if (cp) cp.profile = profile
    renderAccountSidebar(cp)
    $('#profile-mask').classList.add('hidden')
  } catch (e) {
    errEl.textContent = e.message || String(e)
  }
})

bindModalEsc($('#profile-mask'), () => $('#profile-mask').classList.add('hidden'))
bindModalEsc($('#avatar-menu-mask'), () => $('#avatar-menu-mask').classList.add('hidden'))
bindModalEsc($('#crop-mask'), () => $('#crop-mask').classList.add('hidden'))
