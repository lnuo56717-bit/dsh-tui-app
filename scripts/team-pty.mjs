import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import pty from 'node-pty'
import { ptyExitOk } from './pty-exit.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = join(root, '.m6-home')
const results = join(root, '.m6-results')
const sessionsDir = join(home, 'sessions')
const sharedRepo = 'D:\\deepseek-harness'
mkdirSync(results, { recursive: true })

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

const env = { ...process.env, DSH_HOME: home, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
const beforeRepo = sharedSnapshot()
const beforeSessions = new Set(filesBelow(sessionsDir))
const toolsPath = join(results, 'team-tools.json')
const overlayPath = join(results, 'team-tools-overlay.yml')
if (existsSync(toolsPath)) rmSync(toolsPath)
writeFileSync(overlayPath, [
  '# Verification-only observer; changes no profile file.',
  '- insert:',
  '    - id: team-tools-driver',
  `      name: '${pathToFileURL(join(root, 'tests', 'fixtures', 'team-tools-driver.mjs')).href}'`,
  '',
].join('\n'), 'utf8')
const install = spawnSync('cmd.exe', ['/d', '/s', '/c', `dsh plugin --profile tui add ${root}`], { cwd: root, env, encoding: 'utf8' })
if (install.status !== 0) throw new Error(`profile install exited ${install.status}: ${install.stderr}`)
const version = spawnSync('cmd.exe', ['/d', '/s', '/c', 'dsh --version'], { cwd: root, env, encoding: 'utf8' })
const config = spawnSync('cmd.exe', ['/d', '/s', '/c', 'dsh --profile tui --dump-config'], { cwd: root, env, encoding: 'utf8' })
if (config.status !== 0) throw new Error(`dump-config exited ${config.status}: ${config.stderr}`)

let capture = ''
let phase = 0
let timedOut = false
const terminal = pty.spawn('cmd.exe', ['/d', '/s', '/c', `dsh --profile tui --patch ${overlayPath}`], {
  name: 'xterm-256color', cols: 80, rows: 24, cwd: root, env: { ...env, DSH_TUI_TEAM_TOOLS: toolsPath },
})

function later(ms, value) { setTimeout(() => terminal.write(value), ms) }
const outcome = await new Promise(resolveExit => {
  // A cold alpha.2 Host loads hundreds of plugins and may spend over a minute
  // in Windows malware scanning before the first frame. UI actions still wait
  // on explicit screen markers below, so this budget cannot hide bad behavior.
  const timeout = setTimeout(() => { timedOut = true; terminal.kill() }, 150_000)
  terminal.onData(data => {
    capture += data
    const plain = capture.replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
    if (phase === 0 && plain.includes('TRANSCRIPT')) {
      phase = 1
      later(150, '\x14')
    } else if (phase === 1 && plain.includes('DEEPSEEK / AGENT TEAMS')) {
      phase = 2
      later(150, '2')
      later(300, 'n')
      later(450, 'pty-task')
      later(600, '\t')
      later(750, 'task lifecycle gate')
      later(900, '\t')
      later(1_050, '\r')
      later(1_300, '\r')
    } else if (phase === 2 && plain.includes('task-1') && plain.includes('pty-task')) {
      phase = 3
      // claim -> complete -> reopen -> delete, each against the freshly
      // rendered revision. Delete alone asks for destructive confirmation.
      later(600, '\r')
      later(850, '\r')
      later(1_500, '\r')
      for (let index = 0; index < 4; index += 1) later(1_700 + index * 140, '\x1B[B')
      later(2_320, '\r')
      later(3_000, '\r')
      for (let index = 0; index < 5; index += 1) later(3_200 + index * 140, '\x1B[B')
      later(3_980, '\r')
      later(4_700, '\r')
      for (let index = 0; index < 7; index += 1) later(4_900 + index * 140, '\x1B[B')
      later(6_000, '\r')
      later(6_300, 'y')
      later(7_100, '\x1B')
      later(7_400, '\x03')
      later(7_700, '\x03')
    }
  })
  terminal.onExit(({ exitCode, signal }) => { clearTimeout(timeout); resolveExit({ exitCode, signal }) })
})

const plain = capture.replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
writeFileSync(join(results, 'team-pty-capture.log'), capture, 'utf8')
const created = filesBelow(sessionsDir).filter(path => !beforeSessions.has(path))
let removed = 0
for (const path of created) {
  try { rmSync(dirname(path), { recursive: true, force: true }); removed += 1 } catch {}
}

const composed = config.stdout ?? ''
const expectedTools = ['interrupt_agent', 'list_agents', 'send_message', 'spawn_teammate', 'team_task_create', 'team_task_get', 'team_task_list', 'team_task_update', 'wait_agent']
const tools = existsSync(toolsPath) ? JSON.parse(readFileSync(toolsPath, 'utf8')).names : []
const report = {
  command: 'dsh --profile tui', dimensions: { columns: 80, rows: 24 },
  hostVersion: (version.stdout ?? '').trim(), profileInstallExitCode: install.status,
  exactTeamDomain: composed.includes("name: '@deepseek-ai/dsh-experimental-agent-team'"),
  exactTeamTools: composed.includes("name: '@deepseek-ai/dsh-experimental-tool-agent-team'"),
  nineScopedTools: expectedTools.every(name => tools.includes(name)) && expectedTools.length === 9,
  scopedTeamTools: tools.filter(name => expectedTools.includes(name)),
  oldControlsDisabled: ['tool-subagent-control', 'tool-subagent-list-agents', 'tool-subagent', 'tool-subagent-fork']
    .every(id => new RegExp(`id: ${id}[\\s\\S]{0,180}disabled: true`, 'u').test(composed)),
  teamCenterObserved: plain.includes('DEEPSEEK / AGENT TEAMS') && plain.includes('1 ROSTER') && plain.includes('2 TASKS') && plain.includes('3 ACTIVITY'),
  sharedCwdWarning: plain.includes('write scopes are advisory'),
  taskCreated: plain.includes('task-1') && plain.includes('pty-task'),
  actionsObserved: plain.includes('Claim as Lead') && plain.includes('Complete') && plain.includes('Reopen') && plain.includes('Delete'),
  destructiveConfirmObserved: plain.includes('Delete task task-1') && plain.includes('y/N'),
  terminalRestored: capture.includes('\u001B[?1049h') && capture.includes('\u001B[?1049l'),
  exitCode: outcome.exitCode, timedOut, phase,
  sharedRepoUnchanged: beforeRepo === sharedSnapshot(),
  probeSessions: created.map(path => path.replace(home, '$DSH_HOME')), probeSessionsRemoved: removed,
  ...(timedOut ? { captureTail: plain.slice(-3_000) } : {}),
}
writeFileSync(join(results, 'team-pty.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report, null, 2))

const required = ['exactTeamDomain', 'exactTeamTools', 'nineScopedTools', 'oldControlsDisabled', 'teamCenterObserved', 'sharedCwdWarning', 'taskCreated', 'actionsObserved', 'destructiveConfirmObserved', 'terminalRestored', 'sharedRepoUnchanged']
const passed = report.hostVersion === '0.1.6-alpha.2' && report.profileInstallExitCode === 0
  && required.every(key => report[key] === true) && !timedOut && phase === 3 && ptyExitOk(outcome.exitCode)
process.exit(passed ? 0 : 1)
