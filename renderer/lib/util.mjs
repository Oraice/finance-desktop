// ---------------------------------------------------------------------------
// util.mjs —— 渲染层共享的纯工具：金额/日期格式化、转义、账本图标渲染
// 收敛此前散落在 app.js / dash-extras / year-ui / summary-ui / pdf-report
// 中重复定义的 fmt / esc / pad2 / setGlyph。
// ---------------------------------------------------------------------------

export const pad2 = (n) => String(n).padStart(2, '0')

/** 千分位两位小数金额，如 ¥12,345.60 */
export const fmtMoney = (n) =>
  '¥' + Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 千分位取整金额，如 ¥12,346 */
export const fmt0 = (n) =>
  '¥' + Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })

/** HTML 文本转义 */
export const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

/** 本地时区的 YYYY-MM-DD */
export const isoLocal = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`

/**
 * 渲染账本/账户图标：有自定义图片用背景图，否则显示 emoji/文字。
 * 依赖 CSS 类 .is-img。
 */
export const setGlyph = (el, img, fallback) => {
  el.textContent = ''
  el.style.backgroundImage = ''
  if (img) {
    el.style.backgroundImage = `url("${img}")`
    el.classList.add('is-img')
  } else {
    el.classList.remove('is-img')
    el.textContent = fallback
  }
}

/** 读取本地图片，按短边居中裁剪为正方形 dataURL（JPEG），用于图标/头像/Logo */
export function fileToSquare(file, size = 256) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const iw = img.naturalWidth
      const ih = img.naturalHeight
      const side = Math.min(iw, ih)
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, (iw - side) / 2, (ih - side) / 2, side, side, 0, 0, size, size)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片加载失败，请换一张'))
    }
    img.src = url
  })
}
