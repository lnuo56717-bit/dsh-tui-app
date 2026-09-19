import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import pty from 'node-pty'
import { ptyExitOk } from './pty-exit.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = join(root, '.m7-home')
const resultsDir = join(root, '.m7-results')
const sessionsDir = join(home, 'sessions')
const sharedRepo = 'D:\\deepseek-harness'
mkdirSync(resultsDir, { recursive: true })

function sharedSnapshot() {
  const status = execFileSync('git', ['-C', sharedRepo, 'status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const diff = execFileSync('git', ['-C', sharedRepo, 'diff', '--binary', '--', 'packages', 'apps/web', 'vendor'])
  return createHash('sha256').update(status).update(diff).digest('hex')
}

function filesBelow(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? filesBelow(path) : [path]
  })
}

function processSnapshot() {
  const script = [
    "$items = Get-CimInstance Win32_Process | Where-Object {",
    "  ($_.Name -match '^(chrome|msedge)\\.exe$') -or",
    "  (($_.Name -match '^node\\.exe$') -and ($_.CommandLine -match 'playwright-mcp'))",
    '}',
    '$items | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress',
  ].join('\n')
  const run = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' })
  if (run.status !== 0) return []
  const raw = run.stdout.trim()
  if (raw === '') return []
  const parsed = JSON.parse(raw)
  return (Array.isArray(parsed) ? parsed : [parsed]).map(item => ({
    pid: Number(item.ProcessId), name: String(item.Name), commandLine: String(item.CommandLine ?? ''),
  }))
}

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>dsh browser gate</title></head>
<body><main>
  <h1>Browser control fixture</h1>
  <p id="status">initial</p>
  <button id="action" onclick="document.querySelector('#status').textContent='clicked'">Change status</button>
  <label>Public note <input id="normal" aria-label="Public note"></label>
  <label>Password <input id="password" type="password" aria-label="Password"></label>
</main></body></html>`

const server = createServer((request, response) => {
  if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  response.end(html)
})
await new Promise((resolveListen, rejectListen) => {
  server.once('error', rejectListen)
  server.listen(0, '127.0.0.1', resolveListen)
})
const address = server.address()
if (address === null || typeof address === 'string') throw new Error('fixture server did not expose a TCP port')
const fixtureUrl = `http://127.0.0.1:${address.port}/gate?session=redacted-test-token`

const auditPath = join(resultsDir, 'browser-audit.json')
const startPath = join(resultsDir, 'browser-start.signal')
const overlayPath = join(resultsDir, 'browser-overlay.yml')
for (const path of [auditPath, startPath]) if (existsSync(path)) rmSync(path)
writeFileSync(overlayPath, [
  '# Verification-only overlay: drives the real pinned provider through ordinary tools.',
  '- insert:',
  '    - id: browser-driver',
  `      name: '${pathToFileURL(join(root, 'tests', 'fixtures', 'browser-driver.mjs')).href}'`,
  '',
].join('\n'), 'utf8')

const env = {
  ...process.env,
  DSH_HOME: home,
  DSH_TUI_BROWSER_START: startPath,
  DSH_TUI_BROWSER_AUDIT: auditPath,
  DSH_TUI_BROWSER_FIXTURE_URL: fixtureUrl,
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
  TERM: 'xterm-256color',
  COLORTERM: 'truecolor',
}
delete env.NO_COLOR
delete env.FORCE_COLOR

const beforeRepo = sharedSnapshot()
const beforeSessions = new Set(filesBelow(sessionsDir))
const beforeProcesses = processSnapshot()
const install = spawnSync('cmd.exe', ['/d', '/s', '/c', `dsh plugin --profile tui add ${root}`], { cwd: root, env, encoding: 'utf8' })
if (install.status !== 0) {
  server.close()
  throw new Error(`profile install exited ${install.status}: ${install.stderr}`)
}
const version = spawnSync('cmd.exe', ['/d', '/s', '/c', 'dsh --version'], { cwd: root, env, encoding: 'utf8' })
const config = spawnSync('cmd.exe', ['/d', '/s', '/c', 'dsh --profile tui --dump-config'], { cwd: root, env, encoding: 'utf8' })
if (config.status !== 0) {
  server.close()
  throw new Error(`dump-config exited ${config.status}: ${config.stderr}`)
}

let capture = ''
let phase = 0
let timedOut = false
let sentQuit = false
const answered = new Set()
const terminal = pty.spawn('cmd.exe', ['/d', '/s', '/c', `dsh --profile tui --patch ${overlayPath}`], {
  name: 'xterm-256color', cols: 120, rows: 40, cwd: root, env,
})

function answer(callId, key, delay = 250) {
  if (answered.has(callId)) return
  const plain = capture.replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
  if (!plain.includes(`call ${callId}`)) return
  answered.add(callId)
  setTimeout(() => terminal.write(key), delay)
}

const outcome = await new Promise(resolveExit => {
  const timeout = setTimeout(() => { timedOut = true; terminal.kill() }, 180_000)
  terminal.onData(data => {
    capture += data
    const plain = capture.replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
    if (phase === 0 && plain.includes('TRANSCRIPT')) {
      phase = 1
      setTimeout(() => terminal.write('\x02'), 250)
    } else if (phase === 1 && plain.includes('BROWSER / SAFE PLAYWRIGHT CONTROL') && plain.includes('available')) {
      phase = 2
      setTimeout(() => terminal.write('p'), 250)
    } else if (phase === 2 && plain.includes('Manual takeover active')) {
      phase = 3
      setTimeout(() => terminal.write('p'), 250)
      setTimeout(() => terminal.write('\x1B'), 500)
      setTimeout(() => writeFileSync(startPath, 'start\n', 'utf8'), 800)
    }

    answer('browser-gate-paused-nav', 'y', 900)
    answer('browser-gate-navigate', 'y')
    answer('browser-gate-click-reject', 'n')
    answer('browser-gate-click-allow', 'y')
    answer('browser-gate-type-normal', 'y')

    if (!sentQuit && existsSync(auditPath)) {
      sentQuit = true
      setTimeout(() => { terminal.write('\x03'); setTimeout(() => terminal.write('\x03'), 400) }, 1_000)
    }
  })
  terminal.onExit(({ exitCode, signal }) => { clearTimeout(timeout); resolveExit({ exitCode, signal }) })
})

