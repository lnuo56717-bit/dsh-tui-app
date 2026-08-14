import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import pty from 'node-pty'
import { terminalSequences } from '../lib/ui/terminal.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = join(root, '.m4-home')
const results = join(root, '.m4-results')
const sharedRepo = 'D:\\deepseek-harness'
mkdirSync(results, { recursive: true })
function sharedSnapshot() {
  const status = execFileSync('git', ['-C', sharedRepo, 'status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const diff = execFileSync('git', ['-C', sharedRepo, 'diff', '--binary', '--', 'packages', 'apps/web', 'vendor'])
  return createHash('sha256').update(status).update(diff).digest('hex')
}

const before = sharedSnapshot()
const env = { ...process.env, DSH_HOME: home, TERM: 'xterm-256color', COLORTERM: '' }
const install = spawnSync('cmd.exe', ['/d', '/s', '/c', `dsh plugin --profile tui add "${root}"`], { cwd: root, env, encoding: 'utf8' })
if (install.status !== 0) throw new Error(`profile install exited ${install.status}: ${install.stderr}`)
let capture = ''
let openedKeys = false
let sentQuit = false
let timedOut = false
const terminal = pty.spawn('cmd.exe', ['/d', '/s', '/c', 'dsh --profile tui --theme pearl --color 256'], {
  name: 'xterm-256color', cols: 80, rows: 24, cwd: root, env,
})
const outcome = await new Promise(resolveExit => {
  const timeout = setTimeout(() => { timedOut = true; terminal.kill() }, 20_000)
  terminal.onData(data => {
    capture += data
    if (!openedKeys && capture.includes('dsh-tui ·') && capture.includes('TRANSCRIPT')) {
      openedKeys = true
      terminal.write('\x18')
    }
    if (openedKeys && !sentQuit && capture.includes('KEY REFERENCE') && capture.includes('Blockers')) {
      sentQuit = true
      setTimeout(() => {
        terminal.write('\x1B')
        setTimeout(() => { terminal.write('\x03'); setTimeout(() => terminal.write('\x03'), 200) }, 200)
      }, 200)
    }
  })
  terminal.onExit(({ exitCode, signal }) => { clearTimeout(timeout); resolveExit({ exitCode, signal }) })
})
const after = sharedSnapshot()
const enteredAlternateScreen = capture.includes('\u001B[?1049h')
const cursorColorReset = capture.includes('\u001B]112\u0007') || capture.includes('\u001B]112\u001B\\')
const leftAlternateScreen = capture.includes('\u001B[?1049l')
const cursorColorResetConfigured = terminalSequences.LEAVE_ALT.includes(terminalSequences.RESET_CURSOR_COLOR)
const report = {
  command: 'dsh --profile tui --theme pearl --color 256',
  dimensions: { columns: 80, rows: 24 },
  profileInstallExitCode: install.status,
  exitCode: outcome.exitCode,
  timedOut,
  sentQuit,
  compactHeader: capture.includes('dsh-tui ·'),
  transcriptVisible: capture.includes('TRANSCRIPT'),
  keyPageVisible: capture.includes('KEY REFERENCE') && capture.includes('Blockers'),
  noWideWhale: !capture.includes('_ygggggg@B'),
  explicit256Color: capture.includes('\u001B[38;5;'),
  enteredAlternateScreen,
  cursorColorResetObservedByConPty: cursorColorReset,
  cursorColorResetConfigured,
  leftAlternateScreen,
  terminalRestored: enteredAlternateScreen && leftAlternateScreen,
  sharedRepoUnchanged: before === after,
}
writeFileSync(join(results, 'm4-pty.json'), JSON.stringify(report, null, 2) + '\n')
const required = ['compactHeader', 'transcriptVisible', 'keyPageVisible', 'noWideWhale', 'explicit256Color', 'terminalRestored', 'sharedRepoUnchanged']
const failed = outcome.exitCode !== 0 || timedOut || !sentQuit || !cursorColorResetConfigured || required.some(key => report[key] !== true)
if (failed) {
  console.error(JSON.stringify(report, null, 2))
  process.exit(1)
}
console.log(JSON.stringify(report, null, 2))
process.exit(0)
