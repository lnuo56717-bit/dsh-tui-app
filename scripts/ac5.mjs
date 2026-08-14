import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import pty from 'node-pty'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = join(root, '.m3-ac5-home')
const results = join(root, '.m3-results')
const idPath = join(results, 'ac5-session.json')
const resumePath = join(results, 'ac5-resume.json')
const followupPath = join(results, 'ac5-followup.json')
const sharedRepo = 'D:\\deepseek-harness'
mkdirSync(results, { recursive: true })
for (const path of [idPath, resumePath, followupPath]) if (existsSync(path)) rmSync(path)

function sharedSnapshot() {
  const status = execFileSync('git', ['-C', sharedRepo, 'status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const diff = execFileSync('git', ['-C', sharedRepo, 'diff', '--binary', '--', 'packages', 'apps/web', 'vendor'])
  return createHash('sha256').update(status).update(diff).digest('hex')
}

const baseEnv = {
  ...process.env, DSH_HOME: home, TERM: 'xterm-256color', COLORTERM: 'truecolor',
  DSH_TUI_AC5_ID: idPath, DSH_TUI_AC5_RESUME: resumePath, DSH_TUI_AC5_FOLLOWUP: followupPath,
}
const install = spawnSync('cmd.exe', ['/d', '/s', '/c', `dsh plugin --profile tui add "${root}"`], { cwd: root, env: baseEnv, encoding: 'utf8' })
if (install.status !== 0) throw new Error(`profile install exited ${install.status}: ${install.stderr}`)
writeFileSync(join(home, 'profiles', 'tui', 'cordis.patch.yml'), `# AC-5 test-only durable history producer/observer.\n- insert:\n    - id: ac5-driver\n      name: '${pathToFileURL(join(root, 'tests', 'fixtures', 'ac5-driver.mjs')).href}'\n`, 'utf8')

async function run(command, phase, ready) {
  const env = { ...baseEnv, DSH_TUI_AC5_PHASE: phase }
  let capture = ''
  let sentFollowup = false
  let sentQuit = false
  let timedOut = false
  const terminal = pty.spawn('cmd.exe', ['/d', '/s', '/c', command], { name: 'xterm-256color', cols: 120, rows: 40, cwd: root, env })
  const outcome = await new Promise(resolveExit => {
    const timeout = setTimeout(() => { timedOut = true; terminal.kill() }, 30_000)
    terminal.onData(data => {
      capture += data
      if (phase === 'resume' && !sentFollowup && capture.includes('已保存的鲸鱼历史')) {
        sentFollowup = true
        setTimeout(() => {
          terminal.write('继续追问：请确认历史完整')
          setTimeout(() => terminal.write('\r'), 250)
        }, 350)
      }
      if (!sentQuit && ready(capture)) {
        sentQuit = true
        setTimeout(() => {
          terminal.write('\x03')
          setTimeout(() => terminal.write('\x03'), 250)
          setTimeout(() => terminal.write('\x03'), 500)
        }, 300)
      }
    })
    terminal.onExit(({ exitCode }) => { clearTimeout(timeout); resolveExit({ exitCode }) })
  })
  writeFileSync(join(results, `ac5-${phase}-capture.log`), capture, 'utf8')
  return {
    exitCode: outcome.exitCode, timedOut, sentFollowup, sentQuit,
    historyObserved: capture.includes('已保存的鲸鱼历史：deep sea 🐋'),
    terminalRestored: capture.includes('\u001B[?1049h') && capture.includes('\u001B[?1049l'),
  }
}

const before = sharedSnapshot()
const first = await run('dsh --profile tui', 'seed', capture => existsSync(idPath) && capture.includes('已保存的鲸鱼历史'))
if (!existsSync(idPath)) throw new Error('seed run did not publish its session id')
const seed = JSON.parse(readFileSync(idPath, 'utf8'))
const second = await run(`dsh --profile tui --resume ${seed.sessionId}`, 'resume', () => existsSync(followupPath))
const resumed = existsSync(resumePath) ? JSON.parse(readFileSync(resumePath, 'utf8')) : undefined
const followup = existsSync(followupPath) ? JSON.parse(readFileSync(followupPath, 'utf8')) : undefined
const after = sharedSnapshot()
const report = {
  command: 'dsh --profile tui; dsh --profile tui --resume <id>', dimensions: { columns: 120, rows: 40 },
  profileInstallExitCode: install.status, sessionId: seed.sessionId, seedEventCount: seed.eventCount,
  first, second,
  resumeSourceObserved: resumed?.source === 'resume',
  resumeHistoryComplete: resumed?.historyObserved === true && resumed?.eventCount >= seed.eventCount,
  resumedEventCount: resumed?.eventCount,
  sameSessionId: resumed?.sessionId === seed.sessionId && followup?.sessionId === seed.sessionId,
  followupAccepted: followup?.text === '继续追问：请确认历史完整' && followup?.source?.kind === 'user',
  sharedRepoUnchanged: before === after,
}
writeFileSync(join(results, 'ac5.json'), JSON.stringify(report, null, 2) + '\n')
const pass = first.exitCode === 0 && !first.timedOut && first.historyObserved && first.terminalRestored
  && second.exitCode === 0 && !second.timedOut && second.sentFollowup && second.historyObserved && second.terminalRestored
  && report.resumeSourceObserved && report.resumeHistoryComplete && report.sameSessionId && report.followupAccepted && report.sharedRepoUnchanged
console.log(JSON.stringify(report, null, 2))
process.exit(pass ? 0 : 1)
