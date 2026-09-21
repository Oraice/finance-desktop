// 应用个性化设置校验单元测试：node test/settings-core.test.mjs
import assert from 'node:assert'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const settings = require('../settings-core.cjs')

let passed = 0
const ok = (name, fn) => { fn(); passed++; console.log('  ✔', name) }

console.log('settings-core 单元测试')

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
const JPEG = 'data:image/jpeg;base64,/9j/4AAQ'
const WEBP = 'data:image/webp;base64,UklGRiQ='

ok('validateDataImage：合法 png / jpeg / webp 均通过', () => {
  for (const d of [PNG, JPEG, WEBP]) {
    const r = settings.validateDataImage(d)
    assert.strictEqual(r.ok, true)
    assert.strictEqual(r.value, d)
  }
})

ok('validateDataImage：空串默认允许（value 为空）', () => {
  const r = settings.validateDataImage('')
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.value, '')
})

ok('validateDataImage：allowEmpty=false 时空串拒绝', () => {
  const r = settings.validateDataImage('', false)
  assert.strictEqual(r.ok, false)
})

ok('validateDataImage：gif / http 链接 / 非法字符 拒绝', () => {
  const bad = [
    'data:image/gif;base64,R0lGOD',
    'http://example.com/a.png',
    'data:image/png;base64,@@@',
    'not-a-data-url'
  ]
  for (const d of bad) assert.strictEqual(settings.validateDataImage(d).ok, false)
})

ok('validateDataImage：超过大小上限拒绝', () => {
  const huge = 'data:image/png;base64,' + 'A'.repeat(settings.MAX_IMG_CHARS + 10)
  const r = settings.validateDataImage(huge)
  assert.strictEqual(r.ok, false)
})

ok('normalizeSettings：正常名称 + logo 返回规整结果', () => {
  const r = settings.normalizeSettings({ appName: '我的账本 Pro', appLogo: PNG })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.value.appName, '我的账本 Pro')
  assert.strictEqual(r.value.appLogo, PNG)
})

ok('normalizeSettings：名称去除首尾空格', () => {
  const r = settings.normalizeSettings({ appName: '  随手记  ' })
  assert.strictEqual(r.value.appName, '随手记')
  assert.strictEqual(r.value.appLogo, '')
})

ok('normalizeSettings：空 / 纯空格名称拒绝', () => {
  assert.strictEqual(settings.normalizeSettings({ appName: '' }).ok, false)
  assert.strictEqual(settings.normalizeSettings({ appName: '   ' }).ok, false)
})

ok('normalizeSettings：超长名称拒绝', () => {
  const r = settings.normalizeSettings({ appName: 'x'.repeat(settings.MAX_NAME + 1) })
  assert.strictEqual(r.ok, false)
})

ok('normalizeSettings：非法 logo 拒绝', () => {
  const r = settings.normalizeSettings({ appName: '账', appLogo: 'http://x/y.png' })
  assert.strictEqual(r.ok, false)
})

ok('validateLedgerIcon：空与合法图片通过，非法拒绝', () => {
  assert.strictEqual(settings.validateLedgerIcon('').ok, true)
  assert.strictEqual(settings.validateLedgerIcon(JPEG).ok, true)
  assert.strictEqual(settings.validateLedgerIcon('data:image/gif;base64,x').ok, false)
})

ok('defaultSettings：空对象回退默认名称与空 logo', () => {
  const d = settings.defaultSettings({})
  assert.strictEqual(d.appName, settings.DEFAULT_APP_NAME)
  assert.strictEqual(d.appLogo, '')
})

ok('defaultSettings：保留合法名称与 logo', () => {
  const d = settings.defaultSettings({ appName: '自定义', appLogo: WEBP })
  assert.strictEqual(d.appName, '自定义')
  assert.strictEqual(d.appLogo, WEBP)
})

ok('defaultSettings：非法 logo 丢弃、空白名称回退默认', () => {
  const d = settings.defaultSettings({ appName: '  ', appLogo: 'bad' })
  assert.strictEqual(d.appName, settings.DEFAULT_APP_NAME)
  assert.strictEqual(d.appLogo, '')
})

console.log(`\n全部通过：${passed} 组用例 ✅`)
