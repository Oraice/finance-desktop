// 临时：生成 #39 四个新界面（周期管理/到期/提醒/对账）的静态内联预览
import fs from 'node:fs'

const css = fs.readFileSync('renderer/styles.css', 'utf8') + '\n' + fs.readFileSync('renderer/funds.css', 'utf8')
const override = `
body{background:#f5f6f8;padding:20px}
.modal{margin:0 0 22px;box-shadow:none;border:1px solid var(--line)}
`

const body = `
<div class="modal modal-lg">
  <div class="modal-title">周期记账</div>
  <p class="muted" style="margin-bottom:12px">设置按天 / 周 / 月 / 年自动重复的收支（如房租、工资、会员订阅）。到期时打开账本会列出明细让你确认入账，不会自动偷偷记账。</p>
  <div>
    <div class="recurring-row">
      <div class="rr-main"><span class="rr-ic">🧾</span>
        <div class="rr-meta"><div class="rr-title">房租 · ¥1,500.00</div>
          <div class="rr-sub">每月 · 开始 2026-01-01</div></div></div>
      <div class="rr-actions"><button class="btn btn-sm">停用</button><button class="btn btn-sm">编辑</button><button class="btn btn-sm btn-danger">删除</button></div>
    </div>
    <div class="recurring-row is-off">
      <div class="rr-main"><span class="rr-ic">💰</span>
        <div class="rr-meta"><div class="rr-title">工资 · ¥8,000.00 <span class="rr-off-tag">已停用</span></div>
          <div class="rr-sub">每月 · 开始 2026-01-05</div></div></div>
      <div class="rr-actions"><button class="btn btn-sm">启用</button><button class="btn btn-sm">编辑</button><button class="btn btn-sm btn-danger">删除</button></div>
    </div>
  </div>
  <button class="btn btn-primary btn-block">＋ 新建周期账单</button>
</div>

<div class="modal modal-lg">
  <div class="modal-title">有周期账单到期</div>
  <div>
    <div class="due-group">
      <div class="due-group-title">支出 · 2 笔 · 房租</div>
      <div class="due-line"><span>2026-08-01</span><span class="expense">-¥1,500.00</span></div>
      <div class="due-line"><span>2026-09-01</span><span class="expense">-¥1,500.00</span></div>
    </div>
  </div>
  <div class="modal-actions"><button class="btn">暂不入账</button><button class="btn btn-primary">全部入账</button></div>
</div>

<div class="modal modal-lg">
  <div class="modal-title">账单 / 还款提醒</div>
  <div>
    <div class="reminder-row">
      <div class="rmr-main"><span class="rmr-ic">💳</span>
        <div class="rmr-meta"><div class="rmr-title">招行信用卡 · 还款日</div>
          <div class="rmr-sub">2026-09-22 · 当前待还 ¥500.00</div></div></div>
      <span class="rmr-days urgent">2 天后</span>
    </div>
    <div class="reminder-row">
      <div class="rmr-main"><span class="rmr-ic">📋</span>
        <div class="rmr-meta"><div class="rmr-title">招行信用卡 · 账单日</div>
          <div class="rmr-sub">2026-09-25</div></div></div>
      <span class="rmr-days">5 天后</span>
    </div>
  </div>
  <div class="pf-style-panel">
    <div class="switch-row"><input type="checkbox" checked /><span>打开账本时提醒近期账单日 / 还款日</span></div>
    <div class="cfg-row" style="margin:10px 0 0"><label>提前 <input type="number" value="3" style="width:70px;max-width:none" /> 天提醒</label></div>
  </div>
  <div class="modal-actions"><button class="btn btn-primary">完成</button></div>
</div>

<div class="modal modal-lg">
  <div class="modal-title">账户对账</div>
  <div class="rc-head"><span class="rc-ic">🏦</span>
    <div><div class="rc-name">储蓄卡</div><div class="rc-sub">核对实际余额</div></div></div>
  <div class="cfg-row rc-values">
    <div class="rc-val"><span class="rc-val-label">账面值</span><span>¥11,000.00</span></div>
    <div class="rc-val"><span class="rc-val-label">实际盘点</span><input type="number" value="10800" style="width:130px;max-width:none" /></div>
    <div class="rc-val"><span class="rc-val-label">差额</span><span class="expense">-¥200.00</span></div>
  </div>
  <div class="rc-history-wrap">
    <div class="rc-history-title">该账户对账历史</div>
    <div class="rc-hist-row"><span>2026-08-31</span><span>账面 ¥10,000.00</span><span>实际 ¥10,000.00</span><span>差额 ¥0.00</span><span>已标记</span></div>
    <div class="rc-hist-row"><span>2026-07-31</span><span>账面 ¥9,800.00</span><span>实际 ¥9,750.00</span><span>差额 -¥50.00</span><span>已调整</span></div>
  </div>
  <div class="modal-actions"><button class="btn">仅标记已对账</button><button class="btn btn-primary">记一笔调整并完成</button></div>
</div>
`

fs.writeFileSync('.preview-ui.html',
  `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>#39界面预览</title><style>${css}${override}</style></head><body>${body}</body></html>`)
console.log('preview html written')
