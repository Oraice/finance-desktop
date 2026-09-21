// 阶段 4 流水管理纯函数单元测试：node test/records.test.mjs
import assert from 'node:assert'
import {
  filterRecords, sortRecords, paginate, uniqueCategories,
  withRecordRestored, withoutRecord, withRecordReverted
} from '../renderer/records-ui.mjs'

const r = (id, date, type, amount, category, note = '') => ({ id, date, type, amount, category, note })
const data = [
  r('1', '2026-09-01', 'expense', 50, '餐饮', '美团外卖'),
  r('2', '2026-09-10', 'income', 8000, '工资'),
  r('3', '2026-08-20', 'expense', 30, '交通', '地铁充值'),
  r('4', '2026-09-05', 'expense', 120, '餐饮', '聚餐AA'),
  r('5', '2026-07-01', 'expense', 9.9, '娱乐', '电影票')
]

let passed = 0
const ok = (name, fn) => { fn(); passed++; console.log('  ✔', name) }

console.log('records-ui 纯函数单元测试')

ok('filterRecords：类型/分类/关键字组合过滤', () => {
  assert.strictEqual(filterRecords(data, {}).length, 5)
  assert.strictEqual(filterRecords(data, { type: 'income' }).length, 1)
  assert.strictEqual(filterRecords(data, { category: '餐饮' }).length, 2)
  assert.strictEqual(filterRecords(data, { keyword: '地铁' }).length, 1)
  assert.strictEqual(filterRecords(data, { type: 'expense', category: '餐饮', keyword: '外卖' }).length, 1)
})

ok('filterRecords：结果按日期降序', () => {
  const out = filterRecords(data, {})
  assert.deepStrictEqual(out.map((x) => x.id), ['2', '4', '1', '3', '5'])
})

ok('sortRecords：日期升序、金额升降序', () => {
  const list = [
    r('a', '2026-09-03', 'expense', 100, '购物'),
    r('b', '2026-09-01', 'expense', 500, '购物'),
    r('c', '2026-09-03', 'expense', 20, '购物')
  ]
  assert.deepStrictEqual(sortRecords(list, 'date-asc').map((x) => x.id), ['b', 'a', 'c'])
  assert.deepStrictEqual(sortRecords(list, 'date-desc').map((x) => x.id), ['a', 'c', 'b'])
  assert.deepStrictEqual(sortRecords(list, 'amount-desc').map((x) => x.id), ['b', 'a', 'c'])
  assert.deepStrictEqual(sortRecords(list, 'amount-asc').map((x) => x.id), ['c', 'a', 'b'])
})

ok('paginate：每页20条、越界页码自动钳制', () => {
  const big = Array.from({ length: 45 }, (_, i) => r(String(i), '2026-09-01', 'expense', 1, '购物'))
  const p1 = paginate(big, 1)
  assert.strictEqual(p1.pages, 3)
  assert.strictEqual(p1.slice.length, 20)
  assert.strictEqual(p1.from, 1)
  assert.strictEqual(p1.to, 20)
  const p3 = paginate(big, 3)
  assert.strictEqual(p3.slice.length, 5)
  assert.strictEqual(p3.from, 41)
  assert.strictEqual(paginate(big, 99).page, 3, '页码钳到最后一页')
  assert.strictEqual(paginate(big, -1).page, 1, '页码钳到第一页')
  assert.strictEqual(paginate([], 1).slice.length, 0)
})

ok('uniqueCategories：去重（排序依赖 ICU locale，断言集合一致）', () => {
  const cats = uniqueCategories(data)
  assert.strictEqual(cats.length, 4)
  assert.deepStrictEqual([...cats].sort(), ['交通', '娱乐', '工资', '餐饮'].sort())
})

ok('withRecordRestored：缺失则加回、已存在则原数组不动', () => {
  const gone = r('9', '2026-09-20', 'expense', 15, '餐饮')
  assert.strictEqual(withRecordRestored(data, gone).length, 6)
  assert.strictEqual(withRecordRestored(data, data[0]), data)
})

ok('withoutRecord：移除指定 id、其余保留', () => {
  assert.strictEqual(withoutRecord(data, '1').length, 4)
  assert.strictEqual(withoutRecord(data, 'nope').length, 5)
})

ok('withRecordReverted：用旧记录覆盖同 id、长度不变', () => {
  const old = { ...data[0], amount: 999, note: '旧值' }
  const out = withRecordReverted(data, old)
  assert.strictEqual(out.find((x) => x.id === '1').amount, 999)
  assert.strictEqual(out.length, 5)
})

console.log(`\n全部通过：${passed} 组用例 ✅`)
