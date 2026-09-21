// ---------------------------------------------------------------------------
// undo.mjs —— 全局操作撤销栈
// 每次破坏性 / 变更操作后调用 pushUndo：顶部出现带「撤销」按钮的提示条，
// 点撤销即执行该操作记录的反向函数；同时维护一个最多 MAX 步的栈，供连续撤销。
// 反向函数由调用方按「账本 id + 当前最新数据」构造，跨账本切换也能安全撤销。
// ---------------------------------------------------------------------------

import { showToast, showToastWithAction } from '../ui/dialog.mjs'

const MAX = 20
const stack = []

let afterUndo = null
/** 注册撤销成功后的统一刷新回调（由 app.js 注入，重渲染当前视图） */
export function setAfterUndo(fn) { afterUndo = fn }

/**
 * 记录一步可撤销操作。
 * @param {string} label 提示文案（如「已删除一条流水」）
 * @param {() => Promise<void>|void} undoFn 反向操作（按账本 id 自包含）
 * @param {number} duration 提示条停留毫秒
 */
export function pushUndo(label, undoFn, duration = 5000) {
  stack.push({ label, undoFn })
  if (stack.length > MAX) stack.shift()
  showToastWithAction(label, { actionText: '撤销', type: 'info', duration, onAction: runUndo })
}

async function runUndo() {
  const item = stack.pop()
  if (!item) return
  try {
    await item.undoFn()
  } catch (e) {
    console.error('撤销失败:', e.message)
    showToast('撤销失败：' + (e.message || e), 'error', 2600)
    return
  }
  showToast('已撤销：' + item.label, 'success', 1600)
  if (typeof afterUndo === 'function') {
    try { await afterUndo(item) } catch (e) { console.error('撤销后刷新失败:', e.message) }
  }
}

/** 清空撤销栈（登出 / 身份变更时调用） */
export function clearUndo() { stack.length = 0 }

/** 当前可撤销步数 */
export function undoDepth() { return stack.length }
