// 阶段 5 报表导出单元测试：node test/export.test.mjs
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { buildWorkbook, workbookToBytes, reportFileName } from '../renderer/xlsx/export-core.mjs'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const ledger = {
  name: '公司/主账套*2026',
  records: [
    { id: '1', date: '2026-08-01', type: 'income', amount: 10000, category: '工资', note: '', source: '手动' },
    { id: '2', date: '2026-08-05', type: 'expense', amount: 300, category: '餐饮', note: '食堂', source: 'demo' },
    { id: '3', date: '2026-09-02', type: 'expense', amount: 1200, category: '居家', note: '房租', source: 'imp-abc' },
    { id: '4', date: '2026-09-03', type: 'income', amount: 500, category: '报销', note: '差旅', source: 'imp-abc' }
  ]
}

let passed = 0
const ok = (name, fn) => { fn(); passed++; console.log('  ✔', name) }

console.log('export-core 单元测试')

ok('工作簿三张 Sheet 且可被 SheetJS 回读', () => {
  const wb = buildWorkbook(XLSX, ledger, { typeFilter: 'all' })
  assert.deepStrictEqual(wb.SheetNames, ['月度汇总', '分类占比', '收支明细(4)'])
  const bytes = workbookToBytes(XLSX, wb)
  assert.ok(bytes instanceof Uint8Array && bytes.length > 1000)
  const back = XLSX.read(bytes, { type: 'array' })
  assert.deepStrictEqual(back.SheetNames, wb.SheetNames)
})

ok('月度汇总：行值与合计正确', () => {
  const wb = buildWorkbook(XLSX, ledger, { typeFilter: 'all' })
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['月度汇总'], { header: 1 })
  assert.deepStrictEqual(rows[0], ['月份', '收入', '支出', '结余'])
  assert.deepStrictEqual(rows[1], ['2026-08', 10000, 300, 9700])
  assert.deepStrictEqual(rows[2], ['2026-09', 500, 1200, -700])
  assert.deepStrictEqual(rows[3], ['合计', 10500, 1500, 9000])
})

ok('分类占比：含占比与收支两块', () => {
  const wb = buildWorkbook(XLSX, ledger, { typeFilter: 'all' })
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['分类占比'], { header: 1 })
  assert.deepStrictEqual(rows[0], ['支出分类', '金额', '占比'])
  const idx = rows.findIndex((r) => r[0] === '居家')
  assert.ok(idx > 0)
  assert.ok(Math.abs(rows[idx][2] - 0.8) < 1e-9) // 1200/1500
  assert.ok(rows.some((r) => r[0] === '收入分类'))
})

ok('明细筛选：仅支出时只含 2 条', () => {
  const wb = buildWorkbook(XLSX, ledger, { typeFilter: 'expense' })
  assert.ok(wb.SheetNames[2].includes('(2)'))
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[2]], { header: 1 })
  assert.strictEqual(rows.length, 3) // 表头 + 2
  assert.ok(rows[1].includes('Excel导入') || rows[2].includes('Excel导入')) // 来源可读
})

ok('文件名：非法字符清洗 + 时间戳后缀', () => {
  const name = reportFileName(ledger.name, new Date(2026, 8, 19, 9, 5))
  assert.strictEqual(name, '公司_主账套_2026_财务报表_20260919_0905.xlsx')
})

console.log(`\n全部通过：${passed} 组用例 ✅`)
