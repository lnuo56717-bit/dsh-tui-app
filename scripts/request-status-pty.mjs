import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'
import pty from 'node-pty'
import { ptyExitOk } from './pty-exit.mjs'

// Real alpha.2 adapter + retry loop against a local fixture, with an isolated
// DSH_HOME and fake key. No provider charge or daily Session/config mutation.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bin = join(root, '.computer-host', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const scratch = mkdtempSync(join(tmpdir(), 'dsh-request-status-'))
const credentialPath = join(process.env.USERPROFILE, '.dsh', '.credentials.yaml')
const credentialsBefore = readFileSync(credentialPath)
function sharedSnapshot() {
  return createHash('sha256')
    .update(execFileSync('git', ['-C', 'D:\\deepseek-harness', 'status', '--porcelain=v1', '-z', '--untracked-files=all']))
    .update(execFileSync('git', ['-C', 'D:\\deepseek-harness', 'diff', '--binary']))
    .digest('hex')
}
function filesBelow(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? filesBelow(join(dir, item.name)) : [join(dir, item.name)])
}
function readEvents(path) {
  const bytes = readFileSync(path)
  let offset = 0
  let content = ''
  while (offset < bytes.length) {
    const result = zstdDecompressSync(bytes.subarray(offset), { info: true })
    assert(result.engine.bytesWritten > 0)
    offset += result.engine.bytesWritten
    content += result.buffer.toString()
  }
  return content.trim().split('\n').map(line => JSON.parse(line))
}
let recover = false
let requests = 0
const server = createServer((request, response) => {
  request.resume()
  if (!recover) { requests += 1; request.socket.destroy(); return }
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const events = [
    { type: 'message_start', message: { id: 'fixture', type: 'message', role: 'assistant', model: 'deepseek-flash', content: [], usage: { input_tokens: 10, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Recovered fixture OK' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
    { type: 'message_stop' },
  ]
  response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
})
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
const beforeRepo = sharedSnapshot()
const report = []
const sessions = join(scratch, 'sessions')
const overlay = join(scratch, 'retry.yml')
writeFileSync(overlay, `- id: llm-deepseek\n  config:\n    baseURL: http://127.0.0.1:${server.address().port}/anthropic\n    reasoningEffort: 'off'\n    retryPolicy:\n      mode: normal\n      maxRetries: 2\n      backoff:\n        initialDelayMs: 250\n        maxDelayMs: 500\n        jitterRatio: 0\n`)
const env = {
  ...process.env, DSH_HOME: scratch, DEEPSEEK_API_KEY: 'request-status-fixture-only',
  DEEPSEEK_BASE_URL: `http://127.0.0.1:${server.address().port}/anthropic`,
  DSH_TUI_COMPUTER: 'off', TERM: 'xterm-256color', COLORTERM: 'truecolor',
}
delete env.NO_COLOR
delete env.FORCE_COLOR
const terminals = new Set()
async function runTerminal(columns, rows, resume, onReady, onDone) {
  let capture = ''
  let phase = 'ready'
  const terminal = pty.spawn(process.execPath, [bin, '--profile', 'tui-computer', '--patch', overlay, ...(resume ? ['--resume', resume] : [])], {
    name: 'xterm-256color', cols: columns, rows, cwd: root, env,
  })
  terminals.add(terminal)
  let timedOut = false
  const exitCode = await new Promise(resolveExit => {
    const timeout = setTimeout(() => { timedOut = true; terminal.kill() }, 35_000)
    terminal.onData(data => {
      capture += data
      const plain = capture.replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
      if (phase === 'ready' && plain.includes('TRANSCRIPT') && (!resume || plain.includes('Turn failed'))) {
        phase = 'done'
        onReady(terminal, plain)
      }
      if (phase === 'done' && onDone(plain)) {
        phase = 'quit'
        setTimeout(() => { terminal.write('\x03'); setTimeout(() => terminal.write('\x03'), 200) }, 150)
      }
    })
    terminal.onExit(({ exitCode }) => { clearTimeout(timeout); terminals.delete(terminal); resolveExit(exitCode) })
  })
  assert(!timedOut, `PTY timed out (${columns}x${rows}, ${resume ? 'resume' : 'new'}): ${capture.slice(-1800)}`)
  assert(ptyExitOk(exitCode), `PTY exit ${exitCode}`)
  assert(capture.includes('\u001B[?1049h') && capture.includes('\u001B[?1049l'), 'terminal restored')
  return capture.replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
}
function sendPrompt(terminal, text) {
  // ConPTY can deliver a whole write as a paste; send Enter as a separate key.
  setTimeout(() => { terminal.write(text); setTimeout(() => terminal.write('\r'), 150) }, 250)
}
try {
  const install = spawnSync(process.execPath, [bin, 'plugin', '--profile', 'tui-computer', 'add', root], { cwd: root, env, encoding: 'utf8' })
  assert.equal(install.status, 0, install.stderr)
  for (const [columns, rows] of [[80, 24], [120, 40]]) {
    recover = false
    requests = 0
    const beforeSessions = new Set(filesBelow(sessions))
    const failed = await runTerminal(columns, rows, undefined,
      terminal => sendPrompt(terminal, 'UI failure fixture'),
      plain => plain.includes('Turn failed') && plain.includes('Check the network/proxy'))
    assert(failed.includes('Retry 2/2') && failed.includes('[TRANSPORT]'))
    assert(failed.includes('Runtime context') && !failed.includes('Current runtime context.'))
    assert(failed.includes('· failed') && !failed.includes('retry  retry  waiting'))
    const log = filesBelow(sessions).find(path => !beforeSessions.has(path) && path.endsWith('session.v3.jsonl.zstd'))
    assert(log, 'fixture Session persisted')
    const events = readEvents(log)
    assert.equal(events.filter(event => event.type === 'llm/retry').length, 2)
    assert.equal(events.at(-1).data.reason.kind, 'error')
    const sessionId = events[0].id
    recover = true
    let persistedFailureShown = false
    const recovered = await runTerminal(columns, rows, sessionId,
      (terminal, plain) => { persistedFailureShown = plain.includes('Turn failed'); sendPrompt(terminal, 'Recover fixture') },
      plain => plain.includes('Recovered fixture OK') && plain.includes('Turn completed'))
    assert(persistedFailureShown)
    assert(recovered.includes('· idle'))
    report.push({ columns, rows, transportFailureShown: true, attempts: 2, collapsedRuntimeContext: true, persistedFailureShown, nextTurnRecovered: true, terminalRestored: true })
  }
  assert.equal(sharedSnapshot(), beforeRepo, 'upstream checkout unchanged')
  assert(readFileSync(credentialPath).equals(credentialsBefore), 'daily credentials unchanged')
  console.log(JSON.stringify({ cases: report, sharedRepoUnchanged: true, credentialsUnchanged: true }, null, 2))
} finally {
  for (const terminal of terminals) terminal.kill()
  server.closeAllConnections()
  await new Promise(resolveClose => server.close(resolveClose))
  // Only remove the exact directory allocated by this test.
  assert(resolve(scratch).startsWith(resolve(tmpdir()) + '\\'))
  rmSync(scratch, { recursive: true, force: true })
}
// node-pty's ConPTY helper may retain its event-loop handle after clean exit.
process.exit(0)
