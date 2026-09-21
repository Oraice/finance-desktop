// ---------------------------------------------------------------------------
// reminders.mjs —— 信用卡账单日 / 还款日（含负债）提醒纯逻辑，无副作用、可单测。
// ---------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0')

const clampDay = (v) => {
  const d = parseInt(v, 10)
  return Number.isFinite(d) ? Math.min(31, Math.max(1, d)) : 0
}
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const toIso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`

const parseToday = (s) => {
  const [y, m, d] = String(s).split('-').map(Number)
  if (!(y >= 1970 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) throw new Error('今天日期不正确')
  return { y, m, d }
}

/** 从今天 t 起，找每月 day 号的下一次日期与剩余天数；day 为 0 表示无此日期 */
function nextDayOccurrence(t, day) {
  if (!day) return null
  const thisLast = daysInMonth(t.y, t.m)
  const thisDay = Math.min(day, thisLast)
  if (thisDay >= t.d) {
    return { y: t.y, m: t.m, d: thisDay, daysLeft: thisDay - t.d }
  }
  const nm = t.m === 12 ? { y: t.y + 1, m: 1 } : { y: t.y, m: t.m + 1 }
  const nextDay = Math.min(day, daysInMonth(nm.y, nm.m))
  return { y: nm.y, m: nm.m, d: nextDay, daysLeft: thisLast - t.d + nextDay }
}

/**
 * 计算今天起 withinDays 天内（含今天）的账单日 / 还款日事件。
 * 只处理 credit（账单日 + 还款日）与 debt（还款日）；归档账户跳过。
 * 按剩余天数升序返回：
 *   { id, accountId, accountName, kind('statement'|'due'), date, daysLeft }
 */
export function upcomingCreditEvents(accounts, today, withinDays) {
  const t = parseToday(today)
  const win = Math.max(0, Number(withinDays) || 0)
  const out = []
  for (const a of accounts || []) {
    if (a.archived) continue
    if (a.type === 'credit') {
      push(out, a, 'statement', a.statementDay, t, win)
      push(out, a, 'due', a.dueDay, t, win)
    } else if (a.type === 'debt' && a.dueDay) {
      push(out, a, 'due', a.dueDay, t, win)
    }
  }
  return out.sort((x, y) =>
    x.daysLeft - y.daysLeft || x.accountName.localeCompare(y.accountName, 'zh'))
}

function push(out, a, kind, dayRaw, t, win) {
  const occ = nextDayOccurrence(t, clampDay(dayRaw))
  if (occ && occ.daysLeft <= win) {
    out.push({
      id: `${a.id}-${kind}-${occ.y}${pad(occ.m)}${pad(occ.d)}`,
      accountId: a.id,
      accountName: a.name,
      kind,
      date: toIso(occ.y, occ.m, occ.d),
      daysLeft: occ.daysLeft
    })
  }
}

export const EVENT_LABEL = { statement: '账单日', due: '还款日' }
