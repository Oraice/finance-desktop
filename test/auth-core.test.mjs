// 阶段 7 账户安全内核单元测试：node test/auth-core.test.mjs
import assert from 'node:assert'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const auth = require('../auth-core.cjs')

let passed = 0
const ok = (name, fn) => { fn(); passed++; console.log('  ✔', name) }

console.log('auth-core 单元测试')

ok('哈希：同盐确定性、异盐差异性、64 字节 hex', () => {
  const s1 = auth.newSalt()
  const s2 = auth.newSalt()
  assert.notStrictEqual(s1, s2, '盐应随机')
  assert.strictEqual(auth.hashPassword('Pw123456!', s1), auth.hashPassword('Pw123456!', s1))
  assert.notStrictEqual(auth.hashPassword('Pw123456!', s1), auth.hashPassword('Pw123456!', s2))
  assert.match(auth.hashPassword('Pw123456!', s1), /^[0-9a-f]{128}$/)
})

ok('验证：正确密码 true，错误密码/坏哈希 false', () => {
  const salt = auth.newSalt()
  const hash = auth.hashPassword('Zz2026#Ledger', salt)
  assert.ok(auth.verifyPassword('Zz2026#Ledger', salt, hash))
  assert.ok(!auth.verifyPassword('Zz2026#Ledger ', salt, hash)) // 尾空格不同
  assert.ok(!auth.verifyPassword('wrong', salt, hash))
  assert.ok(!auth.verifyPassword('x', salt, '不是hex'))
})

ok('用户名规则：2-20 位中文/字母/数字/下划线', () => {
  assert.ok(auth.validateUsername('张三').ok)
  assert.ok(auth.validateUsername('boss_2026').ok)
  assert.ok(!auth.validateUsername('').ok)
  assert.ok(!auth.validateUsername('a').ok, '太短')
  assert.ok(!auth.validateUsername('x'.repeat(21)).ok, '太长')
  assert.ok(!auth.validateUsername('ab c').ok, '含空格')
  assert.ok(!auth.validateUsername('a@b').ok, '含非法符号')
})

ok('密码规则：≥8 位且字母/数字/符号至少两类', () => {
  assert.ok(!auth.validatePassword('1234567').ok, '太短')
  assert.ok(!auth.validatePassword('abcdefgh').ok, '纯字母一类')
  assert.ok(!auth.validatePassword('12345678').ok, '纯数字一类')
  const r = auth.validatePassword('abcd1234')
  assert.ok(r.ok)
  assert.strictEqual(r.level, 2)
  assert.strictEqual(auth.validatePassword('Abcdef12!').level, 4)
})

ok('失败锁定：第 5 次失败上锁 60s，计数清零待解锁', () => {
  let acc = { failedCount: 0, lockedUntil: 0 }
  const t0 = 1000000
  for (let i = 0; i < 4; i++) acc = auth.registerFailure(acc, t0)
  assert.strictEqual(acc.failedCount, 4)
  assert.ok(!auth.checkLock(acc, t0).locked)
  acc = auth.registerFailure(acc, t0)
  assert.strictEqual(acc.failedCount, 0, '上锁即清零')
  const l = auth.checkLock(acc, t0)
  assert.ok(l.locked)
  assert.strictEqual(l.remainingMs, auth.LOCK_MS)
  assert.ok(!auth.checkLock(acc, t0 + auth.LOCK_MS + 1).locked, '窗口过后解锁')
})

ok('成功登录清零锁定状态', () => {
  const acc = { failedCount: 3, lockedUntil: 999999 }
  const done = auth.clearFailures(acc)
  assert.strictEqual(done.failedCount, 0)
  assert.strictEqual(done.lockedUntil, 0)
})

ok('资料校验：合法资料通过并自动 trim', () => {
  const r = auth.validateProfile({
    displayName: '  老王  ',
    email: ' test@qq.com ',
    bio: '认真记账',
    avatarColor: '#1971c2'
  })
  assert.ok(r.ok, r.reason)
  assert.strictEqual(r.value.displayName, '老王')
  assert.strictEqual(r.value.email, 'test@qq.com')
  assert.strictEqual(r.value.avatarColor, '#1971c2')
})

