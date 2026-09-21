// ---------------------------------------------------------------------------
// funds.mjs —— 资金账户 / 转账（含信用卡、负债）的纯聚合与校验
// 与渲染分离，所有函数无副作用，可在 Node 单元测试中直接验证。
//
// 数据模型：
//   账户 account = { id, name, type, icon, openingBalance,
//                     creditLimit/statementDay/dueDay（信用卡）, archived }
//   转账 transfer = { id, date, fromId, toId, amount, note, source }
//   流水 record 可带 accountId（该笔收支发生在某个资金账户）。
//
// 方向约定：
//   资产账户（现金/储蓄卡/电子钱包/投资理财）用 balance（正=拥有）；
//   负债账户（信用卡/负债借贷）用 debt（正=欠多少）。
// ---------------------------------------------------------------------------

const r2 = (v) => Math.round(Number(v || 0) * 100) / 100

export const ACCOUNT_TYPES = [
  { value: 'cash', label: '现金', icon: '💵', liability: false },
  { value: 'debit', label: '储蓄卡', icon: '🏦', liability: false },
  { value: 'ewellet', label: '电子钱包', icon: '📱', liability: false },
  { value: 'credit', label: '信用卡', icon: '💳', liability: true },
  { value: 'debt', label: '负债 / 借贷', icon: '📝', liability: true },
  { value: 'investment', label: '投资理财', icon: '📈', liability: false }
]

export const isLiabilityType = (t) => t === 'credit' || t === 'debt'

// ------------------------------ 账户校验 -----------------------------------

/** 规整并校验一个账户（不含 id，id 由存储层生成）。失败抛错。 */
export function normalizeAccount(input = {}) {
  const name = String(input.name || '').trim()
  if (!name) throw new Error('账户名称不能为空')
  if (name.length > 10) throw new Error('账户名称不能超过 10 个字')

  const type = String(input.type || 'cash')
  if (!ACCOUNT_TYPES.some((t) => t.value === type)) throw new Error('账户类型不正确')

  const opening = Number(input.openingBalance)
  if (!Number.isFinite(opening) || opening < 0) throw new Error('初始金额需为不小于 0 的数字')
  if (opening > 1e8) throw new Error('初始金额过大')

  const out = {
    name,
    type,
    icon: String(input.icon || '').slice(0, 4),
    openingBalance: r2(opening),
    archived: !!input.archived
  }

  if (type === 'credit') {
    const limit = Number(input.creditLimit)
    if (!Number.isFinite(limit) || limit <= 0) throw new Error('请填写正确的信用卡额度')
    if (limit > 1e7) throw new Error('信用额度过大')
    const sd = parseInt(input.statementDay, 10)
    const dd = parseInt(input.dueDay, 10)
    if (!(sd >= 1 && sd <= 31)) throw new Error('账单日需为 1-31 之间')
    if (!(dd >= 1 && dd <= 31)) throw new Error('还款日需为 1-31 之间')
    out.creditLimit = r2(limit)
    out.statementDay = sd
    out.dueDay = dd
  }
  return out
}

/** 校验一笔转账内容（不含 id）。失败抛错，成功返回规整对象。 */
export function validateTransfer(t = {}, accounts = []) {
  if (!t.fromId || !t.toId) throw new Error('请选择转出与转入账户')
  if (t.fromId === t.toId) throw new Error('转出和转入账户不能相同')
  const byId = new Map(accounts.map((a) => [a.id, a]))
  if (!byId.get(t.fromId) || !byId.get(t.toId)) throw new Error('账户不存在，请重新选择')

  const amt = Number(t.amount)
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('转账金额需为大于 0 的数字')
  if (amt > 1e8) throw new Error('转账金额过大')

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(t.date || ''))) throw new Error('请选择转账日期')

  return {
    fromId: t.fromId,
    toId: t.toId,
    amount: r2(amt),
    date: t.date,
    note: String(t.note || '').slice(0, 50)
  }
}

/**
 * 账户作为“转出方”时，当前最多可转出的金额：
 *   信用卡：可用额度（额度 − 已欠款），套现 / 借出不能超额度；
 *   现金 / 储蓄卡 / 电子钱包 / 投资理财：当前余额，这类账户不可透支；
 *   负债 / 借贷（debt）：无硬性额度（语义为对外借出 / 调账），不限制。
 */
