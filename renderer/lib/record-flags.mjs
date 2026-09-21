// ---------------------------------------------------------------------------
// record-flags.mjs —— 退款冲正 / 代垫 / 报销 的业务标记，以及“资金 / 损益”双视角投影
// 纯逻辑、无副作用，可在 Node 单元测试中直接验证。
//
// 记录在普通收支字段之外，可选：
//   flag: 'refund'    退款冲正：type='expense'，linkId 指向原消费
//         'advance'   代垫：type='expense'，钱已出但非本人消费，等待报销
//         'reimburse' 报销款：type='income'，linkId 指向代垫
// 普通记录无 flag。代垫是否已报销由“是否存在指向它的 reimburse”推导，不另存状态。
// ---------------------------------------------------------------------------

const num = (v) => Number(v) || 0
const r2 = (v) => Math.round(num(v) * 100) / 100

export const FLAGS = { REFUND: 'refund', ADVANCE: 'advance', REIMBURSE: 'reimburse' }

const newId = () =>
  'rec-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

/** 记录登记的精确时刻（ISO，含时分秒）；显示时转本地时区 */
const stamp = () => new Date().toISOString()

/**
 * 资金视角（账户余额 / 对账）：要反映全部真实的钱进出。
 * 退款转为“负支出”（账户余额自动加回）；代垫、报销款按其收支类型原样
 * （代垫 expense 使余额减、报销 income 使余额加）。
 */
export function toCashRecords(records) {
  return (records || []).map((r) =>
    r.flag === FLAGS.REFUND
      ? { ...r, amount: -Math.abs(num(r.amount)) }
      : r)
}

/**
 * 损益视角（收支统计 / 报表 / 预算）：只统计本人真实收支。
 * 剔除代垫与报销款；退款转为“负支出”，按原分类冲减消费。
 */
export function toPnlRecords(records) {
  return (records || [])
    .filter((r) => r.flag !== FLAGS.ADVANCE && r.flag !== FLAGS.REIMBURSE)
    .map((r) =>
      r.flag === FLAGS.REFUND
        ? { ...r, amount: -Math.abs(num(r.amount)) }
        : r)
}

/** 代垫状态：存在指向它的报销款即 'done'，否则 'pending' */
export function advanceStatus(records, advanceId) {
  return (records || []).some((r) =>
    r.flag === FLAGS.REIMBURSE && r.linkId === advanceId)
    ? 'done'
    : 'pending'
}

/** 生成退款冲正记录（关联原消费）；非法输入抛错 */
export function makeRefund(original, input = {}) {
  if (!original || original.type !== 'expense')
    throw new Error('只能对一笔支出记录登记退款')
  const amt = num(input.amount)
  if (!(amt > 0)) throw new Error('请输入正确的退款金额')
  if (amt > num(original.amount)) throw new Error('退款金额不能超过原消费金额')
  return {
    id: newId(),
    date: String(input.date || original.date),
    type: 'expense',
    category: original.category || '未分类',
    amount: r2(amt),
    accountId: original.accountId || '',
    note: (input.note || '').trim() || `退款冲正（原记录 ${original.date}）`,
    source: '手动',
    flag: FLAGS.REFUND,
    linkId: original.id,
    createdAt: input.createdAt || stamp()
  }
}

/** 生成代垫记录（替他人 / 公司先付，待报销）；非法输入抛错 */
export function makeAdvance(input = {}) {
  const amt = num(input.amount)
  if (!(amt > 0)) throw new Error('请输入正确的代垫金额')
  const date = String(input.date || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('请选择日期')
  return {
    id: newId(),
    date,
    type: 'expense',
    category: input.category || '代垫',
    amount: r2(amt),
    accountId: input.accountId || '',
    note: (input.note || '').trim() || '代垫（待报销）',
    source: '手动',
    flag: FLAGS.ADVANCE,
    createdAt: input.createdAt || stamp()
  }
}

/** 生成报销款记录（收回代垫）；非法输入抛错 */
export function makeReimburse(advance, input = {}) {
  if (!advance || advance.flag !== FLAGS.ADVANCE)
    throw new Error('只能对一条代垫记录登记报销')
  const amt = num(input.amount)
  if (!(amt > 0)) throw new Error('请输入正确的报销金额')
  if (amt > num(advance.amount)) throw new Error('报销金额不能超过代垫金额')
  const date = String(input.date || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('请选择日期')
  return {
    id: newId(),
    date,
    type: 'income',
    category: input.category || '报销',
    amount: r2(amt),
    accountId: input.accountId || advance.accountId || '',
    note: (input.note || '').trim() || `报销收回（代垫 ${advance.date}）`,
    source: '手动',
    flag: FLAGS.REIMBURSE,
    linkId: advance.id,
    createdAt: input.createdAt || stamp()
  }
}
