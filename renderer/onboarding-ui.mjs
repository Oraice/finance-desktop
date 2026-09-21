'use strict'

// ---------------------------------------------------------------------------
// onboarding-ui.mjs —— 首次使用新手引导：3 步轻量卡片，可跳过、可再次查看。
// 完成后由 app.js 把 profile.onboarded 置为 true（跟随账户持久化）。
// ---------------------------------------------------------------------------

import { bindModalEsc } from './ui/dialog.mjs'

const $ = (s) => document.querySelector(s)

const STEPS = [
  {
    icon: '💼',
    title: '第一步 · 建立资金账户',
    desc: '在「账户」页添加现金、储蓄卡、电子钱包或信用卡，净资产、可用额度与账单日会自动汇总，之后还能在账户间转账、给信用卡还款。'
  },
  {
    icon: '🧾',
    title: '第二步 · 记下第一笔',
    desc: '点「＋ 记一笔」记录收支，或在「导入」页用 Excel 批量导入。看板趋势、年度账单、收支环比与记账日历热力图都会自动生成。'
  },
  {
    icon: '🔒',
    title: '第三步 · 数据始终在你手里',
    desc: '所有数据仅保存在本机、运行时零联网。可设置预算、加密备份、导出 Excel 与 PDF 月报。现在开始你的第一笔记账吧。'
  }
]

let step = 0
let afterDone = async () => {}

export function initOnboarding(deps = {}) {
  afterDone = typeof deps.afterDone === 'function' ? deps.afterDone : afterDone
  $('#ob-next').addEventListener('click', next)
  $('#ob-skip').addEventListener('click', finish)
  bindModalEsc($('#onboarding-mask'), finish)
}

function render() {
  const s = STEPS[step]
  $('#ob-icon').textContent = s.icon
  $('#ob-title').textContent = s.title
  $('#ob-desc').textContent = s.desc
  $('#ob-next').textContent = step === STEPS.length - 1 ? '开始使用' : '下一步'
  $('#ob-skip').hidden = step === STEPS.length - 1
  $('#ob-dots').innerHTML = STEPS
    .map((_, i) => `<span class="ob-dot${i === step ? ' active' : ''}"></span>`).join('')
}

function next() {
  if (step < STEPS.length - 1) { step++; render() }
  else finish()
}

async function finish() {
  $('#onboarding-mask').classList.add('hidden')
  step = 0
  try { await afterDone() } catch (e) { console.error('保存引导状态失败:', e.message) }
}

export function openOnboarding() {
  step = 0
  render()
  $('#onboarding-mask').classList.remove('hidden')
  $('#ob-next').focus()
}
