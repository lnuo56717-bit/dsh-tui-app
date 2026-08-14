import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import pty from 'node-pty'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = join(root, '.m3-ac4-home')
const results = join(root, '.m3-results')
const sharedRepo = 'D:\\deepseek-harness'
mkdirSync(results, { recursive: true })

function sharedSnapshot() {
  const status = execFileSync('git', ['-C', sharedRepo, 'status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const diff = execFileSync('git', ['-C', sharedRepo, 'diff', '--binary', '--', 'packages', 'apps/web', 'vendor'])
  return createHash('sha256').update(status).update(diff).digest('hex')
}

const baseEnv = { ...process.env, DSH_HOME: home, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
const install = spawnSync('cmd.exe', ['/d', '/s', '/c', `dsh plugin --profile tui add "${root}"`], { cwd: root, env: baseEnv, encoding: 'utf8' })
if (install.status !== 0) throw new Error(`profile install exited ${install.status}: ${install.stderr}`)
const patchPath = join(home, 'profiles', 'tui', 'cordis.patch.yml')
writeFileSync(patchPath, `# AC-4 test-only approval producer.\n- insert:\n    - id: ac4-driver\n      name: '${pathToFileURL(join(root, 'tests', 'fixtures', 'ac4-driver.mjs')).href}'\n`, 'utf8')

async function runCase(mode, key) {
  const target = join(results, `ac4-${mode}.txt`)
  const audit = join(results, `ac4-${mode}.json`)
  for (const path of [target, audit]) if (existsSync(path)) rmSync(path)
  const env = { ...baseEnv, DSH_TUI_AC4_CASE: mode, DSH_TUI_AC4_TARGET: target, DSH_TUI_AC4_AUDIT: audit }
  let capture = ''
  let sentDecision = false
  let sentQuit = false
  let timedOut = false
  const terminal = pty.spawn('cmd.exe', ['/d', '/s', '/c', 'dsh --profile tui'], { name: 'xterm-256color', cols: 120, rows: 40, cwd: root, env })
  const outcome = await new Promise(resolveExit => {
    const timeout = setTimeout(() => { timedOut = true; terminal.kill() }, 25_000)
    terminal.onData(data => {
      capture += data
      if (!sentDecision && capture.includes('PERMISSION REQUIRED') && capture.includes('bash')) {
        sentDecision = true
        setTimeout(() => terminal.write(key), 200)
      }
      if (!sentQuit && existsSync(audit)) {
        sentQuit = true
        setTimeout(() => { terminal.write('\x03'); setTimeout(() => terminal.write('\x03'), 200) }, 250)
      }
    })
    terminal.onExit(({ exitCode }) => { clearTimeout(timeout); resolveExit({ exitCode }) })
  })
  const auditData = existsSync(audit) ? JSON.parse(readFileSync(audit, 'utf8')) : undefined
  writeFileSync(join(results, `ac4-${mode}-capture.log`), capture, 'utf8')
  return {
    mode, exitCode: outcome.exitCode, timedOut, sentDecision, sentQuit,
    cardObserved: capture.includes('PERMISSION REQUIRED') && capture.includes('AC-4'),
    outcome: auditData?.outcome,
    askedLogged: auditData?.approvalEvents?.some(event => event.type === 'approval/asked') === true,
    decidedLogged: auditData?.approvalEvents?.some(event => event.type === 'approval/decided' && event.data.outcome === auditData.outcome) === true,
    targetExists: existsSync(target),
    targetExact: existsSync(target) && readFileSync(target, 'utf8') === 'approval allowed once\n',
    terminalRestored: capture.includes('\u001B[?1049h') && capture.includes('\u001B[?1049l'),
    ...(timedOut ? { captureTail: capture.replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/g, '').slice(-2000) } : {}),
  }
}

const before = sharedSnapshot()
const allowed = await runCase('allow', 'y')
const rejected = process.env.DSH_TUI_AC4_ONLY === 'allow' ? undefined : await runCase('reject', 'n')
const after = sharedSnapshot()
const report = {
  command: 'dsh --profile tui (isolated AC-4 profile overlay)', dimensions: { columns: 120, rows: 40 },
  profileInstallExitCode: install.status, allowed, rejected, sharedRepoUnchanged: before === after,
}
writeFileSync(join(results, 'ac4.json'), JSON.stringify(report, null, 2) + '\n')
const pass = allowed.exitCode === 0 && !allowed.timedOut && allowed.cardObserved && allowed.outcome === 'allowed-once'
  && allowed.askedLogged && allowed.decidedLogged && allowed.targetExact && allowed.terminalRestored
  && (rejected === undefined || rejected.exitCode === 0 && !rejected.timedOut && rejected.cardObserved && rejected.outcome === 'rejected'
  && rejected.askedLogged && rejected.decidedLogged && !rejected.targetExists && rejected.terminalRestored)
  && report.sharedRepoUnchanged
console.log(JSON.stringify(report, null, 2))
process.exit(pass ? 0 : 1)
