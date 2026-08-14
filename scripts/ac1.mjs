import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import pty from 'node-pty'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = join(root, '.m1-home')
const resultsDir = join(root, '.m1-results')
const sharedRepo = 'D:\\deepseek-harness'
mkdirSync(resultsDir, { recursive: true })

function sharedSnapshot() {
  const status = execFileSync('git', ['-C', sharedRepo, 'status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const diff = execFileSync('git', ['-C', sharedRepo, 'diff', '--binary', '--', 'packages', 'apps/web', 'vendor'])
  return createHash('sha256').update(status).update(diff).digest('hex')
}

const before = sharedSnapshot()
const env = { ...process.env, DSH_HOME: home, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
const install = spawnSync('cmd.exe', ['/d', '/s', '/c', `dsh plugin --profile tui add "${root}"`], { cwd: root, env, encoding: 'utf8' })
if (install.status !== 0) throw new Error(`profile install exited ${install.status}: ${install.stderr}`)
const help = spawnSync('cmd.exe', ['/d', '/s', '/c', 'dsh --profile tui --help'], { cwd: root, env, encoding: 'utf8' })
if (help.status !== 0) throw new Error(`help exited ${help.status}: ${help.stderr}`)

let capture = ''
let sentQuit = false
let timedOut = false
const terminal = pty.spawn('cmd.exe', ['/d', '/s', '/c', 'dsh --profile tui'], {
  name: 'xterm-256color',
  cols: 120,
  rows: 40,
  cwd: root,
  env,
})

const exit = new Promise(resolveExit => {
  const timeout = setTimeout(() => {
    timedOut = true
    terminal.kill()
  }, 20_000)
  terminal.onData(data => {
    capture += data
    if (!sentQuit && (capture.includes('DEEPSEEK / HARNESS') || capture.includes('TRANSCRIPT'))) {
      sentQuit = true
      setTimeout(() => terminal.write('q'), 150)
    }
  })
  terminal.onExit(({ exitCode, signal }) => {
    clearTimeout(timeout)
    resolveExit({ exitCode, signal })
  })
})

const outcome = await exit
const after = sharedSnapshot()
const enter = '\u001B[?1049h'
const leave = '\u001B[?1049l'
const profile = JSON.parse(readFileSync(join(home, 'profiles', 'tui', 'package.json'), 'utf8'))
const report = {
  command: 'dsh --profile tui',
  dimensions: { columns: 120, rows: 40 },
  profileInstallExitCode: install.status,
  help: {
    exitCode: help.status,
    flags: ['--resume <session-id>', '--theme <name>', '--color <mode>'].map(flag => ({ flag, present: help.stdout.includes(flag) })),
  },
  profileBundles: profile.dsh?.profile?.bundles,
  pty: {
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    timedOut,
    sentQuit,
    enteredAlternateScreen: capture.includes(enter),
    leftAlternateScreen: capture.includes(leave),
    enterCount: capture.split(enter).length - 1,
    leaveCount: capture.split(leave).length - 1,
    shellVisible: capture.includes('DEEPSEEK / HARNESS') && capture.includes('TRANSCRIPT'),
    coloredWhale: capture.includes('\u001B[38;2;76;106;255m') || capture.includes('\u001B[38;2;76;106;253m'),
  },
  sharedRepo: { snapshotBefore: before, snapshotAfter: after, unchanged: before === after },
}
writeFileSync(join(resultsDir, 'ac1.json'), JSON.stringify(report, null, 2) + '\n')

const failures = []
if (report.help.exitCode !== 0 || report.help.flags.some(item => !item.present)) failures.push('help/flags')
if (report.profileInstallExitCode !== 0) failures.push('profile install')
if (JSON.stringify(report.profileBundles) !== JSON.stringify(['@deepseek-ai/dsh-base', 'dsh-tui-app'])) failures.push('profile bundles')
if (report.pty.exitCode !== 0 || report.pty.timedOut || !report.pty.sentQuit) failures.push('PTY exit')
if (!report.pty.enteredAlternateScreen || !report.pty.leftAlternateScreen || report.pty.enterCount !== report.pty.leaveCount) failures.push('alternate screen')
if (!report.pty.shellVisible) failures.push('shell frame')
if (!report.sharedRepo.unchanged) failures.push('shared repo mutated')
if (failures.length > 0) {
  console.error(JSON.stringify(report, null, 2))
  console.error(`AC-1 failed: ${failures.join(', ')}`)
  process.exit(1)
}
console.log(JSON.stringify(report, null, 2))
process.exit(0)
