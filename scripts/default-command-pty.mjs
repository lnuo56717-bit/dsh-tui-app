import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import pty from 'node-pty'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const results = join(root, '.m4-results')
const sharedRepo = 'D:\\deepseek-harness'
mkdirSync(results, { recursive: true })
function sharedSnapshot() {
  const status = execFileSync('git', ['-C', sharedRepo, 'status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const diff = execFileSync('git', ['-C', sharedRepo, 'diff', '--binary', '--', 'packages', 'apps/web', 'vendor'])
  return createHash('sha256').update(status).update(diff).digest('hex')
}

const before = sharedSnapshot()
const help = spawnSync('cmd.exe', ['/d', '/s', '/c', 'dsh --help'], { cwd: root, encoding: 'utf8' })
const tuiHelp = spawnSync('cmd.exe', ['/d', '/s', '/c', 'dsh --profile tui --help'], { cwd: root, encoding: 'utf8' })
const wrapper = readFileSync('D:\\Apps\\npm-global\\dsh.cmd', 'utf8')
let capture = ''
let sentQuit = false
let timedOut = false
const terminal = pty.spawn('cmd.exe', ['/d', '/s', '/c', 'dsh'], {
  name: 'xterm-256color', cols: 80, rows: 24, cwd: root,
  env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
})
const outcome = await new Promise(resolveExit => {
  const timeout = setTimeout(() => { timedOut = true; terminal.kill() }, 20_000)
  terminal.onData(data => {
    capture += data
    if (!sentQuit && capture.includes('dsh-tui ·') && capture.includes('TRANSCRIPT')) {
      sentQuit = true
      setTimeout(() => { terminal.write('\x03'); setTimeout(() => terminal.write('\x03'), 200) }, 200)
    }
  })
  terminal.onExit(({ exitCode, signal }) => { clearTimeout(timeout); resolveExit({ exitCode, signal }) })
})
const after = sharedSnapshot()
const report = {
  command: 'dsh', dimensions: { columns: 80, rows: 24 }, exitCode: outcome.exitCode,
  timedOut, sentQuit,
  bareCommandShowsTui: capture.includes('dsh-tui ·') && capture.includes('TRANSCRIPT'),
  terminalRestored: capture.includes('\u001B[?1049h') && capture.includes('\u001B[?1049l'),
  explicitHelpPreserved: help.status === 0 && help.stdout.includes('Usage: dsh [options]'),
  explicitTuiHelpWorks: tuiHelp.status === 0 && tuiHelp.stdout.includes('--theme <name>'),
  wrapperHasNoArgumentBranch: wrapper.includes('if "%~1"==""') && wrapper.includes('--profile tui'),
  sharedRepoUnchanged: before === after,
}
writeFileSync(join(results, 'default-command.json'), JSON.stringify(report, null, 2) + '\n')
const required = ['bareCommandShowsTui', 'terminalRestored', 'explicitHelpPreserved', 'explicitTuiHelpWorks', 'wrapperHasNoArgumentBranch', 'sharedRepoUnchanged']
if (outcome.exitCode !== 0 || timedOut || !sentQuit || required.some(key => report[key] !== true)) {
  console.error(JSON.stringify(report, null, 2))
  process.exit(1)
}
console.log(JSON.stringify(report, null, 2))
process.exit(0)
