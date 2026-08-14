import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import pty from 'node-pty'

/**
 * End-to-end check for the native ask_user_question path on the profile this
 * machine actually boots. The user's own profile patch supplies the tool; this
 * script only adds a read-only `--patch` overlay, so nothing under $DSH_HOME is
 * edited. Answering happens through real keystrokes into the real QuestionCard.
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

const toolsPath = join(results, 'ask-user-tools.json')
const auditPath = join(results, 'ask-user-audit.json')
const overlayPath = join(results, 'ask-user-overlay.yml')
for (const path of [toolsPath, auditPath]) if (existsSync(path)) rmSync(path)
writeFileSync(overlayPath, [
  '# Verification-only overlay: adds one probe plugin, changes no profile file.',
  '- insert:',
  '    - id: ask-user-driver',
  `      name: '${pathToFileURL(join(root, 'tests', 'fixtures', 'ask-user-driver.mjs')).href}'`,
  '',
].join('\n'), 'utf8')

const dumped = spawnSync('cmd.exe', ['/d', '/s', '/c', 'dsh --profile tui --dump-config'], { cwd: root, encoding: 'utf8' })
const composed = dumped.stdout ?? ''

const env = {
  ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor',
  DSH_TUI_ASK_TOOLS: toolsPath, DSH_TUI_ASK_AUDIT: auditPath,
}
const beforeRepo = sharedSnapshot()
const beforeSessions = sessionFiles()

let capture = ''
let sentApproval = false
let sentAnswer = false
let sentQuit = false
let timedOut = false
// `cmd /s /c` strips the outer quotes, so an inner quoted path is re-joined wrong.
const terminal = pty.spawn('cmd.exe', ['/d', '/s', '/c', `dsh --profile tui --patch ${overlayPath}`], {
  name: 'xterm-256color', cols: 120, rows: 40, cwd: root, env,
})
const exited = await new Promise(resolveExit => {
  const timeout = setTimeout(() => { timedOut = true; terminal.kill() }, 60_000)
  terminal.onData(data => {
    capture += data
    if (!sentApproval && capture.includes('PERMISSION REQUIRED')) {
      sentApproval = true
      setTimeout(() => terminal.write('y'), 200)
    }
    // 'z. Other' is the QuestionCard's own ASCII row, immune to CJK wrapping.
    if (!sentAnswer && capture.includes('z. Other')) {
      sentAnswer = true
      setTimeout(() => terminal.write('1'), 1_500)
    }
    if (!sentQuit && existsSync(auditPath)) {
      sentQuit = true
      setTimeout(() => { terminal.write('\x03'); setTimeout(() => terminal.write('\x03'), 250) }, 400)
    }
  })
  terminal.onExit(({ exitCode }) => { clearTimeout(timeout); resolveExit({ exitCode }) })
})

const tools = existsSync(toolsPath) ? JSON.parse(readFileSync(toolsPath, 'utf8')) : undefined
const audit = existsSync(auditPath) ? JSON.parse(readFileSync(auditPath, 'utf8')) : undefined
const plain = capture.replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
writeFileSync(join(results, 'ask-user-capture.log'), capture, 'utf8')

// The probe boots the real profile, so it must not leave its own session behind.
const created = [...sessionFiles()].filter(path => !beforeSessions.has(path))
const removed = []
if (process.env.DSH_TUI_ASK_KEEP_SESSION !== '1') {
  for (const path of created) {
    try { rmSync(dirname(path), { recursive: true, force: true }); removed.push(path) } catch {}
  }
}

const answers = audit?.value?.answers
const report = {
  command: 'dsh --profile tui --patch <probe overlay>',
  profileHome: home,
  composedFromUserPatch: composed.includes("name: '@deepseek-ai/dsh-tool-ask-user'"),
  exitCode: exited.exitCode,
  timedOut,
  approvalAsked: sentApproval,
  toolRegistered: tools?.registered === true,
  toolCount: tools?.toolNames?.length,
  cardObserved: plain.includes('原生提问验证') && plain.includes('选项甲'),
  answerSent: sentAnswer,
  pausedUntilAnswered: typeof audit?.elapsedMs === 'number' && audit.elapsedMs >= 1_200,
  elapsedMs: audit?.elapsedMs,
  toolFailed: audit?.isError === true,
  answers,
  answerMatches: Array.isArray(answers) && answers.length === 1 && answers[0].id === 'probe'
    && Array.isArray(answers[0].selected) && answers[0].selected.join('|') === '选项甲',
  terminalRestored: capture.includes('\u001B[?1049h') && capture.includes('\u001B[?1049l'),
  sharedRepoUnchanged: beforeRepo === sharedSnapshot(),
  probeSessions: created.map(path => path.replace(home, '$DSH_HOME')),
  probeSessionsRemoved: removed.length,
  driverError: audit?.error ?? tools?.error,
  ...(timedOut ? { captureTail: plain.slice(-2500) } : {}),
}
writeFileSync(join(results, 'ask-user-e2e.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report, null, 2))

const pass = report.composedFromUserPatch && report.toolRegistered && report.cardObserved && report.answerMatches
  && report.pausedUntilAnswered && !report.toolFailed && !report.timedOut && report.exitCode === 0
  && report.terminalRestored && report.sharedRepoUnchanged
process.exit(pass ? 0 : 1)
