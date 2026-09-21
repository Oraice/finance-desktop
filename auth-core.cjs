'use strict'
// ---------------------------------------------------------------------------
// auth-core.cjs —— 本机账户体系的安全内核（纯逻辑，主进程调用，Node 可单测）
// 算法选型即当前业界通行做法：随机盐 + scrypt(N=16384,r=8,p=1) + 恒定时间比较，
// 密码任何形式都不落明文；失败计数与时间窗锁定防暴力试探。
// ---------------------------------------------------------------------------

const crypto = require('crypto')

const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const KEYLEN = 64
const MAX_FAIL = 5           // 连续失败次数上限
const LOCK_MS = 60 * 1000    // 锁定时长 60s

// 可选头像颜色（与渲染层色板一致）
const AVATAR_COLORS = ['#d9480f', '#1971c2', '#2f9e44', '#9c36b5', '#e8590c', '#1098ad', '#be4bdb', '#f08c00']
const DEFAULT_AVATAR = '#d9480f'

function newSalt() {
  return crypto.randomBytes(16).toString('hex')
}

/** 密码 → scrypt 哈希（hex）。同一密码不同盐结果不同（防彩虹表）。 */
function hashPassword(password, salt) {
  return crypto
    .scryptSync(String(password), salt, KEYLEN, SCRYPT_OPTS)
    .toString('hex')
}

/** 恒定时间比较，防时序侧信道 */
function verifyPassword(password, salt, expectedHash) {
  const got = Buffer.from(hashPassword(password, salt), 'hex')
  let want
  try { want = Buffer.from(String(expectedHash), 'hex') } catch { return false }
  return got.length === want.length && crypto.timingSafeEqual(got, want)
}

/** 用户名：2-20 位，中文/字母/数字/下划线 */
function validateUsername(name) {
  const v = String(name || '').trim()
  if (!v) return { ok: false, reason: '用户名不能为空' }
  if (v.length < 2 || v.length > 20) return { ok: false, reason: '用户名需 2-20 个字符' }
  if (!/^[\w一-龥]+$/.test(v)) return { ok: false, reason: '用户名只能用中文、字母、数字或下划线' }
  return { ok: true, value: v }
}

/**
 * 密码强度（通用规则）：8-64 位，且至少包含 字母/数字/符号 中的两类
 * 返回 {ok, level}，level: 0-4，供 UI 画强度条
 */
function validatePassword(pw) {
  const v = String(pw || '')
  if (v.length < 8) return { ok: false, reason: '密码至少 8 位' }
  if (v.length > 64) return { ok: false, reason: '密码最长 64 位' }
  const kinds =
    (/[a-z]/.test(v) ? 1 : 0) + (/[A-Z]/.test(v) ? 1 : 0) +
    (/\d/.test(v) ? 1 : 0) + (/[^A-Za-z0-9]/.test(v) ? 1 : 0)
  if (kinds < 2) return { ok: false, reason: '密码需包含字母、数字、符号中至少两类' }
  return { ok: true, level: kinds }
}

/** 锁定判定（纯函数）：给定账户计数状态与当前时间 */
function checkLock(acc, now = Date.now()) {
  if (acc.lockedUntil && acc.lockedUntil > now) {
    return { locked: true, remainingMs: acc.lockedUntil - now }
  }
  return { locked: false, remainingMs: 0 }
}

/** 记一次失败：返回更新后的状态（达到上限则上锁） */
function registerFailure(acc, now = Date.now()) {
  const failedCount = (acc.failedCount || 0) + 1
  const out = { ...acc, failedCount }
  if (failedCount >= MAX_FAIL) {
    out.lockedUntil = now + LOCK_MS
    out.failedCount = 0 // 上锁即清零计数，解锁后重新计
  }
  return out
}

/** 登录成功清零失败计数 */
function clearFailures(acc) {
  return { ...acc, failedCount: 0, lockedUntil: 0 }
}

/**
 * 个人资料校验（纯函数）。
 * 基本资料：昵称（必填）、头像颜色、头像 emoji、邮箱、性别、生日、城市、
 * 手机、职业、个人网站、简介；
 * 财务资料：每月预算、财务目标。
 * 所有选填项留空即不校验；非法枚举回退默认值。返回 { ok, value, reason }
 */
