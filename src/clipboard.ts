import { spawn } from 'node:child_process'

/** Largest base64 payload handed to a terminal; longer copies go through the OS tool only. */
export const OSC52_LIMIT = 74_994

export interface ClipboardTarget {
  readonly command: string
  readonly args: readonly string[]
  /** Encoding the tool expects on stdin. `clip.exe` needs UTF-16LE with a BOM for CJK. */
  readonly encoding: 'utf16le-bom' | 'utf8'
}

export interface ClipboardResult {
  /** Whether the terminal-native OSC 52 sequence was emitted (delivery cannot be observed). */
  readonly terminal: boolean
  /** Result of the platform clipboard tool, when this platform has one. */
  readonly process: 'ok' | 'failed' | 'unavailable'
}

export function clipboardTarget(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = process.env): ClipboardTarget | undefined {
  if (platform === 'win32') return { command: 'clip.exe', args: [], encoding: 'utf16le-bom' }
  if (platform === 'darwin') return { command: 'pbcopy', args: [], encoding: 'utf8' }
  if (platform === 'linux' || platform === 'freebsd' || platform === 'openbsd') {
    return env.WAYLAND_DISPLAY === undefined
      ? { command: 'xclip', args: ['-selection', 'clipboard'], encoding: 'utf8' }
      : { command: 'wl-copy', args: [], encoding: 'utf8' }
  }
  return undefined
}

export function encodeForTarget(text: string, target: ClipboardTarget): Buffer {
  if (target.encoding !== 'utf16le-bom') return Buffer.from(text, 'utf8')
  return Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(text, 'utf16le')])
}

/** OSC 52 clipboard write. Works over SSH and in terminals that own the clipboard. */
export function osc52(text: string): string | undefined {
  const payload = Buffer.from(text, 'utf8').toString('base64')
  return payload.length > OSC52_LIMIT ? undefined : `\u001B]52;c;${payload}\u0007`
}

function runTarget(text: string, target: ClipboardTarget): Promise<'ok' | 'failed'> {
  return new Promise(resolve => {
    let settled = false
    const finish = (outcome: 'ok' | 'failed'): void => {
      if (settled) return
      settled = true
      resolve(outcome)
    }
    try {
      const child = spawn(target.command, [...target.args], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true })
      child.once('error', () => finish('failed'))
      child.once('close', code => finish(code === 0 ? 'ok' : 'failed'))
      child.stdin.once('error', () => finish('failed'))
      child.stdin.end(encodeForTarget(text, target))
    } catch {
      finish('failed')
    }
  })
}

/**
 * Copy through both available paths: the terminal's own OSC 52 sink and the
 * platform clipboard tool. Neither is reported as success unless it really ran —
 * a terminal that ignores OSC 52 cannot be detected, so the caller says what was
 * attempted rather than claiming the clipboard changed.
 */
export async function copyToClipboard(
  text: string,
  options: { stdout?: Pick<NodeJS.WriteStream, 'write'>; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {},
): Promise<ClipboardResult> {
  if (text === '') return { terminal: false, process: 'unavailable' }
  const sequence = osc52(text)
  const stream = options.stdout ?? process.stdout
  if (sequence !== undefined) stream.write(sequence)
  const target = clipboardTarget(options.platform ?? process.platform, options.env ?? process.env)
  return {
    terminal: sequence !== undefined,
    process: target === undefined ? 'unavailable' : await runTarget(text, target),
  }
}

export function copyNotice(text: string, result: ClipboardResult): string {
  const lines = text === '' ? 0 : text.split('\n').length
  const scope = `${lines} line${lines === 1 ? '' : 's'}`
  if (result.process === 'ok') return `Copied ${scope} to the clipboard`
  if (result.terminal) return `Sent ${scope} to the terminal clipboard; the terminal decides whether to accept it`
  return `Could not reach a clipboard for ${scope}`
}