export function transferOutCapacity(account = {}) {
  if (account.type === 'credit') {
    const avail = account.available != null
      ? account.available
      : r2((account.creditLimit || 0) - (account.debt || 0))
    return Math.max(0, r2(avail))
  }
  if (isLiabilityType(account.type)) return Infinity
  return Math.max(0, r2(account.balance || 0))
}

/**
 * 校验一笔转账在“当前余额”下是否可执行（新增前调用，balances 不含该笔）。
 * 不可透支账户余额不足、或信用卡转出超出可用额度时抛错。
 */
export function assertTransferAffordable(t = {}, balances = []) {
  const from = balances.find((a) => a.id === t.fromId)
  if (!from) return
  const cap = transferOutCapacity(from)
  if (Number.isFinite(cap) && r2(t.amount) > cap) {
    const label = from.type === 'credit' ? '可用额度' : '可用余额'
    throw new Error(`${from.name}${label}不足，当前最多可转 ¥${cap.toFixed(2)}`)
  }
}

// ------------------------------ 余额聚合 -----------------------------------

/**
 * 计算每个账户的当前余额 / 欠款。
 * 返回账户数组（含 balance 资产余额、debt 欠款、available 信用卡可用额度）。
 * 未带 accountId 的流水不纳入任何账户（视为“未指定账户”）。
 */
export function accountBalances(accounts = [], records = [], transfers = []) {
  const map = new Map(accounts.map((a) => [
    a.id,
    {
      ...a,
      openingBalance: r2(a.openingBalance),
      balance: isLiabilityType(a.type) ? 0 : r2(a.openingBalance),
      debt: isLiabilityType(a.type) ? r2(a.openingBalance) : 0
    }
  ]))

  const apply = (id, fn) => {
    const a = map.get(id)
    if (a) fn(a)
  }

  for (const r of records) {
    if (!r.accountId) continue
    const amt = r2(r.amount)
    if (r.type === 'income') {
      apply(r.accountId, (a) => { if (isLiabilityType(a.type)) a.debt -= amt; else a.balance += amt })
    } else if (r.type === 'expense') {
      apply(r.accountId, (a) => { if (isLiabilityType(a.type)) a.debt += amt; else a.balance -= amt })
    }
  }

  for (const t of transfers) {
    const amt = r2(t.amount)
    // 转出：资产减 / 负债增（从负债转出=借出/套现）
    apply(t.fromId, (a) => { if (isLiabilityType(a.type)) a.debt += amt; else a.balance -= amt })
    // 转入：资产增 / 负债减（转入负债=还款）
    apply(t.toId, (a) => { if (isLiabilityType(a.type)) a.debt -= amt; else a.balance += amt })
  }

  for (const a of map.values()) {
    a.balance = r2(a.balance)
    a.debt = r2(a.debt)
    if (a.type === 'credit') a.available = r2((a.creditLimit || 0) - a.debt)
  }
  return [...map.values()]
}

/** 净资产汇总：总资产、总负债、净资产 = 资产 − 负债 */
export function netWorth(balances = []) {
  let assets = 0
  let debts = 0
  for (const a of balances) {
    if (isLiabilityType(a.type)) debts += a.debt
    else assets += a.balance
  }
  return { assets: r2(assets), debts: r2(debts), net: r2(assets - debts) }
}

// ---------------------------- 撤销数据变换（纯函数） -------------------------

/** 撤销删除账户：账户若已不存在则加回 */
export const withAccountRestored = (accounts, a) =>
  accounts.some((x) => x.id === a.id) ? accounts : [...accounts, a]

/** 撤销新增账户：移除指定 id */
export const withoutAccount = (accounts, id) => accounts.filter((x) => x.id !== id)

/** 撤销编辑账户：用旧账户覆盖同 id */
export const withAccountReverted = (accounts, old) =>
  accounts.map((x) => (x.id === old.id ? old : x))

/** 撤销新增转账：移除指定 id（余额由聚合自动回退） */
export const withoutTransfer = (transfers, id) => transfers.filter((x) => x.id !== id)

/** 撤销删除转账：转账若已不存在则加回 */
export const withTransferRestored = (transfers, t) =>
  transfers.some((x) => x.id === t.id) ? transfers : [...transfers, t]
