// ---------------------------------------------------------------------------
// import-core.mjs —— Excel 流水解析核心（纯函数，浏览器与 Node 均可导入）
// 不触碰 DOM，方便单元测试与后续复用。
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86400000

// 表头关键词词典（小写匹配；中文按包含匹配）
export const KEYWORDS = {
  date: ['日期', '交易时间', '发生时间', '记账日期', '时间', 'date', 'trade date'],
  income: ['收入', '收入金额', '贷方', '存入', 'income', 'credit'],
  expense: ['支出', '支出金额', '借方', '取出', 'expense', 'debit'],
  amount: ['金额', '交易金额', '发生额', '收支金额', 'amount'],
  type: ['收/支', '收支类型', '收支', '类型', '借贷标志', 'type'],
  category: ['分类', '类别', '费用类别', '交易分类', 'category'],
  note: ['备注', '摘要', '说明', '交易说明', '用途', 'note', 'memo']
}

const CATEGORY_RULES = [
  ['餐饮', /餐|饭|吃|食|外卖|饿了么|美团|肯德基|麦当劳|咖啡|奶茶/i],
  ['交通', /地铁|公交|打车|滴滴|出租|高[铁路]|机票|加油|停车|共享单车|12306/i],
  ['购物', /淘宝|京东|拼多多|天猫|当当|购物|商场|超市|便利店/i],
  ['居家', /物业|水电|燃气|电费|水费|房租|宽带|话费|电信|联通|移动/i],
  ['娱乐', /电影|游戏|演出|会员|视频|网易云|腾讯视频|爱奇艺/i],
  ['医疗', /医院|药房|药店|门诊|挂号|体检|感冒|退烧|药/i],
  ['工资', /工资|薪酬|绩效|年终奖/i]
]

// ------------------------------ 基础工具 ------------------------------------

/** 取工作表二维数组（保留原始值，Excel 日期会是序列号数字） */
export function sheetToGrid(ws, XLSX) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
}

/** 单元格文本是否命中某字段的任一关键词 */
function cellHits(text, field) {
  const t = String(text ?? '').trim().toLowerCase()
  if (!t) return false
  return KEYWORDS[field].some((k) => t === k.toLowerCase() || t.includes(k.toLowerCase()))
}

/** 在前 maxScan 行中猜测表头行：命中关键词最多的非空行 */
export function detectHeaderRow(grid, maxScan = 15) {
  let best = { index: 0, hits: -1 }
  const limit = Math.min(maxScan, grid.length)
  for (let i = 0; i < limit; i++) {
    const row = grid[i] || []
    let hits = 0
    for (const cell of row) {
      if (cellHits(cell, 'date') || cellHits(cell, 'amount') ||
          cellHits(cell, 'income') || cellHits(cell, 'expense') || cellHits(cell, 'type')) hits++
    }
    const nonEmpty = row.filter((c) => c !== null && String(c).trim() !== '').length
    if (nonEmpty >= 2 && hits > best.hits) best = { index: i, hits }
  }
  return best.index
}

/** 根据表头猜测列映射与金额模式 */
export function guessMapping(headers) {
  const idx = (field) => headers.findIndex((h) => cellHits(h, field))
  const map = {
    date: idx('date'),
    income: idx('income'),
    expense: idx('expense'),
    amount: idx('amount'),
    type: idx('type'),
    category: idx('category'),
    note: idx('note')
  }
  if (map.income >= 0 && map.expense >= 0 && map.income !== map.expense) map.mode = 'twoCol'
  else if (map.amount >= 0 && map.type >= 0) map.mode = 'typeCol'
  else if (map.amount >= 0) map.mode = 'signed'
  else map.mode = 'twoCol' // 兜底：交给用户手动映射
  return map
}

/** 金额解析："¥1,234.50" / "1 234.5" / 数字 → number；失败返回 null */
export function parseAmount(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).replace(/[¥￥$，,\s]/g, '').replace(/（(.*)）/, '-$1').replace(/\((.*)\)/, '-$1')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** 日期解析：Excel 序列号 / Date 对象 / 字符串 → "YYYY-MM-DD"；失败返回 null */
export function parseDate(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v <= 0 || v > 2958465) return null // Excel 日期序列号合法范围
    return new Date(Math.round((v - 25569) * MS_PER_DAY)).toISOString().slice(0, 10)
  }
  if (v instanceof Date) return isoFromDate(v)
  const s = String(v).trim().replace(/[.]/g, '-').replace(/\//g, '-')
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : isoFromDate(d)
}

function isoFromDate(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 从摘要文本推断分类 */
export function inferCategory(text) {
  const t = String(text ?? '')
  for (const [cat, re] of CATEGORY_RULES) if (re.test(t)) return cat
  return '未分类'
}

function typeFromText(v) {
  const t = String(v ?? '').trim().toLowerCase()
  if (/支|出|付|借|expense|out/.test(t)) return 'expense'
  if (/收|入|贷|income|in/.test(t) || t === 'income') return 'income'
  return null
}

// ------------------------------ 主转换 --------------------------------------

/**
 * 将工作表原始行转换为标准流水。
 * @param grid  二维数组
 * @param headerRowIdx 表头行下标（0 基）
 * @param cfg   { date, income, expense, amount, type, category, note, mode } 列下标
 * @returns { records, skipped, stats }
 */
export function normalizeRecords(grid, headerRowIdx, cfg) {
  const records = []
  let skipped = 0
  const catCounts = new Map()

  for (let i = headerRowIdx + 1; i < grid.length; i++) {
    const row = grid[i] || []
    const date = parseDate(row[cfg.date])

    let type = null
    let amount = null

    if (cfg.mode === 'twoCol') {
      const inc = parseAmount(row[cfg.income]) || 0
      const exp = parseAmount(row[cfg.expense]) || 0
      if (Math.abs(inc) >= Math.abs(exp) && inc !== 0) { type = 'income'; amount = Math.abs(inc) }
      else if (exp !== 0) { type = 'expense'; amount = Math.abs(exp) }
    } else if (cfg.mode === 'typeCol') {
      amount = Math.abs(parseAmount(row[cfg.amount]) ?? NaN)
      type = typeFromText(row[cfg.type])
      if (!Number.isFinite(amount)) amount = null
    } else { // signed：正数收入、负数支出
      const v = parseAmount(row[cfg.amount])
      if (v !== null && v !== 0) { type = v > 0 ? 'income' : 'expense'; amount = Math.abs(v) }
    }

    if (!date || !type || amount === null || amount <= 0) { skipped++; continue }

    const note = cfg.note >= 0 ? String(row[cfg.note] ?? '').trim() : ''
    let category = cfg.category >= 0 ? String(row[cfg.category] ?? '').trim() : ''
    if (!category) category = inferCategory(note || (cfg.amount >= 0 ? row[cfg.amount] : '') || '')

    records.push({ date, type, category, amount: Math.round(amount * 100) / 100, note })
    catCounts.set(category, (catCounts.get(category) || 0) + 1)
  }

  return { records, skipped, stats: { categories: catCounts.size } }
}
