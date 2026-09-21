'use strict'
// ---------------------------------------------------------------------------
// settings-core.cjs —— 应用级个性化设置的校验内核（纯逻辑，主进程调用，可单测）
// 管理：
//   应用显示名称 appName、品牌 logo appLogo、账本图标 iconImage；
//   崩溃诊断 crashLocalLog（仅本机记录，默认开）、crashUpload（自动上报，默认关）、
//   crashEndpoint（上报地址，默认空）。
// 图片统一为 data:image/(jpeg|png|webp);base64 并限制大小，防止设置文件膨胀。
// ---------------------------------------------------------------------------

const DEFAULT_APP_NAME = '财账簿'
const MAX_NAME = 20
const MAX_IMG_CHARS = 300000
const MAX_ENDPOINT = 300

/** 校验图片 dataURL：allowEmpty=true 时空串合法（返回 value:''） */
function validateDataImage(v, allowEmpty = true) {
  const s = String(v || '')
  if (!s) {
    return allowEmpty
      ? { ok: true, value: '' }
      : { ok: false, reason: '图片不能为空' }
  }
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s)) {
    return { ok: false, reason: '图片格式不正确' }
  }
  if (s.length > MAX_IMG_CHARS) return { ok: false, reason: '图片过大，请重新裁剪' }
  return { ok: true, value: s }
}

/** 布尔字段：缺省取默认值，其余强制转 boolean */
function toBool(v, dft) {
  return v === undefined || v === null ? dft : !!v
}

/** 上报地址：空串允许（=不发送）；非空须为 http(s) URL */
function normalizeEndpoint(v) {
  const s = String(v || '').trim()
  if (!s) return { ok: true, value: '' }
  if (s.length > MAX_ENDPOINT) return { ok: false, reason: '上报地址过长' }
  if (!/^https?:\/\//i.test(s)) return { ok: false, reason: '上报地址需以 http:// 或 https:// 开头' }
  return { ok: true, value: s }
}

/** 应用设置：appName（1-20 字）、appLogo（空=默认 🦞）、崩溃诊断开关 */
function normalizeSettings(patch = {}) {
  const appName = String(patch.appName || '').trim()
  if (!appName) return { ok: false, reason: '应用名称不能为空' }
  if (appName.length > MAX_NAME) {
    return { ok: false, reason: `应用名称最多 ${MAX_NAME} 个字符` }
  }
  const logo = validateDataImage(patch.appLogo)
  if (!logo.ok) return { ok: false, reason: logo.reason }
  const endpoint = normalizeEndpoint(patch.crashEndpoint)
  if (!endpoint.ok) return { ok: false, reason: endpoint.reason }
  return {
    ok: true,
    value: {
      appName,
      appLogo: logo.value,
      crashLocalLog: toBool(patch.crashLocalLog, true),
      crashUpload: toBool(patch.crashUpload, false),
      crashEndpoint: endpoint.value
    }
  }
}

/** 账本图标：允许空（空=默认 📒） */
function validateLedgerIcon(v) {
  return validateDataImage(v, true)
}

/** 合并默认设置（文件缺失 / 老用户补全，非法 logo 丢弃，名称回退默认） */
function defaultSettings(raw = {}) {
  const r = raw || {}
  const logo = validateDataImage(r.appLogo)
  const endpoint = normalizeEndpoint(r.crashEndpoint)
  return {
    appName: String(r.appName || '').trim() || DEFAULT_APP_NAME,
    appLogo: logo.ok ? logo.value : '',
    crashLocalLog: toBool(r.crashLocalLog, true),
    crashUpload: toBool(r.crashUpload, false),
    crashEndpoint: endpoint.ok ? endpoint.value : ''
  }
}

module.exports = {
  DEFAULT_APP_NAME, MAX_NAME, MAX_IMG_CHARS,
  validateDataImage, normalizeSettings, validateLedgerIcon, defaultSettings,
  normalizeEndpoint
}
