// ---------------------------------------------------------------------------
// reconcile.mjs —— 账户对账纯逻辑：账面值与实际盘点值的差额、对账记录规整、
// 对账调整流水生成。无副作用、可单测。
// ---------------------------------------------------------------------------

import { isLiabilityType } from './funds.mjs'

const r2 = (v) => Math.round(Number(v || 0) * 100) / 100

/**
 * 对账差额。
 * 资产账户比账面余额 balance；负债账户比账面欠款 debt。
 * actual 为用户实际盘点值（负债为实际欠款）。
 * 返回 { isLiab, systemValue, actualValue, diff(actual-system) }
 */
export function reconcileDiff(account, actual) {
  const isLiab = isLiabilityType(account.type)
  const systemValue = r2(isLiab ? account.debt : account.balance)
  const actualValue = r2(actual)
  return { isLiab, systemValue, actualValue, diff: r2(actualValue - systemValue) }
}

/** 规整一条对账记录（不含 id，id 由调用层生成）；非法抛错 */
export function normalizeReconciliation(input = {}) {
  const accountId = String(input.accountId || '')
  if (!accountId) throw new Error('缺少对账账户')
  const date = String(input.date || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('对账日期不正确')
  const systemValue = r2(input.systemValue)
  const actualValue = r2(input.actualValue)
  const diff = r2(input.diff != null ? input.diff : actualValue - systemValue)
  return {
    accountId,
    accountName: String(input.accountName || '').slice(0, 10),
    date,
    systemValue,
    actualValue,
    diff,
    adjusted: input.adjusted === true,
    note: String(input.note || '').slice(0, 50)
  }
}

/**
 * 据差额生成“对账调整”流水（带 accountId），使账面值经此一笔后恰等于实际值；
 * 差额为 0 返回 null。
 * 资产：盘盈(diff>0)记收入、盘亏(diff<0)记支出；
 * 负债：欠多了(diff>0)记支出、欠少了(diff<0)记收入。
 */
export function adjustmentRecord(account, diffResult) {
  const diff = r2(diffResult.diff)
  if (Math.abs(diff) < 0.01) return null
  const isLiab = diffResult.isLiab
  const type = diff > 0 ? (isLiab ? 'expense' : 'income') : (isLiab ? 'income' : 'expense')
  const verb = diff > 0 ? '盘盈' : '盘亏'
  return {
    date: diffResult.date || '',
    type,
    category: '对账调整',
    amount: Math.abs(diff),
    note: `${account.name} 对账${isLiab ? '欠款' : ''}${verb}`,
    accountId: account.id,
    source: '对账'
  }
}
