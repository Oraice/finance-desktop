// ---------------------------------------------------------------------------
// run-all.mjs —— 顺序执行 test/ 下全部 *.test.mjs（纯逻辑单元测试），
// 任一文件失败则以非零码退出。供本地与 CI 统一调用：npm test
// ---------------------------------------------------------------------------

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const files = fs.readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort()

let failed = 0
for (const f of files) {
  process.stdout.write('\n▶ ' + f + '\n')
  try {
    execFileSync(process.execPath, [path.join(here, f)], { cwd: root, stdio: 'inherit' })
  } catch {
    failed++
    process.stdout.write('✗ ' + f + ' 失败\n')
  }
}

if (failed === 0) {
  process.stdout.write(`\n全部 ${files.length} 个测试文件通过 ✅\n`)
} else {
  process.stdout.write(`\n${failed} / ${files.length} 个测试文件失败 ❌\n`)
}
process.exit(failed === 0 ? 0 : 1)
