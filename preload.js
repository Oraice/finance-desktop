'use strict'

const { contextBridge, ipcRenderer } = require('electron')

// 渲染进程唯一的数据入口：白名单 IPC，不暴露原始 ipcRenderer
contextBridge.exposeInMainWorld('ledgerAPI', {
  list: () => ipcRenderer.invoke('ledger:list'),
  create: (name, iconImage) => ipcRenderer.invoke('ledger:create', name, iconImage),
  get: (id) => ipcRenderer.invoke('ledger:get', id),
  all: () => ipcRenderer.invoke('ledger:getAll'),
  rename: (id, name, iconImage) => ipcRenderer.invoke('ledger:rename', id, name, iconImage),
  remove: (id) => ipcRenderer.invoke('ledger:delete', id),
  restoreFile: (ledger) => ipcRenderer.invoke('ledger:restoreFile', ledger),
  saveRecords: (id, records, batches) => ipcRenderer.invoke('records:save', id, records, batches),
  saveFunds: (id, accounts, transfers) => ipcRenderer.invoke('funds:save', id, accounts, transfers),
  saveRecurring: (id, recurring) => ipcRenderer.invoke('recurring:save', id, recurring),
  saveReconcile: (id, reconciliations) => ipcRenderer.invoke('reconcile:save', id, reconciliations),
  saveBinary: (fileName, bytes) => ipcRenderer.invoke('export:save', fileName, bytes)
})

// 账户体系：注册/登录/自动登录/登出/改密（口令校验全部在主进程完成）
contextBridge.exposeInMainWorld('authAPI', {
  register: (username, password, autoLogin) => ipcRenderer.invoke('auth:register', username, password, autoLogin),
  login: (username, password, autoLogin) => ipcRenderer.invoke('auth:login', username, password, autoLogin),
  auto: () => ipcRenderer.invoke('auth:auto'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  changePassword: (oldPw, newPw) => ipcRenderer.invoke('auth:changePassword', oldPw, newPw),
  hasAccounts: () => ipcRenderer.invoke('auth:hasAccounts'),
  getProfile: () => ipcRenderer.invoke('auth:getProfile'),
  updateProfile: (patch) => ipcRenderer.invoke('auth:updateProfile', patch),
  changeUsername: (newName) => ipcRenderer.invoke('auth:changeUsername', newName)
})

// 数据备份与恢复（全部本机完成，备份文件可选择密码加密）
contextBridge.exposeInMainWorld('backupAPI', {
  export: (password) => ipcRenderer.invoke('backup:export', password),
  pick: () => ipcRenderer.invoke('backup:pick'),
  inspect: (filePath, password) => ipcRenderer.invoke('backup:inspect', filePath, password),
  restore: (filePath, password) => ipcRenderer.invoke('backup:restore', filePath, password)
})

// 应用个性化设置：应用显示名称、品牌 logo（侧边栏 / 登录页 / 窗口图标同步）
contextBridge.exposeInMainWorld('settingsAPI', {
  get: () => ipcRenderer.invoke('settings:get'),
  update: (patch) => ipcRenderer.invoke('settings:update', patch)
})

// 报表导出：PDF 月报（渲染层生成自包含 HTML，主进程 printToPDF）
contextBridge.exposeInMainWorld('reportAPI', {
  exportPDF: (html, fileName) => ipcRenderer.invoke('report:exportPDF', html, fileName)
})

// 自动更新（GitHub Releases）：手动检查、下载完成事件、确认后重启安装
contextBridge.exposeInMainWorld('updaterAPI', {
  check: () => ipcRenderer.invoke('updater:check'),
  install: () => ipcRenderer.invoke('updater:install'),
  onDownloaded: (cb) => {
    const handler = (_e, info) => cb(info)
    ipcRenderer.on('updater:downloaded', handler)
    return () => ipcRenderer.removeListener('updater:downloaded', handler)
  }
})

// 崩溃诊断：渲染脚本错误上报、崩溃记录列表 / 清理、异常退出提示
contextBridge.exposeInMainWorld('crashAPI', {
  report: (payload) => ipcRenderer.invoke('crash:renderer', payload),
  list: () => ipcRenderer.invoke('crash:list'),
  clear: () => ipcRenderer.invoke('crash:clear'),
  export: (payload) => ipcRenderer.invoke('crash:export', payload),
  getPending: () => ipcRenderer.invoke('crash:getPending'),
  markSeen: () => ipcRenderer.invoke('crash:markSeen')
})