await new Promise(resolveWait => setTimeout(resolveWait, 2_500))
await new Promise(resolveClose => server.close(resolveClose))
const afterProcesses = processSnapshot()
const priorPids = new Set(beforeProcesses.map(item => item.pid))
const lingering = afterProcesses.filter(item => !priorPids.has(item.pid))
const audit = existsSync(auditPath) ? JSON.parse(readFileSync(auditPath, 'utf8')) : undefined
const plain = capture.replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
writeFileSync(join(resultsDir, 'browser-pty-capture.log'), capture, 'utf8')

const created = filesBelow(sessionsDir).filter(path => !beforeSessions.has(path))
let removed = 0
for (const path of created) {
  try { rmSync(dirname(path), { recursive: true, force: true }); removed += 1 } catch {}
}

const byLabel = label => audit?.results?.find(item => item.label === label)
const composed = config.stdout ?? ''
const report = {
  command: 'dsh --profile tui --patch <browser probe>',
  hostVersion: (version.stdout ?? '').trim(),
  profileInstallExitCode: install.status,
  exactBrowserDomain: composed.includes("name: '@deepseek-ai/dsh-browser-use'"),
  exactBrowserCompanion: /name:\s+["']?dsh-tui-app\/browser-control["']?/u.test(composed),
  providerAvailable: audit?.runtime?.available === true && audit?.runtime?.mode === 'launch' && audit?.runtime?.visible === true,
  exact24Tools: audit?.toolCount === 24,
  browserCenterObserved: plain.includes('BROWSER / SAFE PLAYWRIGHT CONTROL') && plain.includes('each live Agent owns a separate browser'),
  manualPauseObserved: plain.includes('Manual takeover active'),
  pausedApprovalBlocked: byLabel('paused-nav')?.isError === true,
  navigationAllowed: byLabel('navigate')?.isError === false,
  snapshotReadWithoutApproval: byLabel('snapshot-initial')?.isError === false && byLabel('snapshot-initial')?.text?.includes('initial'),
  agentBrowserIsolation: byLabel('child-snapshot')?.isError === false
    && byLabel('child-snapshot')?.text?.includes('about:blank')
    && byLabel('lead-after-child')?.text?.includes('initial'),
  resumedBrowserReset: byLabel('resumed-child-snapshot')?.isError === false
    && byLabel('resumed-child-snapshot')?.text?.includes('about:blank')
    && byLabel('resumed-child-snapshot')?.cleanStateBeforeCall === true,
  clickRejected: byLabel('click-reject')?.isError === true && byLabel('snapshot-after-reject')?.text?.includes('initial'),
  clickAllowed: byLabel('click-allow')?.isError === false && byLabel('snapshot-after-click')?.text?.includes('clicked'),
  ordinaryInputAllowed: byLabel('type-normal')?.isError === false && byLabel('snapshot-after-type')?.text?.includes('safe-visible-value'),
  sensitiveInputBlocked: byLabel('type-sensitive')?.isError === true && !byLabel('snapshot-after-sensitive')?.text?.includes('must-never-reach-browser'),
  screenshotAttachment: byLabel('screenshot')?.isError === false && byLabel('screenshot')?.hasImage === true,
  unsafeRceBlocked: byLabel('unsafe')?.isError === true,
  sensitiveArgumentsHidden: !plain.includes('safe-visible-value') && !plain.includes('must-never-reach-browser') && !plain.includes('redacted-test-token'),
  noLingeringBrowserProcesses: lingering.length === 0,
  lingeringProcesses: lingering,
  terminalRestored: capture.includes('\u001B[?1049h') && capture.includes('\u001B[?1049l'),
  exitCode: outcome.exitCode,
  timedOut,
  phase,
  approvalsAnswered: [...answered],
  sharedRepoUnchanged: beforeRepo === sharedSnapshot(),
  probeSessions: created.map(path => path.replace(home, '$DSH_HOME')),
  probeSessionsRemoved: removed,
  driverError: audit?.error,
  ...(timedOut || audit?.error ? { captureTail: plain.slice(-4_000) } : {}),
}
writeFileSync(join(resultsDir, 'browser-pty.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report, null, 2))

const required = [
  'exactBrowserDomain', 'exactBrowserCompanion', 'providerAvailable', 'exact24Tools', 'browserCenterObserved',
  'manualPauseObserved', 'pausedApprovalBlocked', 'navigationAllowed', 'snapshotReadWithoutApproval',
  'agentBrowserIsolation', 'resumedBrowserReset',
  'clickRejected', 'clickAllowed', 'ordinaryInputAllowed', 'sensitiveInputBlocked', 'screenshotAttachment',
  'unsafeRceBlocked', 'sensitiveArgumentsHidden', 'noLingeringBrowserProcesses', 'terminalRestored', 'sharedRepoUnchanged',
]
const passed = report.hostVersion === '0.1.6-alpha.2' && report.profileInstallExitCode === 0
  && required.every(key => report[key] === true) && !timedOut && phase === 3 && report.driverError === undefined
  && ptyExitOk(outcome.exitCode)
process.exit(passed ? 0 : 1)
