import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import pty from 'node-pty'
import { ptyExitOk } from './pty-exit.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = join(root, '.m8-home')
const resultsDir = join(root, '.m8-results')
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
    "  (($_.Name -match '^cua-driver\\.exe$') -and ($_.CommandLine -match '(^| )mcp( |$)')) -or",
    "  (($_.Name -match '^(chrome|msedge)\\.exe$') -and ($_.CommandLine -match '\\.m8-results'))",
    '}',
    '$items | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress',
  ].join('\n')
  const run = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' })
  if (run.status !== 0 || run.stdout.trim() === '') return []
  const parsed = JSON.parse(run.stdout.trim())
  return (Array.isArray(parsed) ? parsed : [parsed]).map(item => ({
    pid: Number(item.ProcessId), parentPid: Number(item.ParentProcessId), name: String(item.Name), commandLine: String(item.CommandLine ?? ''),
  }))
}

function stopOwnedProcessTree(pid, commandLineNeedle) {
  const escaped = commandLineNeedle.replaceAll("'", "''")
  const script = [
    `$root = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'`,
    `if ($null -ne $root -and $root.CommandLine -like '*${escaped}*') { Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue }`,
    `$children = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${escaped}*' }`,
    '$children | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
  ].join('\n')
  spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' })
}

const fixtureHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>dsh CUA browser fixture</title></head>
<body><main><h1>CUA browser fixture</h1><p id="status">initial</p>
<label>Public note <input id="normal" aria-label="Public note"></label>
<button id="action" onclick="document.querySelector('#status').textContent='clicked'">Apply browser fixture</button>
</main></body></html>`
const server = createServer((request, response) => {
  if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  response.end(fixtureHtml)
})
await new Promise((resolveListen, rejectListen) => {
  server.once('error', rejectListen)
  server.listen(0, '127.0.0.1', resolveListen)
})
const address = server.address()
if (address === null || typeof address === 'string') throw new Error('fixture server did not expose a TCP port')
const fixtureUrl = `http://127.0.0.1:${address.port}/gate?token=must-not-render`

const auditPath = join(resultsDir, 'computer-audit.json')
const startPath = join(resultsDir, 'computer-start.signal')
const readyPath = join(resultsDir, 'computer-winforms-ready.json')
const fixtureResultPath = join(resultsDir, 'computer-winforms-result.txt')
const overlayPath = join(resultsDir, 'computer-overlay.yml')
const existingProfile = join(resultsDir, 'existing-browser-profile')
for (const path of [auditPath, startPath, readyPath, fixtureResultPath]) if (existsSync(path)) rmSync(path)
if (existsSync(existingProfile)) rmSync(existingProfile, { recursive: true, force: true })
mkdirSync(existingProfile, { recursive: true })
writeFileSync(overlayPath, [
  '# Verification-only overlay: drives the real pinned CUA provider through ordinary tools.',
  '- insert:',
  '    - id: computer-driver',
  `      name: '${pathToFileURL(join(root, 'tests', 'fixtures', 'computer-driver.mjs')).href}'`,
  '',
].join('\n'), 'utf8')

const winForms = spawn('powershell.exe', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'tests', 'fixtures', 'computer-winforms.ps1'),
  '-ReadyPath', readyPath, '-ResultPath', fixtureResultPath,
], { cwd: root, windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] })
let winFormsError = ''
winForms.stderr.on('data', data => { winFormsError += String(data) })
const readyDeadline = Date.now() + 20_000
while (!existsSync(readyPath) && Date.now() < readyDeadline && winForms.exitCode === null) await new Promise(resolveWait => setTimeout(resolveWait, 100))
if (!existsSync(readyPath)) {
  server.close()
  throw new Error(`WinForms fixture did not start: ${winFormsError}`)
}

