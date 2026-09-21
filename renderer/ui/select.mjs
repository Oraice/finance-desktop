// ---------------------------------------------------------------------------
// select.mjs —— 通用自绘下拉：渐进增强所有原生 <select>
// 背景：本机 Win11 + Electron 渲染原生 select 弹层不稳定（点不中/闪退/无数据）。
// 方案：隐藏原生 select（保留为数据容器），生成同位置的自绘按钮 + 弹层；
//       选项变化用 MutationObserver 自动同步，选中后向原生 select 派发 change 事件，
//       现有业务代码（读 .value、监听 change）完全不用改。
// ---------------------------------------------------------------------------

const registry = [] // { sel, trigger, labelEl, popup, open }
const $ = (s) => document.querySelector(s)

export function enhanceSelects(root = document) {
  root.querySelectorAll('select:not([data-enhanced])').forEach(wrapSelect)
}

export function syncAllSelects() {
  registry.forEach(sync)
}

function wrapSelect(sel) {
  sel.setAttribute('data-enhanced', '1')

  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.className = 'xselect'
  trigger.innerHTML = '<span class="xselect-label"></span><span class="xselect-caret">▾</span>'

  const popup = document.createElement('div')
  popup.className = 'xselect-pop hidden'
  document.body.appendChild(popup)

  sel.parentNode.insertBefore(trigger, sel)
  sel.classList.add('xselect-native')

  const st = { sel, trigger, labelEl: trigger.firstElementChild, popup, open: false }
  registry.push(st)

  trigger.addEventListener('click', (e) => {
    e.stopPropagation()
    st.open ? close(st) : open(st)
  })

  // 选项动态重建（innerHTML）或增删时自动同步显示；
  // MutationObserver 回调在同步代码之后执行，因此 setIfFound 等程序化赋值也能取到最新 value
  new MutationObserver(() => sync(st)).observe(sel, { childList: true, subtree: true, attributes: true })
  sel.addEventListener('change', () => sync(st))
  sync(st)
}

function open(st) {
  closeAll()
  renderPopup(st)
  const rect = st.trigger.getBoundingClientRect()
  st.popup.style.left = rect.left + 'px'
  st.popup.style.top = rect.bottom + 4 + 'px'
  st.popup.style.minWidth = rect.width + 'px'
  st.popup.classList.remove('hidden')
  st.open = true
}

function renderPopup(st) {
  st.popup.innerHTML = ''
  const opts = [...st.sel.options]
  if (!opts.length) {
    const none = document.createElement('div')
    none.className = 'xselect-item disabled'
    none.textContent = '（无可选项）'
    st.popup.appendChild(none)
    return
  }
  opts.forEach((opt, i) => {
    const item = document.createElement('div')
    item.className = 'xselect-item' + (opt.selected ? ' active' : '')
    item.textContent = opt.textContent
    item.addEventListener('click', (e) => {
      e.stopPropagation()
      pick(st, i)
    })
    st.popup.appendChild(item)
  })
}

function pick(st, index) {
  const opt = st.sel.options[index]
  if (st.sel.selectedIndex !== index) {
    st.sel.selectedIndex = index
    st.sel.dispatchEvent(new Event('change', { bubbles: true }))
  }
  sync(st)
  close(st)
}

function close(st) {
  st.popup.classList.add('hidden')
  st.open = false
}

function closeAll() { registry.forEach(close) }

function sync(st) {
  const opt = st.sel.options[st.sel.selectedIndex]
  st.labelEl.textContent = opt ? opt.textContent : '—'
}

// ------------------- 全局关闭：点空白 / 滚动 / Esc ---------------------------

document.addEventListener('click', closeAll)
window.addEventListener('resize', closeAll)
document.addEventListener('scroll', closeAll, true)
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll() })