ok('资料校验：邮箱/简介可空', () => {
  const r = auth.validateProfile({ displayName: '老王', email: '', bio: '' })
  assert.ok(r.ok, r.reason)
})

ok('资料校验：昵称空/超长被拒', () => {
  assert.ok(!auth.validateProfile({ displayName: '' }).ok)
  assert.ok(!auth.validateProfile({ displayName: 'x'.repeat(21) }).ok)
})

ok('资料校验：坏邮箱被拒', () => {
  assert.ok(!auth.validateProfile({ displayName: 'a', email: 'abc' }).ok)
  assert.ok(!auth.validateProfile({ displayName: 'a', email: 'a@b' }).ok)
  assert.ok(!auth.validateProfile({ displayName: 'a', bio: 'x'.repeat(101) }).ok)
})

ok('资料校验：非法头像颜色回退默认色', () => {
  const r = auth.validateProfile({ displayName: 'a', avatarColor: '#ffffff' })
  assert.ok(r.ok)
  assert.strictEqual(r.value.avatarColor, auth.DEFAULT_AVATAR)
})

ok('defaultProfile：老账户补全字段', () => {
  const out = auth.defaultProfile({ username: 'olduser' })
  assert.strictEqual(out.profile.displayName, 'olduser')
  assert.strictEqual(out.profile.avatarColor, auth.DEFAULT_AVATAR)
  assert.strictEqual(out.profile.email, '')
  assert.strictEqual(out.profile.bio, '')
  assert.strictEqual(out.profile.avatarImage, '')
  // 已有资料不被覆盖
  const kept = auth.defaultProfile({ username: 'u', profile: { displayName: '昵称', avatarColor: '#2f9e44' } })
  assert.strictEqual(kept.profile.displayName, '昵称')
  assert.strictEqual(kept.profile.avatarColor, '#2f9e44')
})

ok('丰富资料：完整字段通过并 trim', () => {
  const r = auth.validateProfile({
    displayName: '老王',
    avatarEmoji: '🦊',
    gender: 'male',
    birthday: '1995-06-15',
    city: ' 成都 ',
    phone: '13800138000',
    occupation: '工程师',
    website: 'https://example.com',
    monthlyBudget: '5000',
    financeGoal: '年存10万'
  })
  assert.ok(r.ok, r.reason)
  assert.strictEqual(r.value.city, '成都')
  assert.strictEqual(r.value.avatarEmoji, '🦊')
  assert.strictEqual(r.value.monthlyBudget, 5000)
})

ok('丰富资料：手机号格式校验', () => {
  assert.ok(auth.validateProfile({ displayName: 'a', phone: '13800138000' }).ok)
  assert.ok(!auth.validateProfile({ displayName: 'a', phone: '12345678901' }).ok, '12 开头非法')
  assert.ok(!auth.validateProfile({ displayName: 'a', phone: '1380013800' }).ok, '位数不足')
})

ok('丰富资料：网站需 http(s) 开头', () => {
  assert.ok(auth.validateProfile({ displayName: 'a', website: 'http://a.com' }).ok)
  assert.ok(auth.validateProfile({ displayName: 'a', website: 'https://a.com/x' }).ok)
  assert.ok(!auth.validateProfile({ displayName: 'a', website: 'a.com' }).ok)
  assert.ok(!auth.validateProfile({ displayName: 'a', website: 'ftp://a.com' }).ok)
})

ok('丰富资料：生日合法且不晚于今天', () => {
  assert.ok(!auth.validateProfile({ displayName: 'a', birthday: '1995-13-40' }).ok)
  assert.ok(!auth.validateProfile({ displayName: 'a', birthday: '2999-01-01' }).ok)
})

