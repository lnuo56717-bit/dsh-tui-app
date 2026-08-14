import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import pty from 'node-pty'
import { formatElapsed } from '../lib/ui/timing.js'

/**
 * End-to-end check for the elapsed-time chip on the profile this machine
 * actually boots. A read-only `--patch` overlay adds one driver that opens and
 * closes real turns on the real session clock; nothing under $DSH_HOME is
 * edited and the probe's own session is removed afterwards.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const results = join(root, '.m5-results')
const home = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh')
const sessionsDir = join(home, 'sessions')
const sharedRepo = 'D:\\deepseek-harness'
mkdirSync(results, { recursive: true })

function sharedSnapshot() {
  const status = execFileSync('git', ['-C', sharedRepo, 'status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const diff = execFileSync('git', ['-C', sharedRepo, 'diff', '--binary', '--', 'packages', 'apps/web', 'vendor'])
  return `${status.length}:${diff.length}`
}

function sessionFiles() {
  const walk = dir => {
    if (!existsSync(dir)) return []
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const path = join(dir, entry.name)
      return entry.isDirectory() ? walk(path) : [path]
    })
  }
  return new Set(walk(sessionsDir))
}

const auditPath = join(results, 'timer-audit.json')
const overlayPath = join(results, 'timer-overlay.yml')
if (existsSync(auditPath)) rmSync(auditPath)
writeFileSync(overlayPath, [
  '# Verification-only overlay: adds one probe plugin, changes no profile file.',
  '- insert:',
  '    - id: timer-driver',
  `      name: '${pathToFileURL(join(root, 'tests', 'fixtures', 'timer-driver.mjs')).href}'`,
  '',
].join('\n'), 'utf8')

const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', DSH_TUI_TIMER_AUDIT: auditPath }
const beforeRepo = sharedSnapshot()
const beforeSessions = sessionFiles()

let capture = ''
let sentQuit = false
let timedOut = false
// `cmd /s /c` strips the outer quotes, so an inner quoted path is re-joined wrong.
const terminal = pty.spawn('cmd.exe', ['/d', '/s', '/c', `dsh --profile tui --patch ${overlayPath}`], {
  name: 'xterm-256color', cols: 120, rows: 40, cwd: root, env,
})
const exited = await new Promise(resolveExit => {
  const timeout = setTimeout(() => { timedOut = true; terminal.kill() }, 90_000)
  terminal.onData(data => {
    capture += data
    if (!sentQuit && existsSync(auditPath)) {
      sentQuit = true
      setTimeout(() => { terminal.write('\x03'); setTimeout(() => terminal.write('\x03'), 250) }, 600)
    }
  })
  terminal.onExit(({ exitCode }) => { clearTimeout(timeout); resolveExit({ exitCode }) })
})

const audit = existsSync(auditPath) ? JSON.parse(readFileSync(auditPath, 'utf8')) : undefined
const plain = capture.replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
writeFileSync(join(results, 'timer-capture.log'), capture, 'utf8')

const created = [...sessionFiles()].filter(path => !beforeSessions.has(path))
const removed = []
if (process.env.DSH_TUI_TIMER_KEEP_SESSION !== '1') {
  for (const path of created) {
    try { rmSync(dirname(path), { recursive: true, force: true }); removed.push(path) } catch {}
  }
}

const spans = audit?.spans ?? []
const [first, second] = spans
// `N s · total M s` is only printed while a turn is open (the settled form says
// `last N s`), so distinct readings here are seconds the chip counted on its own
// clock, between two events and with nothing else arriving.
const ticks = [...new Set([...plain.matchAll(/◷ (\d+)s · total \d+s/gu)].map(match => Number(match[1])))].sort((left, right) => left - right)
const settled = first === undefined || second === undefined
  ? undefined
  : `◷ last ${formatElapsed(second.spanMs)} · total ${formatElapsed(first.spanMs + second.spanMs)}`

const report = {
  command: 'dsh --profile tui --patch <probe overlay>',
  profileHome: home,
  exitCode: exited.exitCode,
  timedOut,
  turnsMeasured: spans.length,
  spans,
  // The chip counted up while a turn was open, with no event between readings.
  tickedWhileRunning: ticks.length >= 3 && ticks.at(-1) - ticks[0] === ticks.length - 1,
  runningReadings: ticks,
  // The live turn is carried in a running total rather than timed on its own.
  runningTotalObserved: ticks.length > 0,
  // The first turn's own span, stated once it was the only measured fact.
  firstTurnObserved: first !== undefined && plain.includes(`◷ ${formatElapsed(first.spanMs)} `),
  settledLabel: settled,
  // Only the settled branch can print `last … · total …`.
  conversationTotalObserved: settled !== undefined && plain.includes(settled),
  transcriptObserved: plain.includes('第二段任务完成'),
  terminalRestored: capture.includes('\u001B[?1049h') && capture.includes('\u001B[?1049l'),
  sharedRepoUnchanged: beforeRepo === sharedSnapshot(),
  probeSessions: created.map(path => path.replace(home, '$DSH_HOME')),
  probeSessionsRemoved: removed.length,
  driverError: audit?.error,
  ...(timedOut ? { captureTail: plain.slice(-2500) } : {}),
}
writeFileSync(join(results, 'timer-e2e.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report, null, 2))

const pass = report.turnsMeasured === 2 && report.tickedWhileRunning && report.runningTotalObserved
  && report.firstTurnObserved && report.conversationTotalObserved && report.transcriptObserved
  && !report.driverError && !report.timedOut && report.exitCode === 0 && report.terminalRestored
  && report.sharedRepoUnchanged
process.exit(pass ? 0 : 1)
