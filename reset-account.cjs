'use strict'
// ---------------------------------------------------------------------------
// reset-account.cjs —— 忘记用户名/密码时的本地账户重置工具
// 直接改写 accounts 账户文件：设置新用户名 + 新密码（scrypt 重新哈希）。
// 账本按账户 id 归属，id 保持不变，因此所有账本、流水、资料完整保留。
// 用法：node reset-account.cjs
// ---------------------------------------------------------------------------
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const auth = require('./auth-core.cjs')

const CANDIDATE_DIRS = [
  path.join(process.env.APPDATA, '财账簿', 'accounts'),
  path.join(process.env.APPDATA, 'caizhangbu', 'accounts')
]

/** 密码隐藏输入（输入内容显示为 *） */
function askPasswordHidden(rl, promptText) {
  return new Promise((resolve) => {
    rl._writeToOutput = function (s) {
      if (s === promptText) rl.output.write(promptText)
      else rl.output.write('*')
    }
    rl.question(promptText, (pw) => {
      rl._writeToOutput = (x) => rl.output.write(x)
      rl.output.write('\n')
      resolve(pw)
    })
  })
}

async function main() {
  const dir = CANDIDATE_DIRS.find((d) => fs.existsSync(d))
  if (!dir) { console.error('未找到账户目录，请确认应用至少注册运行过一次。'); process.exit(1) }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  if (!files.length) { console.error('账户目录中没有账户文件。'); process.exit(1) }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  let target = files[0]
  if (files.length > 1) {
    files.forEach((f, i) => console.log(`${i + 1}. ${f}`))
    const idx = Number(await new Promise((res) => rl.question('选择要重置的账户序号：', res))) - 1
    target = files[idx] || files[0]
  }

  const file = path.join(dir, target)
  const acc = JSON.parse(fs.readFileSync(file, 'utf8'))
  const oldUsername = acc.username
  console.log(`\n将重置账户：${target}（当前用户名：${oldUsername}）`)

  // 1) 新用户名（循环直到合法）
  let username
  while (true) {
    const v = await new Promise((res) => rl.question('请输入新用户名（2-20 位中文/字母/数字/下划线）：', res))
    const checked = auth.validateUsername(v)
    if (checked.ok) { username = checked.value; break }
    console.log('  ✗ ' + checked.reason)
  }

  // 2) 新密码（循环直到合法）
  let password
  while (true) {
    const v = await askPasswordHidden(rl, '请输入新密码（至少 8 位，字母/数字/符号至少两类）：')
    const checked = auth.validatePassword(v)
    if (checked.ok) { password = v; break }
    console.log('  ✗ ' + checked.reason)
  }
  const again = await askPasswordHidden(rl, '请再次输入新密码确认：')
  if (again !== password) {
    console.log('两次输入不一致，已取消（账户未做任何改动）。')
    rl.close()
    process.exit(1)
  }

  // 3) 重写账户文件
  acc.username = username
  acc.salt = auth.newSalt()
  acc.hash = auth.hashPassword(password, acc.salt)
  acc.failedCount = 0
  acc.lockedUntil = 0
  acc.autoLogin = false
  acc.encPass = null
  acc.updatedAt = Date.now()
  // 昵称若仍是旧用户名（未自定义），跟随更新为新用户名
  if (acc.profile && acc.profile.displayName === oldUsername) acc.profile.displayName = username

  fs.writeFileSync(file, JSON.stringify(acc, null, 2), 'utf8')

  console.log('\n✅ 重置成功！')
  console.log(`   新用户名：${username}`)
  console.log('   所有账本与流水均已保留，现在回到登录界面用新账号密码登录即可。')
  rl.close()
}

main().catch((e) => { console.error('重置失败：', e.message); process.exit(1) })
