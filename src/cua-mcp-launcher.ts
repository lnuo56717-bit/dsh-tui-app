import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function standardCuaEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...source, CUA_DRIVER_PERMISSION_MODE: 'standard' }
  delete env.CUA_DRIVER_CAPABILITY_MANIFEST_FILE
  delete env.CUA_DRIVER_CAPABILITY_MANIFEST_APPROVED
  delete env.CUA_DRIVER_SESSION_POLICY_FILE
  // Older prerelease builds used the unsuffixed spelling. Strip it too so an
  // inherited environment can never weaken the pinned standard-mode launch.
  delete env.CUA_DRIVER_SESSION_POLICY
  delete env.CUA_DRIVER_SESSION_POLICY_APPROVED
  return env
}

export function launch(executable: string | undefined): void {
  if (executable === undefined || executable.trim() === '') {
    process.stderr.write('cua-mcp-launcher: missing Cua Driver executable\n')
    process.exitCode = 2
    return
  }
  const child = spawn(executable, ['mcp'], {
    env: standardCuaEnvironment(),
    stdio: 'inherit',
    windowsHide: true,
  })
  let settled = false
  const stop = (signal: NodeJS.Signals): void => {
    if (!settled) child.kill(signal)
  }
  process.once('SIGINT', () => stop('SIGINT'))
  process.once('SIGTERM', () => stop('SIGTERM'))
  process.once('exit', () => { if (!settled) child.kill() })
  child.once('error', error => {
    settled = true
    process.stderr.write(`cua-mcp-launcher: ${error.message}\n`)
    process.exitCode = 1
  })
  child.once('exit', (code, signal) => {
    settled = true
    process.exitCode = code ?? (signal === null ? 1 : 128)
  })
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  launch(process.argv[2])
}
