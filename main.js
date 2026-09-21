'use strict'

const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, nativeImage, screen } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const auth = require('./auth-core.cjs')
const backup = require('./backup-core.cjs')
const settingsCore = require('./settings-core.cjs')
const { createCrashReporter } = require('./crash-reporter.cjs')
const { atomicWrite, atomicWriteJson, readJsonOrQuarantine: readJsonFile } = require('./file-store.cjs')

// 冒烟模式：electron . --smoke。无头加载页面、确认渲染脚本能跑通后自动退出。
const IS_SMOKE = process.argv.includes('--smoke')
// 端到端模式：electron . --e2e。使用独立临时 userData 跑完整业务链路。
const IS_E2E = process.argv.includes('--e2e')
let e2eTempDir = null
if (IS_E2E) {
  e2eTempDir = path.join(os.tmpdir(), 'czb-e2e-' + Date.now().toString(36))
  app.setPath('userData', e2eTempDir) // 须在 ready 与单实例锁前；独立锁不与真实实例冲突
}

// ---------------------------------------------------------------------------
// 单实例锁：重复启动时唤起已有窗口并退出新进程。
// 两个实例同时运行会抢 GPU 缓存目录（报 cache_util_win 拒绝访问 0x5），
// 更危险的是各自内存里持有一份账本，后保存的会覆盖先保存的。
// 注：被退出的第二实例在退出前可能仍往 stderr 打几行缓存告警（Electron 在
// 跑 JS 前就初始化了缓存），无害且窗口会闪现即退；打包成 GUI 应用后不可见。
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

// ---------------------------------------------------------------------------
// 账本本地持久化：每套账本一个 JSON 文件，存放于 userData/ledgers/
// 数据全程留在本机，主进程之外无任何网络请求。
// ---------------------------------------------------------------------------

const LEDGER_DIR = () => path.join(app.getPath('userData'), 'ledgers')

function ensureLedgerDir() {
  const dir = LEDGER_DIR()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function ledgerFile(id) {
  // id 只允许安全字符，防目录穿越
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(id))) {
    throw new Error('非法账本 ID')
  }
  return path.join(ensureLedgerDir(), `${id}.json`)
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// 原子写入 / JSON 原子写入统一由 file-store.cjs 提供（顶部解构为 atomicWrite / atomicWriteJson）。

function logDataIssue(msg) {
  try {
    fs.appendFileSync(
      path.join(app.getPath('userData'), 'data-issues.log'),
      `[${new Date().toISOString()}] ${msg}\n`
    )
  } catch { /* 日志失败不影响主流程 */ }
}

/** 读取 JSON；损坏则隔离坏文件并把事件记入本机日志（实现见 file-store.cjs）。 */
const readJsonOrQuarantine = (file) => readJsonFile(file, logDataIssue)

function readLedger(id) {
  const file = ledgerFile(id)
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('账本不存在')
    throw e
  }
  try {
    return JSON.parse(text)
  } catch {
    return recoverLedgerOrThrow(id, file)
  }
}

