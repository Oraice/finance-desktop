// 阶段 2 核心解析单元测试：node test/import-core.test.mjs
import { createRequire } from 'node:module'
import assert from 'node:assert'
import {
  detectHeaderRow, guessMapping, normalizeRecords,
  parseAmount, parseDate, inferCategory, sheetToGrid
} from '../renderer/xlsx/import-core.mjs'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

let passed = 0
const ok = (name, fn) => { fn(); passed++; console.log('  ✔', name) }

// —— 样例 1：银行流水（标题行 + 收入/支出双列 + Excel 序列日期 + 带符号金额串）
const wb1 = XLSX.utils.book_new()
const ws1 = XLSX.utils.aoa_to_sheet([
  ['某某银行个人结算交易明细'],
  [],
  ['交易日期', '摘要', '收入金额', '支出金额'],
  [45658, '工资发放', '12000.00', null],
  [45659, '地铁出行', null, '¥24.50'],
  [45660, '超市采购', null, 189.9],
  [null, null, null, null] // 空行应被跳过
])
XLSX.utils.book_append_sheet(wb1, ws1, '流水')

// —— 样例 2：支付宝式（单列带符号）
const ws2 = XLSX.utils.aoa_to_sheet([
  ['交易时间', '交易对方', '金额'],
  ['2026.09.01', '饿了么', -38.5],
  ['2026.09.02', '余额宝转入', 5000],
  ['2026/09/03 12:30:00', '滴滴出行', -21.0]
])

// —— 样例 3：微信式（类型列 + 金额列 + 分类列）
const ws3 = XLSX.utils.aoa_to_sheet([
  ['日期', '类型', '金额', '商品', '支付方式'],
  ['2026-09-01', '支出', '¥45.00', '美团外卖', '零钱'],
  ['2026-09-05', '收入', '3000.00', '报销', '银行卡']
])

console.log('import-core 单元测试')

ok('标题行干扰下正确定位表头', () => {
  const grid = sheetToGrid(ws1, XLSX)
  assert.strictEqual(detectHeaderRow(grid), 2)
})

ok('双列流水：自动识别 twoCol 模式并解析', () => {
  const grid = sheetToGrid(ws1, XLSX)
  const headers = (grid[2] || []).map(String)
  const cfg = guessMapping(headers)
  assert.strictEqual(cfg.mode, 'twoCol')
  const { records, skipped } = normalizeRecords(grid, 2, cfg)
  assert.strictEqual(records.length, 3, '应解析出 3 条')
  assert.strictEqual(skipped, 1, '空行应计入 skipped')
  assert.strictEqual(records[0].type, 'income')
  assert.strictEqual(records[0].amount, 12000)
  assert.strictEqual(records[0].date, '2025-01-01') // Excel 序列号 45658
  assert.strictEqual(records[1].amount, 24.5, '"¥24.50" 应清洗为数字')
  assert.strictEqual(inferCategory('地铁出行'), '交通')
})

ok('单列带符号：正收负支', () => {
  const grid = sheetToGrid(ws2, XLSX)
  const idx = detectHeaderRow(grid)
  const cfg = guessMapping(grid[idx].map(String))
  assert.strictEqual(cfg.mode, 'signed')
  const { records } = normalizeRecords(grid, idx, cfg)
  assert.strictEqual(records.length, 3)
  assert.strictEqual(records[0].type, 'expense')
  assert.strictEqual(records[0].amount, 38.5)
  assert.strictEqual(records[1].type, 'income')
  assert.strictEqual(records[0].date, '2026-09-01', '"2026.09.01" 应标准化')
  assert.strictEqual(records[2].date, '2026-09-03', '带时分秒应截取日期')
})

ok('类型列 + 金额列', () => {
  const grid = sheetToGrid(ws3, XLSX)
  const cfg = guessMapping(grid[0].map(String))
  assert.strictEqual(cfg.mode, 'typeCol')
  const { records } = normalizeRecords(grid, 0, cfg)
  assert.strictEqual(records.length, 2)
  assert.strictEqual(records[0].type, 'expense')
  assert.strictEqual(records[0].amount, 45)
  assert.strictEqual(records[1].type, 'income')
  assert.strictEqual(records[1].amount, 3000)
})

ok('金额/日期解析边界', () => {
  assert.strictEqual(parseAmount('¥1,234.50'), 1234.5)
  assert.strictEqual(parseAmount('（50.00）'), -50, '括号记负数')
  assert.strictEqual(parseAmount('abc'), null)
  assert.strictEqual(parseDate(45658), '2025-01-01')
  assert.strictEqual(parseDate(99999999), null, '超界序列号拒绝')
  assert.strictEqual(parseDate('不是日期'), null)
})

ok('分类推断覆盖常见场景', () => {
  assert.strictEqual(inferCategory('国家电网电费'), '居家')
  assert.strictEqual(inferCategory('打车费用'), '交通')
  assert.strictEqual(inferCategory('999感冒药'), '医疗')
  assert.strictEqual(inferCategory('随便什么'), '未分类')
})

console.log(`\n全部通过：${passed} 组用例 ✅`)
