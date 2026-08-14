import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import process from 'node:process'
import pty from 'node-pty'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = join(root, '.m2-home')
const resultsDir = join(root, '.m2-results')
const target = join(resultsDir, 'ac3-output.txt')
const sharedRepo = 'D:\\deepseek-harness'
mkdirSync(resultsDir, { recursive: true })

function sharedSnapshot() {
  const status = execFileSync('git', ['-C', sharedRepo, 'status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const diff = execFileSync('git', ['-C', sharedRepo, 'diff', '--binary', '--', 'packages', 'apps/web', 'vendor'])
  return createHash('sha256').update(status).update(diff).digest('hex')
}

const before = sharedSnapshot()
const env = { ...process.env, DSH_HOME: home, DSH_TUI_AC3_TARGET: target, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
const install = spawnSync('cmd.exe', ['/d', '/s', '/c', `dsh plugin --profile tui add "${root}"`], { cwd: root, env, encoding: 'utf8' })
if (install.status !== 0) throw new Error(`profile install exited ${install.status}: ${install.stderr}`)
const patchPath = join(home, 'profiles', 'tui', 'cordis.patch.yml')
const driverUrl = pathToFileURL(join(root, 'tests', 'fixtures', 'ac3-driver.mjs')).href
writeFileSync(patchPath, `# AC-3 test-only event producer; not part of the product bundle.\n- insert:\n    - id: ac3-driver\n      name: '${driverUrl}'\n`, 'utf8')

let capture = ''
let sentQuit = false
let timedOut = false
const terminal = pty.spawn('cmd.exe', ['/d', '/s', '/c', 'dsh --profile tui'], {
  name: 'xterm-256color', cols: 120, rows: 40, cwd: root, env,
})
const exit = new Promise(resolveExit => {
  const timeout = setTimeout(() => { timedOut = true; terminal.kill() }, 25_000)
  terminal.onData(data => {
    capture += data
    if (!sentQuit && capture.includes('任务完成') && capture.includes('write_file')) {
      sentQuit = true
      setTimeout(() => terminal.write('q'), 300)
    }
  })
  terminal.onExit(({ exitCode, signal }) => { clearTimeout(timeout); resolveExit({ exitCode, signal }) })
})
const outcome = await exit
const after = sharedSnapshot()
const expectedContent = '深海工具写入成功，whale 🐋\n'
const actualContent = readFileSync(target, 'utf8')
const enter = '\u001B[?1049h'
const leave = '\u001B[?1049l'
const report = {
  command: 'dsh --profile tui (isolated AC-3 profile overlay)',
  dimensions: { columns: 120, rows: 40 },
  profileInstallExitCode: install.status,
  exitCode: outcome.exitCode,
  timedOut,
  sentQuit,
  streamingObserved: capture.includes('正在准备') && capture.includes('streaming'),
  toolObserved: capture.includes('write_file'),
  diffObserved: capture.includes('深海工具写入成功') && capture.includes('@@ -0,0 +1 @@'),
  finalObserved: capture.includes('任务完成'),
  fileContentExact: actualContent === expectedContent,
  fileSha256: createHash('sha256').update(actualContent).digest('hex'),
  terminalRestored: capture.includes(enter) && capture.includes(leave) && capture.split(enter).length === capture.split(leave).length,
  sharedRepoUnchanged: before === after,
}
writeFileSync(join(resultsDir, 'ac3.json'), JSON.stringify(report, null, 2) + '\n')
const failures = Object.entries(report).filter(([key, value]) => key.endsWith('Observed') || key.endsWith('Exact') || key.endsWith('Restored') || key.endsWith('Unchanged') ? value !== true : false).map(([key]) => key)
if (outcome.exitCode !== 0 || timedOut || !sentQuit) failures.push('PTY exit')
if (failures.length > 0) {
  console.error(JSON.stringify(report, null, 2))
  console.error(`AC-3 failed: ${failures.join(', ')}`)
  process.exit(1)
}
console.log(JSON.stringify(report, null, 2))
process.exit(0)