/** 账本损坏：先隔离坏文件，再从最近的自动备份回填该账本；都失败则抛友好错误。 */
function recoverLedgerOrThrow(id, file) {
  const corrupt = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`
  try { fs.renameSync(file, corrupt) } catch { /* 隔离失败也继续尝试恢复 */ }
  logDataIssue(`账本 ${id} 解析失败，已隔离为：${corrupt}`)

  if (recoverLedgerFromAutoBackup(id)) {
    logDataIssue(`账本 ${id} 已从最近自动备份恢复`)
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  }
  throw new Error('账本数据已损坏，且未找到可恢复的自动备份，请在「报表」页用「恢复数据」选择备份文件')
}

/** 从最近的自动备份（明文）中找到指定账本并原子回填，成功返回 true。 */
function recoverLedgerFromAutoBackup(id) {
  try {
    const dir = BACKUP_DIR()
    if (!fs.existsSync(dir)) return false
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('auto-') && f.endsWith('.finbak'))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    for (const item of files) {
      try {
        const b = backup.parseBackup(fs.readFileSync(path.join(dir, item.f), 'utf8'), '')
        const found = (b.ledgers || []).find((l) => l.id === id)
        if (found) {
          atomicWriteJson(ledgerFile(id), found)
          return true
        }
      } catch { /* 该备份不可用，继续试更早的 */ }
    }
  } catch { /* 恢复流程自身异常则交由上层抛错 */ }
  return false
}

function writeLedger(ledger) {
  ledger.updatedAt = Date.now()
  atomicWrite(ledgerFile(ledger.id), JSON.stringify(ledger, null, 2))
  return ledger
}

// ---------------------------------------------------------------------------
// 本机账户：每账户一个 JSON（userData/accounts/<id>.json），只存 scrypt 哈希+盐。
// 会话状态保存在主进程内存（session），渲染进程无法伪造账户身份。
// 自动登录：勾选后密码经 safeStorage（Windows DPAPI，绑定本机本用户）加密存
// 在账户文件 encPass 字段，启动时解密验证通过才免密进入。
// ---------------------------------------------------------------------------

const ACCOUNT_DIR = () => path.join(app.getPath('userData'), 'accounts')
let session = null // { accountId, username }

function accountFile(id) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(id))) throw new Error('非法账户 ID')
  return path.join(ACCOUNT_DIR(), `${id}.json`)
}

function allAccounts() {
  const dir = ACCOUNT_DIR()
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJsonOrQuarantine(path.join(dir, f)))
    .filter(Boolean)
}

function findAccountByName(username) {
  const key = String(username || '').trim().toLowerCase()
  return allAccounts().find((a) => String(a.username).toLowerCase() === key) || null
}

function saveAccount(acc) {
  acc.updatedAt = Date.now()
  atomicWrite(accountFile(acc.id), JSON.stringify(acc, null, 2))
  return acc
}

function requireSession() {
  if (!session) throw new Error('请先登录')
  return session
}

/** 账本归属校验：非本账户账本一律拒绝（含早期无主的历史账本） */
function readOwnLedger(id) {
  const s = requireSession()
  const ledger = readLedger(id)
  if (ledger.ownerId !== s.accountId) throw new Error('无权访问该账本')
  return ledger
}

function encryptPassword(pw) {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(String(pw)).toString('base64')
    }
  } catch { /* 加密不可用则退化为不存储 */ }
  return null
}

function decryptPassword(b64) {
  try {
    if (b64 && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(b64, 'base64'))
    }
  } catch { /* ignore */ }
  return null
}

// ------------------------------- IPC --------------------------------------

// ------------------------------ 认证 IPC -----------------------------------

// 注意：这两个 handler 用返回值而非 throw 表达失败（含 lockRemainingMs，
// Error 自定义属性经 IPC 序列化会丢失）
ipcMain.handle('auth:register', (_e, username, password, autoLogin) => {
  const nu = auth.validateUsername(username)
  if (!nu.ok) return { ok: false, error: nu.reason }
  const np = auth.validatePassword(password)
  if (!np.ok) return { ok: false, error: np.reason }
  if (findAccountByName(nu.value)) return { ok: false, error: '该用户名已被注册' }
  const isFirst = allAccounts().length === 0
  const acc = {
    id: auth_newAccountId(),
    username: nu.value,
    salt: auth.newSalt(),
    hash: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    failedCount: 0,
    lockedUntil: 0,
    autoLogin: !!autoLogin,
    encPass: null,
    profile: {
      displayName: nu.value,
      avatarColor: '#d9480f',
      avatarEmoji: '',
      email: '',
      gender: 'secret',
      birthday: '',
      city: '',
      phone: '',
      occupation: '',
      website: '',
      bio: '',
      monthlyBudget: 0,
      financeGoal: ''
    }
  }
  acc.hash = auth.hashPassword(password, acc.salt)
  if (acc.autoLogin) acc.encPass = encryptPassword(password)
  saveAccount(acc)
  // 第一个账户自动继承历史无主账本（升级前的老数据不丢）
  if (isFirst) migrateLegacyLedgers(acc.id)
  session = { accountId: acc.id, username: acc.username }
  return { ok: true, username: acc.username }
})

ipcMain.handle('auth:login', (_e, username, password, autoLogin) => {
  const acc = findAccountByName(username)
  if (!acc) return { ok: false, error: '用户名或密码错误' }
  const lock = auth.checkLock(acc)
  if (lock.locked) return { ok: false, error: '失败次数过多，账户已锁定', lockRemainingMs: lock.remainingMs }
  if (!auth.verifyPassword(password, acc.salt, acc.hash)) {
    const next = auth.registerFailure(acc)
    saveAccount(next)
    const l2 = auth.checkLock(next)
    if (l2.locked) {
      return { ok: false, error: '失败次数过多，账户已锁定 60 秒', lockRemainingMs: l2.remainingMs }
    }
    const left = auth.MAX_FAIL - next.failedCount
    return { ok: false, error: `用户名或密码错误（还可尝试 ${left} 次）` }
  }
  const done = auth.clearFailures(acc)
  done.autoLogin = !!autoLogin
  done.encPass = autoLogin ? encryptPassword(password) : null
  saveAccount(done)
  session = { accountId: done.id, username: done.username }
  return { ok: true, username: done.username, autoLogin: done.autoLogin }
})

/** 应用启动时尝试免密自动登录 */
ipcMain.handle('auth:auto', () => {
  if (session) return { username: session.username }
  const acc = allAccounts().find((a) => a.autoLogin && a.encPass)
  if (!acc) return null
  const pw = decryptPassword(acc.encPass)
  if (pw === null || !auth.verifyPassword(pw, acc.salt, acc.hash)) return null
  session = { accountId: acc.id, username: acc.username }
  return { username: acc.username }
})

/**
 * 退出登录：清空内存会话；同时取消该账户的自动登录并删除本机保存的加密密码。
 * 否则勾选过免密的账户在页面重载/重启后会被再次自动拉进应用，“退出”形同虚设。
 */
ipcMain.handle('auth:logout', () => {
  if (session) {
    const acc = allAccounts().find((a) => a.id === session.accountId)
    if (acc && (acc.autoLogin || acc.encPass)) {
      acc.autoLogin = false
      acc.encPass = null
      saveAccount(acc)
    }
  }
  session = null
  return true
})

ipcMain.handle('auth:changePassword', (_e, oldPw, newPw) => {
  const s = requireSession()
  const acc = allAccounts().find((a) => a.id === s.accountId)
  if (!acc) throw new Error('账户不存在')
  if (!auth.verifyPassword(oldPw, acc.salt, acc.hash)) throw new Error('原密码不正确')
  const np = auth.validatePassword(newPw)
  if (!np.ok) throw new Error(np.reason)
  acc.salt = auth.newSalt()
  acc.hash = auth.hashPassword(newPw, acc.salt)
  if (acc.autoLogin && acc.encPass) acc.encPass = encryptPassword(newPw) // 记住的凭证同步更新
  saveAccount(acc)
  return true
})

/** 是否已有账户（渲染层决定显示「注册」还是「登录」默认页签） */
ipcMain.handle('auth:hasAccounts', () => allAccounts().length > 0)

/** 获取当前登录账户的个人信息（不回传哈希、盐等敏感字段） */
ipcMain.handle('auth:getProfile', () => {
  const s = requireSession()
  const found = allAccounts().find((a) => a.id === s.accountId)
  if (!found) throw new Error('账户不存在')
  const acc = auth.defaultProfile(found)
  return {
    username: acc.username,
    createdAt: acc.createdAt,
    autoLogin: !!acc.autoLogin,
    profile: acc.profile
  }
})

/** 更新个人资料：昵称、头像颜色、邮箱、简介 */
ipcMain.handle('auth:updateProfile', (_e, patch) => {
  const s = requireSession()
  const found = allAccounts().find((a) => a.id === s.accountId)
  if (!found) throw new Error('账户不存在')
  const checked = auth.validateProfile(patch)
  if (!checked.ok) throw new Error(checked.reason)
  found.profile = checked.value
  saveAccount(found)
  return found.profile
})

/** 修改登录用户名（登录凭证，需校验重名） */
ipcMain.handle('auth:changeUsername', (_e, newName) => {
  const s = requireSession()
  const nu = auth.validateUsername(newName)
  if (!nu.ok) throw new Error(nu.reason)
  const dup = allAccounts().find((a) => a.username.toLowerCase() === nu.value.toLowerCase() && a.id !== s.accountId)
  if (dup) throw new Error('该用户名已被占用')
  const found = allAccounts().find((a) => a.id === s.accountId)
  if (!found) throw new Error('账户不存在')
  const oldName = found.username
  found.username = nu.value
  const acc = auth.defaultProfile(found)
  // 昵称若仍等于旧用户名（用户未自定义），则跟随更新
  if (acc.profile.displayName === oldName) acc.profile.displayName = nu.value
  saveAccount(acc)
  session = { accountId: acc.id, username: acc.username }
  return { username: acc.username, profile: acc.profile }
})

function auth_newAccountId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }

function migrateLegacyLedgers(accountId) {
  try {
    const dir = LEDGER_DIR()
    if (!fs.existsSync(dir)) return
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      try {
        const p = path.join(dir, f)
        const l = JSON.parse(fs.readFileSync(p, 'utf8'))
        if (!l.ownerId) {
          l.ownerId = accountId
          atomicWrite(p, JSON.stringify(l, null, 2))
        }
      } catch { /* 单个损坏文件跳过 */ }
    }
  } catch { /* 迁移失败不阻塞注册 */ }
}

ipcMain.handle('ledger:list', () => {
  const s = requireSession()
  const dir = ensureLedgerDir()
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const l = readJsonOrQuarantine(path.join(dir, f))
      if (!l || l.ownerId !== s.accountId) return null // 损坏文件已隔离；非本账户账本不显示
      return {
        id: l.id,
        name: l.name,
        iconImage: l.iconImage || '',
        createdAt: l.createdAt || 0,
        updatedAt: l.updatedAt || 0,
        recordCount: (l.records || []).length
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt)
})

ipcMain.handle('ledger:create', (_e, name, iconImage) => {
  const s = requireSession()
  const trimmed = String(name || '').trim()
  if (!trimmed) throw new Error('账本名称不能为空')
  const icon = settingsCore.validateLedgerIcon(iconImage)
  if (!icon.ok) throw new Error(icon.reason)
  const ledger = {
    id: newId(),
    ownerId: s.accountId,
    name: trimmed,
    iconImage: icon.value,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    records: [],
    accounts: [],   // 资金账户（现金/储蓄卡/信用卡/负债等）
    transfers: [],  // 账户间转账记录
    recurring: [],  // 周期记账模板
    reconciliations: [] // 账户对账记录
  }
  writeLedger(ledger)
  return ledger
})

ipcMain.handle('ledger:get', (_e, id) => readOwnLedger(id))

/** 一次获取当前账户的全部完整账本（供多账本汇总视图） */
ipcMain.handle('ledger:getAll', () => {
  const s = requireSession()
  const dir = ensureLedgerDir()
  const out = []
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const l = readJsonOrQuarantine(path.join(dir, f))
    if (l && l.ownerId === s.accountId) out.push(l)
  }
  return out
})

ipcMain.handle('ledger:rename', (_e, id, name, iconImage) => {
  const trimmed = String(name || '').trim()
  if (!trimmed) throw new Error('账本名称不能为空')
  const icon = settingsCore.validateLedgerIcon(iconImage)
  if (!icon.ok) throw new Error(icon.reason)
  const ledger = readOwnLedger(id)
  ledger.name = trimmed
  ledger.iconImage = icon.value
  return writeLedger(ledger)
})

ipcMain.handle('ledger:delete', (_e, id) => {
  readOwnLedger(id)
  fs.unlinkSync(ledgerFile(id)) // 应用内数据：软删除逻辑留给账本回收（后续阶段），此处按用户指令移除文件
  return true
})

/** 撤销删除账本：按原 id 写回完整账本（仅当该文件已不存在） */
ipcMain.handle('ledger:restoreFile', (_e, ledger) => {
  const s = requireSession()
  if (!ledger || ledger.id == null || ledger.ownerId == null) throw new Error('账本数据不完整')
  if (ledger.ownerId !== s.accountId) throw new Error('无权恢复该账本')
  const file = ledgerFile(ledger.id)
  if (fs.existsSync(file)) throw new Error('该账本已存在，无需恢复')
  writeLedger(ledger)
  return { ok: true }
})

ipcMain.handle('records:save', (_e, id, records, batches) => {
  const ledger = readOwnLedger(id)
  if (!Array.isArray(records)) throw new Error('records 必须是数组')
  ledger.records = records
  if (Array.isArray(batches)) ledger.batches = batches // 导入批次元数据：供历史展示与一键撤销
  writeLedger(ledger)
  return { ok: true, count: records.length }
})

// 资金账户与转账保存（账户/转账数据挂在账本内）
ipcMain.handle('funds:save', (_e, id, accounts, transfers) => {
  const ledger = readOwnLedger(id)
  if (!Array.isArray(accounts) || !Array.isArray(transfers)) {
    throw new Error('账户与转账必须是数组')
  }
  ledger.accounts = accounts
  ledger.transfers = transfers
  writeLedger(ledger)
  return { ok: true }
})

// 周期记账模板保存（挂在账本内）
ipcMain.handle('recurring:save', (_e, id, recurring) => {
  const ledger = readOwnLedger(id)
  if (!Array.isArray(recurring)) throw new Error('周期模板必须是数组')
  ledger.recurring = recurring
  writeLedger(ledger)
  return { ok: true }
})

// 账户对账记录保存（挂在账本内）
ipcMain.handle('reconcile:save', (_e, id, reconciliations) => {
  const ledger = readOwnLedger(id)
  if (!Array.isArray(reconciliations)) throw new Error('对账记录必须是数组')
  ledger.reconciliations = reconciliations
  writeLedger(ledger)
  return { ok: true }
})

// 报表导出：弹系统“另存为”，把渲染进程生成的字节流写入用户选择的位置（仍然全程本机）
ipcMain.handle('export:save', async (e, fileName, bytes) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: '导出财务报表',
    defaultPath: String(fileName || '财务报表.xlsx'),
    filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
  })
  if (canceled || !filePath) return { ok: false, canceled: true }
  await fs.promises.writeFile(filePath, Buffer.from(bytes))
  return { ok: true, path: filePath }
})

// PDF 月报导出：渲染层生成自包含 HTML，隐藏窗口加载后 printToPDF，再保存
ipcMain.handle('report:exportPDF', async (e, html, fileName) => {
  const pdfWin = new BrowserWindow({
    show: false,
    autoHideMenuBar: true,
    webPreferences: { sandbox: true, contextIsolation: true }
  })
  await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(String(html)))
  await new Promise((r) => setTimeout(r, 250)) // 等待内联图片/排版收尾
  const pdf = await pdfWin.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: { top: 0.55, bottom: 0.55, left: 0.5, right: 0.5 }
  })
  pdfWin.close()
  const parent = BrowserWindow.fromWebContents(e.sender)
  const { canceled, filePath } = await dialog.showSaveDialog(parent, {
    title: '导出 PDF 月报',
    defaultPath: String(fileName || '财务月报.pdf'),
    filters: [{ name: 'PDF 文档', extensions: ['pdf'] }]
  })
  if (canceled || !filePath) return { ok: false, canceled: true }
  try {
    await fs.promises.writeFile(filePath, pdf)
  } catch (err) {
    if (err && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES')) {
      return { ok: false, busy: true, path: filePath }
    }
    throw err
  }
  return { ok: true, path: filePath }
})

// ------------------------------ 数据备份与恢复 -------------------------------

const BACKUP_DIR = () => path.join(app.getPath('userData'), 'backups')
const AUTO_KEEP = 5

/** 读取全部账本文件（备份是全局操作，需覆盖所有账户的账本） */
function readAllLedgerFiles() {
  const dir = ensureLedgerDir()
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJsonOrQuarantine(path.join(dir, f)))
    .filter(Boolean)
}

/**
 * 自动备份到 userData/backups，仅保留最近 AUTO_KEEP 份。
 * 启动时调用一次；恢复操作前也调用（作为误操作的后悔药）。
 */
function autoBackup() {
  const dir = BACKUP_DIR()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const data = backup.buildBackup(allAccounts(), readAllLedgerFiles())
  const text = backup.serializeBackup(data, '')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const fileName = `auto-${stamp}.finbak`
  atomicWrite(path.join(dir, fileName), text)
  const old = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.finbak'))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  for (const x of old.slice(AUTO_KEEP)) {
    try { fs.unlinkSync(path.join(dir, x.f)) } catch { /* ignore */ }
  }
  return fileName
}

/** 手动备份：收集 → 可选密码序列化 → 另存为 */
ipcMain.handle('backup:export', async (e, password) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const data = backup.buildBackup(allAccounts(), readAllLedgerFiles())
  const text = backup.serializeBackup(data, password)
  const stamp = new Date().toISOString().slice(0, 10)
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: '备份数据',
    defaultPath: `财账簿备份-${stamp}.finbak`,
    filters: [{ name: '财账簿备份', extensions: ['finbak'] }]
  })
  if (canceled || !filePath) return { ok: false, canceled: true }
  atomicWrite(filePath, text)
  return { ok: true, path: filePath }
})

/** 选择备份文件：返回路径 + 是否加密 */
ipcMain.handle('backup:pick', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '选择备份文件',
    filters: [{ name: '财账簿备份', extensions: ['finbak'] }],
    properties: ['openFile']
  })
  if (canceled || !filePaths[0]) return { canceled: true }
  const filePath = filePaths[0]
  let encrypted = false
  try { encrypted = backup.isEncrypted(fs.readFileSync(filePath, 'utf8')) } catch { /* 损坏文件交给 inspect 报错 */ }
  return { canceled: false, path: filePath, encrypted }
})

/** 检查备份：解析（加密则需密码）并返回摘要 */
ipcMain.handle('backup:inspect', (_e, filePath, password) => {
  const content = fs.readFileSync(filePath, 'utf8')
  const data = backup.parseBackup(content, password)
  return { summary: backup.summarizeBackup(data) }
})

/** 恢复数据：先自动备份当前数据 → 清空账户/账本目录 → 写入备份内容 */
ipcMain.handle('backup:restore', (_e, filePath, password) => {
  const data = backup.normalizeOnRestore(backup.parseBackup(fs.readFileSync(filePath, 'utf8'), password))

  // 恢复前留一份当前数据（误恢复可再找回）
  autoBackup()

  // 写入账户：以备份 id 为准，先清目录避免残留已删除的账户
  const accDir = ACCOUNT_DIR()
  if (fs.existsSync(accDir)) fs.rmSync(accDir, { recursive: true, force: true })
  fs.mkdirSync(accDir, { recursive: true })
  for (const a of data.accounts) atomicWrite(accountFile(a.id), JSON.stringify(a, null, 2))

  // 写入账本
  const ledDir = LEDGER_DIR()
  if (fs.existsSync(ledDir)) fs.rmSync(ledDir, { recursive: true, force: true })
  fs.mkdirSync(ledDir, { recursive: true })
  for (const l of data.ledgers) atomicWrite(ledgerFile(l.id), JSON.stringify(l, null, 2))

  session = null // 身份可能已变更，回到登录门重新验证
  return { ok: true }
})

// ------------------------------ 应用个性化设置 -------------------------------

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json')

function readSettings() {
  const parsed = readJsonOrQuarantine(SETTINGS_FILE())
  return settingsCore.defaultSettings(parsed || {})
}

function writeSettings(s) {
  atomicWrite(SETTINGS_FILE(), JSON.stringify(s, null, 2))
  return s
}

ipcMain.handle('settings:get', () => readSettings())

ipcMain.handle('settings:update', (_e, patch) => {
  const checked = settingsCore.normalizeSettings(patch)
  if (!checked.ok) throw new Error(checked.reason)
  writeSettings(checked.value)
  return checked.value
})

// ------------------------------ 自动更新 -----------------------------------
// 发布渠道：GitHub Releases（公开仓库 Oraice/finance-desktop）。electron-builder
// 每次构建会生成 latest.yml；electron-updater 比对版本号，发现新版自动后台下载，
// 下载完成后通知渲染层弹窗、确认后重启安装。尚未发布 / 无网络时静默，不打扰用户。

let updater = null
function getAutoUpdater() {
  if (!updater) updater = require('electron-updater').autoUpdater
  return updater
}

function setupAutoUpdater() {
  if (!app.isPackaged) return // 开发环境没有更新源，跳过
  const au = getAutoUpdater()
  au.autoDownload = true
  au.autoInstallOnAppQuit = true

  au.on('error', () => { /* 无网络 / 尚未发布更新，静默 */ })
  au.on('update-downloaded', (info) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.webContents.send('updater:downloaded', { version: (info && info.version) || '' })
  })

  // 启动后延迟检查，避开启动 IO 高峰
  setTimeout(() => { try { au.checkForUpdates() } catch { /* ignore */ } }, 10000)
}

/** 手动检查更新：返回 status=available / not-available / unavailable 供界面提示。 */
ipcMain.handle('updater:check', async () => {
  if (!app.isPackaged) return { status: 'dev' }
  const au = getAutoUpdater()
  return new Promise((resolve) => {
    const done = (v) => {
      au.removeListener('update-available', onAvail)
      au.removeListener('update-not-available', onNot)
      au.removeListener('error', onErr)
      resolve(v)
    }
    const onAvail = (info) => done({ status: 'available', version: info.version })
    const onNot = () => done({ status: 'not-available' })
    const onErr = () => done({ status: 'unavailable' })
    au.once('update-available', onAvail)
    au.once('update-not-available', onNot)
    au.once('error', onErr)
    au.checkForUpdates().catch(() => done({ status: 'unavailable' }))
  })
})

ipcMain.handle('updater:install', () => {
  if (!app.isPackaged) return false
  getAutoUpdater().quitAndInstall()
  return true
})

// ------------------------------ 崩溃诊断 -----------------------------------
// 崩溃默认只写本机 userData/crashes；仅当用户显式开启上报并配置地址才发送。
let reporter = null
let pendingCrash = null

function platformInfo() {
  return { platform: process.platform, arch: process.arch, os: `${process.platform} ${os.release()}` }
}

function registerProcessHooks() {
  process.on('uncaughtException', (err) => {
    try { reporter && reporter.record({ source: 'main', error: err }) } catch { /* ignore */ }
    console.error('[uncaughtException]', (err && err.stack) || err)
  })
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason))
    try { reporter && reporter.record({ source: 'main', error: err }) } catch { /* ignore */ }
    console.error('[unhandledRejection]', reason)
  })
}

/** 渲染进程上报的脚本错误（仅消息与代码位置，不含任何用户数据） */
ipcMain.handle('crash:renderer', (_e, payload) => {
  if (!reporter || !payload) return false
  reporter.record({ source: 'renderer', message: payload.message, url: payload.url, line: payload.line, col: payload.col })
  return true
})

ipcMain.handle('crash:list', () => (reporter ? reporter.listCrashes() : []))
ipcMain.handle('crash:clear', () => { if (reporter) reporter.clearCrashes(); return true })
ipcMain.handle('crash:getPending', () => pendingCrash)
ipcMain.handle('crash:markSeen', () => { pendingCrash = null; return true })

/** 导出崩溃记录为 JSON（本机另存为） */
ipcMain.handle('crash:export', async (e, payload) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: '导出崩溃记录',
    defaultPath: '崩溃记录.json',
    filters: [{ name: 'JSON 文档', extensions: ['json'] }]
  })
  if (canceled || !filePath) return { ok: false, canceled: true }
  await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2))
  return { ok: true, path: filePath }
})

/** 端到端：隐藏窗口加载 E2E 页面，轮询结果并据此退出 */
function runE2E() {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true }
  })
  win.loadFile(path.join(__dirname, 'test', 'e2e', 'e2e.html'))
  let settled = false
  const start = Date.now()
  const timer = setInterval(async () => {
    try {
      const raw = await win.webContents.executeJavaScript(
        'window.__e2eResult ? JSON.stringify(window.__e2eResult) : ""'
      )
      if (raw) {
        clearInterval(timer)
        const r = JSON.parse(raw)
        for (const s of r.steps) console.log((s.ok ? '  PASS ' : '  FAIL ') + s.name + (s.ok ? '' : ' -> ' + s.detail))
        console.log(`E2E ${r.ok ? 'PASS' : 'FAIL'}：${r.count.passed}/${r.count.total}`)
        if (r.ok) { try { fs.rmSync(e2eTempDir, { recursive: true, force: true }) } catch { /* ignore */ } }
        else console.log('临时数据保留于：' + e2eTempDir)
        if (!settled) { settled = true; app.exit(r.ok ? 0 : 1) }
      }
    } catch { /* 轮询脚本偶发错误，忽略 */ }
    if (Date.now() - start > 30000) {
      clearInterval(timer)
      console.log('E2E 超时 FAIL')
      if (!settled) { settled = true; app.exit(1) }
    }
  }, 400)
  win.webContents.on('did-fail-load', () => {
    clearInterval(timer)
    if (!settled) { settled = true; app.exit(1) }
  })
}

// --------------------------- 窗口尺寸 / 位置记忆 ----------------------------

function windowStateFile() {
  return path.join(app.getPath('userData'), 'window-state.json')
}

function loadWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8'))
    if (Number.isFinite(s.width) && Number.isFinite(s.height)) return s
  } catch { /* 首次运行或文件损坏，用默认尺寸 */ }
  return null
}

/** 恢复的窗口至少要有一部分落在某个可用显示器内，防止外接屏拔掉后窗口在屏幕外 */
function stateVisible(s) {
  if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.y)) return false
  try {
    for (const d of screen.getAllDisplays()) {
      const b = d.workArea
      if (s.x + 100 > b.x && s.x < b.x + b.width && s.y + 100 > b.y && s.y < b.y + b.height) return true
    }
  } catch { return false }
  return false
}

function bindWindowStatePersistence(win) {
  const save = () => {
    try {
      // getNormalBounds：即使最大化也记录“正常状态”的尺寸与位置
      const b = win.getNormalBounds()
      atomicWriteJson(windowStateFile(), { width: b.width, height: b.height, x: b.x, y: b.y, maximized: win.isMaximized() })
    } catch { /* ignore */ }
  }
  let timer = null
  const schedule = () => { clearTimeout(timer); timer = setTimeout(save, 350) }
  win.on('resize', schedule)
  win.on('move', schedule)
  win.on('close', save)
}

// ------------------------------ 主窗口 -------------------------------------

function createWindow() {
  const settings = readSettings()
  const saved = loadWindowState()
  const winOpts = {
    width: saved && saved.width ? saved.width : 1280,
    height: saved && saved.height ? saved.height : 820,
    minWidth: 960,
    minHeight: 600,
    title: `${settings.appName} · 本地财务效率`,
    autoHideMenuBar: true,
    show: false, // ready-to-show 后再显示，避免首次加载白屏闪烁
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  }
  if (settings.appLogo) winOpts.icon = nativeImage.createFromDataURL(settings.appLogo)
  if (stateVisible(saved)) { winOpts.x = saved.x; winOpts.y = saved.y }
  const win = new BrowserWindow(winOpts)
  if (saved && saved.maximized) win.maximize()
  win.once('ready-to-show', () => { if (!IS_SMOKE) win.show() })
  bindWindowStatePersistence(win)

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  // 诊断通道：渲染进程 console / 报错。正常运行落盘 renderer.log；冒烟模式落盘 smoke-console.log。
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const tag = ['verbose', 'info', 'warning', 'error'][level] || 'log'
    if (IS_SMOKE) {
      try {
        fs.appendFileSync(
          path.join(app.getPath('userData'), 'smoke-console.log'),
          `[${tag}] ${message} (${sourceId}:${line})\n`
        )
      } catch { /* ignore */ }
      return
    }
    try {
      const file = path.join(app.getPath('userData'), 'renderer.log')
      fs.appendFileSync(file, `[${new Date().toISOString()}] [${tag}] ${message} (${sourceId}:${line})\n`)
    } catch { /* 日志失败不影响应用 */ }
  })

  // 冒烟：页面加载完成后做功能性断言——app.js 模块图成功加载并启动才退出码 0。
  if (IS_SMOKE) {
    let settled = false
    const finish = (code) => { if (settled) return; settled = true; app.exit(code) }
    win.webContents.on('did-finish-load', () => setTimeout(async () => {
      try {
        const raw = await win.webContents.executeJavaScript(
          "new Promise(function(res){" +
          "setTimeout(function(){" +
          "document.getElementById('btn-add-account').click();" +
          "setTimeout(function(){" +
          "var ids=['acct-type','acct-name','acct-opening','acct-limit','acct-statement','acct-due'];" +
          "var missing=ids.filter(function(id){return !document.getElementById(id);});" +
          "res(JSON.stringify({booted:window.__appBooted===true,missing:missing}));" +
          "},250);" +
          "},1500);" +
          "})"
        )
        const s = JSON.parse(raw)
        fs.writeFileSync(path.join(app.getPath('userData'), 'smoke-diag.json'), JSON.stringify(s, null, 2))
        if (s.booted && Array.isArray(s.missing) && s.missing.length === 0) { finish(0); return }
      } catch (e) {
        fs.writeFileSync(path.join(app.getPath('userData'), 'smoke-diag.json'), 'EXEC-ERROR: ' + (e.message || e))
      }
      finish(1)
    }, 3500))
    win.webContents.on('did-fail-load', (_e, code, desc) => {
      console.error('[smoke] 页面加载失败:', code, desc)
      finish(1)
    })
    win.webContents.on('render-process-gone', () => finish(1))
    setTimeout(() => finish(1), 12000) // 兜底超时：卡住也算启动失败
    return
  }

  // 渲染进程崩溃 / 被杀：记录原因（不含任何数据）
  win.webContents.on('render-process-gone', (_e, details) => {
    try { reporter && reporter.record({ source: 'render-gone', reason: details.reason, extra: { exitCode: details.exitCode } }) } catch { /* ignore */ }
  })

  // 外部链接一律交给系统浏览器，渲染进程本身零网络依赖
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(() => {
  if (IS_E2E) { runE2E(); return }

  reporter = createCrashReporter({
    userDataPath: app.getPath('userData'),
    appVersion: app.getVersion(),
    platformInfo: platformInfo()
  })
  const detected = reporter.detectUnexpectedExit()
  pendingCrash = detected.unexpected ? detected : null
  reporter.startLiveness()
  registerProcessHooks()

  createWindow()
  setupAutoUpdater()
  // 启动后延迟自动备份（避开启动期 IO 高峰），仅保留最近 5 份
  setTimeout(() => { try { autoBackup() } catch (e) { console.error('自动备份失败:', e.message) } }, 4000)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => { if (reporter) reporter.endLiveness() })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