function validateProfile(patch = {}) {
  const displayName = String(patch.displayName || '').trim()
  if (!displayName) return { ok: false, reason: '昵称不能为空' }
  if (displayName.length > 20) return { ok: false, reason: '昵称最多 20 个字符' }

  let avatarColor = String(patch.avatarColor || '').trim()
  if (!AVATAR_COLORS.includes(avatarColor)) avatarColor = DEFAULT_AVATAR

  // emoji 头像：最多 2 个码位（兼容组合 emoji），为空则用昵称首字
  const avatarEmoji = Array.from(String(patch.avatarEmoji || '').trim()).slice(0, 2).join('')

  // 头像照片：空 或 data:image/(jpeg|png|webp);base64，长度上限约 30 万字符（≈220KB）
  const avatarImage = String(patch.avatarImage || '')
  if (avatarImage) {
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(avatarImage)) {
      return { ok: false, reason: '头像图片格式不正确' }
    }
    if (avatarImage.length > 300000) return { ok: false, reason: '头像图片过大，请重新裁剪' }
  }

  const email = String(patch.email || '').trim()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, reason: '邮箱格式不正确' }
  }
  if (email.length > 60) return { ok: false, reason: '邮箱太长了' }

  const GENDERS = ['secret', 'male', 'female']
  let gender = String(patch.gender || 'secret')
  if (!GENDERS.includes(gender)) gender = 'secret'

  const birthday = String(patch.birthday || '').trim()
  if (birthday) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday) || Number.isNaN(Date.parse(birthday))) {
      return { ok: false, reason: '生日日期格式不正确' }
    }
    if (Date.parse(birthday) > Date.now()) return { ok: false, reason: '生日不能晚于今天' }
  }

  const city = String(patch.city || '').trim()
  if (city.length > 20) return { ok: false, reason: '城市名称最多 20 个字符' }

  const phone = String(patch.phone || '').trim()
  if (phone && !/^1[3-9]\d{9}$/.test(phone)) {
    return { ok: false, reason: '手机号格式不正确（11 位大陆手机号）' }
  }

  const occupation = String(patch.occupation || '').trim()
  if (occupation.length > 20) return { ok: false, reason: '职业名称最多 20 个字符' }

  const website = String(patch.website || '').trim()
  if (website) {
    if (!/^https?:\/\/[^\s]+$/i.test(website)) {
      return { ok: false, reason: '个人网站需以 http:// 或 https:// 开头' }
    }
    if (website.length > 120) return { ok: false, reason: '个人网站地址太长了' }
  }

  const bio = String(patch.bio || '').trim()
  if (bio.length > 100) return { ok: false, reason: '个人简介最多 100 个字符' }

  // 每月预算：非负数字，上限 1 亿；空/非法按 0 处理
  let monthlyBudget = Number(patch.monthlyBudget)
  if (!Number.isFinite(monthlyBudget) || monthlyBudget < 0) monthlyBudget = 0
  if (monthlyBudget > 100000000) return { ok: false, reason: '每月预算超出合理范围' }
  monthlyBudget = Math.round(monthlyBudget * 100) / 100

  const financeGoal = String(patch.financeGoal || '').trim()
  if (financeGoal.length > 50) return { ok: false, reason: '财务目标最多 50 个字符' }

  // 分类预算：{ 分类名: 月限额 }，非法条目在 normalizeCategoryBudgets 中剔除
  const categoryBudgets = normalizeCategoryBudgets(patch.categoryBudgets)

  // 账单 / 还款提醒：开关 + 提前天数（0-30，默认 3）
  const remindersEnabled = patch.remindersEnabled !== false
  let reminderDays = parseInt(patch.reminderDays, 10)
  if (!(reminderDays >= 0 && reminderDays <= 30)) reminderDays = 3

  return {
    ok: true,
    value: {
      displayName, avatarColor, avatarEmoji, avatarImage, email, gender, birthday,
      city, phone, occupation, website, bio, monthlyBudget, financeGoal, categoryBudgets,
      remindersEnabled, reminderDays
    }
  }
}

/**
 * 分类预算规整（纯函数）：{ 分类名: 月限额 }
 * - 必须是普通对象（数组/原始值按空处理）
 * - 条目最多 20 条；分类名 1-10 字；金额为正数（≤1 亿）
 * - 名称为空/超长、金额非正/非法/超限的条目直接剔除；金额保留两位小数
 */
const MAX_CAT_BUDGETS = 20
function normalizeCategoryBudgets(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out = {}
  let count = 0
  for (const [k, v] of Object.entries(raw)) {
    const name = String(k || '').trim()
    if (!name || name.length > 10) continue
    const amt = Number(v)
    if (!Number.isFinite(amt) || amt <= 0 || amt > 100000000) continue
    if (count >= MAX_CAT_BUDGETS) break
    out[name] = Math.round(amt * 100) / 100
    count++
  }
  return out
}

/** 老账户兼容：补全资料默认字段（纯函数，返回新对象） */
function defaultProfile(acc) {
  const p = acc.profile || {}
  return {
    ...acc,
    profile: {
      displayName: p.displayName || acc.username,
      avatarColor: p.avatarColor || DEFAULT_AVATAR,
      avatarEmoji: p.avatarEmoji || '',
      avatarImage: p.avatarImage || '',
      email: p.email || '',
      gender: p.gender || 'secret',
      birthday: p.birthday || '',
      city: p.city || '',
      phone: p.phone || '',
      occupation: p.occupation || '',
      website: p.website || '',
      bio: p.bio || '',
      monthlyBudget: Number.isFinite(Number(p.monthlyBudget)) ? Number(p.monthlyBudget) : 0,
      financeGoal: p.financeGoal || '',
      categoryBudgets: normalizeCategoryBudgets(p.categoryBudgets),
      remindersEnabled: p.remindersEnabled !== false,
      reminderDays: Number.isFinite(Number(p.reminderDays)) ? Number(p.reminderDays) : 3
    }
  }
}

module.exports = {
  SCRYPT_OPTS, MAX_FAIL, LOCK_MS, AVATAR_COLORS, DEFAULT_AVATAR,
  newSalt, hashPassword, verifyPassword,
  validateUsername, validatePassword,
  checkLock, registerFailure, clearFailures,
  validateProfile, defaultProfile,
  normalizeCategoryBudgets, MAX_CAT_BUDGETS
}
