// ---------------------------------------------------------------------------
// empty.mjs —— 统一空状态：图标 + 标题 + 说明 + 主操作按钮（可再带次要操作区）
// 用法：
//   import { emptyState, showEmpty } from './ui/empty.mjs'
//   el.appendChild(emptyState({ icon, title, desc, action:{text,onClick}, compact }))
//   showEmpty(el, opts)   // 清空容器后直接放入空状态
// ---------------------------------------------------------------------------

/**
 * 返回一个空状态元素。
 * opts: {
 *   icon: '📭', title: '还没有内容', desc: '…',
 *   action: { text: '＋ 新增', onClick: fn },   // 主按钮，选填
 *   compact: false                              // 紧凑（用于卡片 / 表格内嵌）
 * }
 */
export function emptyState(opts = {}) {
  const wrap = document.createElement('div')
  wrap.className = 'empty-state' + (opts.compact ? ' compact' : '')

  if (opts.icon) {
    const icon = document.createElement('div')
    icon.className = 'empty-icon'
    icon.textContent = opts.icon
    wrap.appendChild(icon)
  }
  if (opts.title) {
    const t = document.createElement('div')
    t.className = 'empty-title'
    t.textContent = opts.title
    wrap.appendChild(t)
  }
  if (opts.desc) {
    const d = document.createElement('div')
    d.className = 'empty-desc'
    d.textContent = opts.desc
    wrap.appendChild(d)
  }
  if (opts.action && opts.action.text) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'btn btn-primary empty-action'
    b.textContent = opts.action.text
    if (typeof opts.action.onClick === 'function') b.addEventListener('click', opts.action.onClick)
    wrap.appendChild(b)
  }
  return wrap
}

/** 便捷：清空容器后放入空状态 */
export function showEmpty(el, opts) {
  el.innerHTML = ''
  el.appendChild(emptyState(opts))
}