ok('丰富资料：非法性别/预算回退', () => {
  const r = auth.validateProfile({ displayName: 'a', gender: 'unknown', monthlyBudget: 'abc' })
  assert.ok(r.ok)
  assert.strictEqual(r.value.gender, 'secret')
  assert.strictEqual(r.value.monthlyBudget, 0)
  // 负预算归零
  assert.strictEqual(auth.validateProfile({ displayName: 'a', monthlyBudget: -100 }).value.monthlyBudget, 0)
})

ok('头像照片：合法 dataURL 通过并保留，空串视为不用照片', () => {
  const img = 'data:image/jpeg;base64,' + 'A'.repeat(1000)
  const r = auth.validateProfile({ displayName: '老王', avatarImage: img })
  assert.ok(r.ok, r.reason)
  assert.strictEqual(r.value.avatarImage, img)
  assert.strictEqual(auth.validateProfile({ displayName: 'a', avatarImage: '' }).value.avatarImage, '')
  // png / webp 同样允许
  assert.ok(auth.validateProfile({ displayName: 'a', avatarImage: 'data:image/png;base64,iVBORw0KGgo=' }).ok)
  assert.ok(auth.validateProfile({ displayName: 'a', avatarImage: 'data:image/webp;base64,UklGRg==' }).ok)
})

ok('头像照片：非 dataURL / 非图片 mime / 非法字符被拒', () => {
  assert.ok(!auth.validateProfile({ displayName: 'a', avatarImage: 'http://x.com/a.jpg' }).ok)
  assert.ok(!auth.validateProfile({ displayName: 'a', avatarImage: 'data:image/gif;base64,AAAA' }).ok)
  assert.ok(!auth.validateProfile({ displayName: 'a', avatarImage: 'data:image/jpeg;base64,***' }).ok)
})

ok('头像照片：超过大小上限被拒', () => {
  const img = 'data:image/jpeg;base64,' + 'A'.repeat(300001)
  assert.ok(!auth.validateProfile({ displayName: 'a', avatarImage: img }).ok)
})

ok('分类预算：合法条目保留并规整为两位小数', () => {
  const out = auth.normalizeCategoryBudgets({ 餐饮: 1500.567, 交通: 300 })
  assert.deepStrictEqual(out, { 餐饮: 1500.57, 交通: 300 })
})

ok('分类预算：金额为 0 / 负数 / 非数字 / 超限的条目剔除', () => {
  const out = auth.normalizeCategoryBudgets({ a: 0, b: -5, c: 'abc', d: 200000000, e: 800 })
  assert.deepStrictEqual(out, { e: 800 })
})

ok('分类预算：名称为空 / 超长的条目剔除', () => {
  const out = auth.normalizeCategoryBudgets({
    '': 100,
    '这是一个特别特别长的分类名称超过十个字': 100,
    餐饮: 100
  })
  assert.deepStrictEqual(Object.keys(out), ['餐饮'])
})

ok('分类预算：数组 / 字符串 / null 按空对象处理', () => {
  assert.deepStrictEqual(auth.normalizeCategoryBudgets([['餐饮', 100]]), {})
  assert.deepStrictEqual(auth.normalizeCategoryBudgets('餐饮:100'), {})
  assert.deepStrictEqual(auth.normalizeCategoryBudgets(null), {})
})

ok('分类预算：条目最多 20 条', () => {
  const raw = {}
  for (let i = 0; i < 25; i++) raw['分类' + i] = 100
  assert.strictEqual(Object.keys(auth.normalizeCategoryBudgets(raw)).length, auth.MAX_CAT_BUDGETS)
})

ok('validateProfile：分类预算随资料一起返回', () => {
  const r = auth.validateProfile({ displayName: '小王', categoryBudgets: { 餐饮: 1000 } })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.value.categoryBudgets.餐饮, 1000)
})

ok('defaultProfile：老账户补全分类预算为空对象', () => {
  const d = auth.defaultProfile({ username: '老王', profile: { displayName: '老王' } })
  assert.deepStrictEqual(d.profile.categoryBudgets, {})
})

console.log(`\n全部通过：${passed} 组用例 ✅`)