const chromePaths = [
  join(process.env.ProgramFiles ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
].filter(path => existsSync(path))
let existingBrowser
if (chromePaths[0] !== undefined) {
  existingBrowser = spawn(chromePaths[0], [
    `--user-data-dir=${existingProfile}`, '--no-first-run', '--no-default-browser-check', '--new-window', 'about:blank',
  ], { cwd: root, windowsHide: false, stdio: 'ignore' })
  await new Promise(resolveWait => setTimeout(resolveWait, 1_500))
}

const env = {
  ...process.env,
  DSH_HOME: home,
  DSH_TUI_COMPUTER_START: startPath,
  DSH_TUI_COMPUTER_AUDIT: auditPath,
  DSH_TUI_COMPUTER_FIXTURE_READY: readyPath,
  DSH_TUI_COMPUTER_FIXTURE_RESULT: fixtureResultPath,
  DSH_TUI_COMPUTER_FIXTURE_URL: fixtureUrl,
  DSH_TUI_COMPUTER_EXISTING_BROWSER_PID: existingBrowser === undefined ? '' : String(existingBrowser.pid),
  TERM: 'xterm-256color',
  COLORTERM: 'truecolor',
}
delete env.NO_COLOR
delete env.FORCE_COLOR
delete env.CUA_DRIVER_PERMISSION_MODE
delete env.CUA_DRIVER_GRANTS
delete env.CUA_DRIVER_CAPABILITY_MANIFEST
delete env.CUA_DRIVER_CAPABILITY_MANIFEST_FILE
delete env.CUA_DRIVER_CAPABILITY_MANIFEST_APPROVED
delete env.CUA_DRIVER_SESSION_POLICY
delete env.CUA_DRIVER_SESSION_POLICY_FILE
delete env.CUA_DRIVER_SESSION_POLICY_APPROVED

const beforeRepo = sharedSnapshot()
const beforeSessions = new Set(filesBelow(sessionsDir))
const beforeProcesses = processSnapshot()
const install = spawnSync('cmd.exe', ['/d', '/s', '/c', `dsh plugin --profile tui-computer add ${root}`], { cwd: root, env, encoding: 'utf8' })
if (install.status !== 0) throw new Error(`profile install exited ${install.status}: ${install.stderr}`)
const version = spawnSync('cmd.exe', ['/d', '/s', '/c', 'dsh --version'], { cwd: root, env, encoding: 'utf8' })
const config = spawnSync('cmd.exe', ['/d', '/s', '/c', 'dsh --profile tui-computer --dump-config'], { cwd: root, env, encoding: 'utf8' })
if (config.status !== 0) throw new Error(`dump-config exited ${config.status}: ${config.stderr}`)

let capture = ''
let phase = 0
let phaseCaptureStart = 0
let timedOut = false
let sentQuit = false
let lastCloseAttempt = 0
const terminal = pty.spawn('cmd.exe', ['/d', '/s', '/c', `dsh --profile tui-computer --patch ${overlayPath}`], {
  name: 'xterm-256color', cols: 120, rows: 40, cwd: root, env,
})
function later(ms, value) { setTimeout(() => terminal.write(value), ms) }
function advance(next) { phase = next; phaseCaptureStart = capture.length }
const outcome = await new Promise(resolveExit => {
  const timeout = setTimeout(() => { timedOut = true; terminal.kill() }, 240_000)
  const statePoll = setInterval(() => {
    const stagePlain = capture.slice(phaseCaptureStart).replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
    if (phase === 6 && existsSync(auditPath) && stagePlain.includes('CUA: disarmed')) {
      advance(7)
      lastCloseAttempt = Date.now()
      terminal.write('\x07')
      return
    }
    if (phase === 7 && !stagePlain.includes('TRANSCRIPT') && Date.now() - lastCloseAttempt >= 1_000) {
      lastCloseAttempt = Date.now()
      terminal.write('\x07')
    }
  }, 100)
  terminal.onData(data => {
    capture += data
    const stagePlain = capture.slice(phaseCaptureStart).replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
    if (phase === 0 && stagePlain.includes('TRANSCRIPT')) {
      advance(1)
      later(200, '\x07')
    } else if (phase === 1 && stagePlain.includes('COMPUTER / CUA FULL-DESKTOP CONTROL') && stagePlain.includes('● available')) {
      advance(2)
      later(200, 'a')
    } else if (phase === 2 && stagePlain.includes('ARM FULL AUTOMATION')) {
      advance(3)
      later(200, 'A')
      later(350, 'U')
      later(500, 'T')
      later(650, 'O')
      later(900, '\r')
    } else if (phase === 3 && /CUA:\s+[^\r\n]+ armed · pending/u.test(stagePlain)) {
      advance(4)
      later(200, 'p')
    } else if (phase === 4 && /CUA:\s+[^\r\n]+ armed · paused/u.test(stagePlain)) {
      advance(5)
      later(200, 'p')
    } else if (phase === 5 && /CUA:\s+[^\r\n]+ armed · pending/u.test(stagePlain)) {
      advance(6)
      writeFileSync(startPath, 'start\n', 'utf8')
    } else if (phase === 6 && existsSync(auditPath) && stagePlain.includes('CUA: disarmed')) {
      advance(7)
      lastCloseAttempt = Date.now()
      later(200, '\x07')
    } else if (phase === 7 && stagePlain.includes('TRANSCRIPT') && !sentQuit) {
      advance(8)
      sentQuit = true
      later(200, '\x03')
      later(600, '\x03')
      later(1_000, '\x03')
    }
  })
  terminal.onExit(({ exitCode, signal }) => { clearTimeout(timeout); clearInterval(statePoll); resolveExit({ exitCode, signal }) })
})

await new Promise(resolveWait => setTimeout(resolveWait, 2_000))
winForms.kill()
if (existingBrowser !== undefined) stopOwnedProcessTree(existingBrowser.pid, existingProfile)
await new Promise(resolveWait => server.close(resolveWait))
const afterProcesses = processSnapshot()
const beforePids = new Set(beforeProcesses.map(item => item.pid))
const lingering = afterProcesses.filter(item => !beforePids.has(item.pid))
const audit = existsSync(auditPath) ? JSON.parse(readFileSync(auditPath, 'utf8')) : undefined
const plain = capture.replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
writeFileSync(join(resultsDir, 'computer-pty-capture.log'), capture, 'utf8')

const created = filesBelow(sessionsDir).filter(path => !beforeSessions.has(path))
let removed = 0
for (const path of created) {
  try { rmSync(dirname(path), { recursive: true, force: true }); removed += 1 } catch {}
}

const byLabel = label => audit?.results?.find(item => item.label === label)
const browserRefusal = audit?.browser?.isolated?.text?.includes('browser_route_unavailable')
  || audit?.browser?.isolated?.text?.includes('vendor-signed protected')
const browserFlowPassed = Array.isArray(audit?.browser?.flow) && audit.browser.flow.length >= 4
  && audit.browser.flow.every(item => item.isError === false)
const composed = config.stdout ?? ''
const report = {
  command: 'dsh --profile tui-computer --patch <computer probe>',
  dimensions: { columns: 120, rows: 40 },
  hostVersion: (version.stdout ?? '').trim(),
  profileInstallExitCode: install.status,
  exactComputerDomain: composed.includes("name: '@deepseek-ai/dsh-computer-use'"),
  exactComputerCompanion: /name:\s+["']?dsh-tui-app\/computer-control["']?/u.test(composed),
  oldBrowserDomainAbsent: !composed.includes("name: '@deepseek-ai/dsh-browser-use'"),
  runtimeAvailable: audit?.runtime?.available === true && audit?.runtime?.driverVersion === '0.28.2' && audit?.runtime?.permissionMode === 'standard',
  exact57Tools: audit?.toolCount === 57 && audit?.exactTools?.length === 57,
  toolsAbsentBeforeAndAfter: audit?.beforeToolCount === 0 && audit?.afterToolCount === 0,
  highRiskRegisteredOnly: audit?.highRiskRegistered === true,
  computerCenterObserved: plain.includes('COMPUTER / CUA FULL-DESKTOP CONTROL') && plain.includes('57 pinned tools'),
  exactAutoConfirmation: plain.includes('Type AUTO exactly'),
  pauseResumeObserved: plain.includes('paused') && phase >= 6,
  emergencyStopControlVisible: plain.includes('x emergency stop') && plain.includes('OS actions already delivered cannot be undone'),
  oneAgentExclusive: audit?.childToolCount === 0 && audit?.childCallDenied === true && audit?.secondLeaseDenied === true,
  noPerActionApproval: audit?.approvalsBefore === audit?.approvalsAfter,
  pausedCallBlocked: byLabel('paused-screen')?.isError === true,
  desktopReadsPassed: ['screen-size', 'accessibility', 'fixture-windows', 'fixture-state'].every(label => byLabel(label)?.isError === false),
  winFormsValueAndClickPassed: byLabel('fixture-set-value')?.isError === false && byLabel('fixture-click')?.isError === false
    && byLabel('fixture-verify')?.isError === false && byLabel('fixture-verify')?.text?.includes('clicked')
    && audit?.fixtureResult === 'clicked',
  screenshotAttachment: byLabel('fixture-state')?.hasImage === true || byLabel('fixture-verify')?.hasImage === true,
  browserFlowPassed,
  browserSafelyRefusedByHostAcl: browserRefusal === true,
  existingProfileRefused: audit?.browser?.existingProfile === undefined || audit.browser.existingProfile.isError === true
    || audit.browser.existingProfile.text?.includes('refus'),
  sensitiveDisplayRedacted: !plain.includes('m8-private-value') && !plain.includes('browser-private-value') && !plain.includes('must-not-render'),
  noLingeringOwnedProcesses: lingering.length === 0,
  lingeringProcesses: lingering,
  terminalRestored: capture.includes('\u001B[?1049h') && capture.includes('\u001B[?1049l'),
  exitCode: outcome.exitCode,
  timedOut,
  phase,
  sharedRepoUnchanged: beforeRepo === sharedSnapshot(),
  probeSessions: created.map(path => path.replace(home, '$DSH_HOME')),
  probeSessionsRemoved: removed,
  driverError: audit?.error,
  ...(timedOut || audit?.error ? { captureTail: plain.slice(-5_000) } : {}),
}
writeFileSync(join(resultsDir, 'computer-pty.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report, null, 2))

const required = [
  'exactComputerDomain', 'exactComputerCompanion', 'oldBrowserDomainAbsent', 'runtimeAvailable', 'exact57Tools',
  'toolsAbsentBeforeAndAfter', 'highRiskRegisteredOnly', 'computerCenterObserved', 'exactAutoConfirmation',
  'pauseResumeObserved', 'emergencyStopControlVisible', 'oneAgentExclusive', 'noPerActionApproval', 'pausedCallBlocked',
  'desktopReadsPassed', 'winFormsValueAndClickPassed', 'screenshotAttachment', 'existingProfileRefused',
  'sensitiveDisplayRedacted', 'noLingeringOwnedProcesses', 'terminalRestored', 'sharedRepoUnchanged',
]
const browserEnvironmentSafe = report.browserFlowPassed || report.browserSafelyRefusedByHostAcl
const passed = report.hostVersion === '0.1.6-alpha.2' && report.profileInstallExitCode === 0
  && required.every(key => report[key] === true) && browserEnvironmentSafe && !timedOut && phase === 8
  && report.driverError === undefined && ptyExitOk(outcome.exitCode)
process.exit(passed ? 0 : 1)
