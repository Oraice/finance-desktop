// ---------------------------------------------------------------------------
// recurring.mjs —— 周期记账（自动重复流水）纯逻辑，无副作用、可单测。
//
// 数据模型（周期模板 template）：
//   { id, active, type(income/expense), category, amount, accountId, note,
//     frequency(daily/weekly/monthly/yearly), interval(每 N 个频率单位),
//     anchorDate(=startDate，周期推算基准), startDate, endDate(可空),
//     lastRunDate(最后已入账实例日期，为空表示从未入账) }
//
// 月末规则：每月 / 每年按 anchor 的“日”锚定，目标月没有该日（如 31 号、
// 2/29）时落到当月最后一天，下个长月再回到原日，避免日期漂移。
// ---------------------------------------------------------------------------

const r2 = (v) => Math.round(Number(v || 0) * 100) / 100
const pad = (n) => String(n).padStart(2, '0')

export const FREQUENCIES = [
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'yearly', label: '每年' }
]

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/

const parseParts = (s) => {
  const [y, m, d] = String(s).split('-').map(Number)
  if (!(y >= 1970 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m))) return null
  return { y, m, d }
}
const toIso = (p) => `${p.y}-${pad(p.m)}-${pad(p.d)}`
export const isValidDate = (s) => ISO_RE.test(String(s)) && !!parseParts(s)
const cmpIso = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/** 某月天数（m 为 1-12） */
function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** 加 n 个月，日保持 p.d，目标月较短则落到月末 */
function addMonthsParts(p, n) {
  const total = p.y * 12 + (p.m - 1) + n
  const y = Math.floor(total / 12)
  const m = ((total % 12) + 12) % 12 + 1
  return { y, m, d: Math.min(p.d, daysInMonth(y, m)) }
}

function addDaysParts(p, n) {
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() }
}

/**
 * 通用日期推进：把给定日期推进 interval 个频率周期（基于传入日期本身）。
 * 注意链式调用在月末会沿用上一实例的日；按模板生成序列请用 nthOccurrence。
 */
export function advanceDate(isoDate, frequency, interval = 1) {
  const p = parseParts(isoDate)
  if (!p) throw new Error('日期格式不正确')
  const n = Math.max(1, Math.floor(Number(interval)))
  let out
  if (frequency === 'daily') out = addDaysParts(p, n)
  else if (frequency === 'weekly') out = addDaysParts(p, 7 * n)
  else if (frequency === 'monthly') out = addMonthsParts(p, n)
  else if (frequency === 'yearly') out = addMonthsParts(p, 12 * n)
  else throw new Error('重复频率不正确')
  return toIso(out)
}

/**
 * 模板第 n 个实例（n 从 0 开始）：始终以 anchorDate 锚定，
 * monthly / yearly 保持原始“日”，短月落月末、长月回原日。
 */
export function nthOccurrence(template, n) {
  const anchor = parseParts(template.anchorDate)
  if (!anchor) throw new Error('模板开始日期不正确')
  const k = Math.max(0, Math.floor(n)) * Math.max(1, Math.floor(template.interval))
  const f = template.frequency
  if (f === 'daily') return toIso(addDaysParts(anchor, k))
  if (f === 'weekly') return toIso(addDaysParts(anchor, 7 * k))
  if (f === 'monthly') return toIso(addMonthsParts(anchor, k))
  if (f === 'yearly') return toIso(addMonthsParts(anchor, 12 * k))
  throw new Error('重复频率不正确')
}

/** 校验并规整一个周期模板（不含 id，id 由存储层生成）。失败抛错。 */
export function normalizeRecurring(input = {}) {
  const type = input.type === 'income' ? 'income' : 'expense'
  const category = String(input.category || '').trim() || (type === 'income' ? '其他收入' : '未分类')
  if (category.length > 10) throw new Error('分类名称不能超过 10 个字')

  const amount = Number(input.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('金额需为大于 0 的数字')
  if (amount > 1e8) throw new Error('金额过大')

  const frequency = String(input.frequency || 'monthly')
  if (!FREQUENCIES.some((f) => f.value === frequency)) throw new Error('重复频率不正确')

  const interval = parseInt(input.interval != null ? input.interval : 1, 10)
  if (!(interval >= 1 && interval <= 365)) throw new Error('间隔需为 1-365 之间的整数')

  const startDate = String(input.startDate || '')
  if (!isValidDate(startDate)) throw new Error('请选择开始日期')

  let endDate = String(input.endDate || '').trim()
  if (endDate) {
    if (!isValidDate(endDate)) throw new Error('结束日期不正确')
    if (cmpIso(endDate, startDate) < 0) throw new Error('结束日期不能早于开始日期')
  } else endDate = ''

  return {
    active: input.active !== false,
    type,
    category,
    amount: r2(amount),
    accountId: String(input.accountId || ''),
    note: String(input.note || '').slice(0, 50),
    frequency,
    interval,
    anchorDate: startDate,
    startDate,
    endDate,
    lastRunDate: isValidDate(input.lastRunDate) ? input.lastRunDate : ''
  }
}

/**
 * 模板在 upToDate（含）之前到期、但尚未入账（晚于 lastRunDate）的实例日期。
 * 从未入账时从第 0 个实例开始；endDate 之后停止；停用模板返回空。
 */
export function dueDates(template, upToDate, { maxCount = 400 } = {}) {
  if (template.active === false) return []
  const out = []
  let n = 0
  let guard = 0
  while (guard <= maxCount) {
    const d = nthOccurrence(template, n)
    if (template.lastRunDate && cmpIso(d, template.lastRunDate) <= 0) {
      n += 1; guard += 1; continue
    }
    if (cmpIso(d, upToDate) > 0) break
    if (template.endDate && cmpIso(d, template.endDate) > 0) break
    out.push(d)
    n += 1; guard += 1
  }
  return out
}

/** 把某个到期实例转成流水（id 由调用层生成） */
export function occurrenceRecord(template, date) {
  return {
    date,
    type: template.type,
    category: template.category,
    amount: template.amount,
    note: template.note,
    accountId: template.accountId || '',
    source: '周期'
  }
}

/** 便捷：返回 upToDate 前全部到期实例对应的流水（不含 id） */
export function dueRecords(template, upToDate) {
  return dueDates(template, upToDate).map((d) => occurrenceRecord(template, d))
}
