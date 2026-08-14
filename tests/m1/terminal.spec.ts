import { describe, expect, it } from 'vitest'
import { enterFullscreen, terminalSequences } from '../../src/ui/terminal.js'

describe('M1 terminal lease', () => {
  it('enters and leaves alternate screen exactly once', () => {
    let output = ''
    const lease = enterFullscreen({ write: (chunk: string | Uint8Array) => { output += String(chunk); return true } } as NodeJS.WriteStream)
    lease.release()
    lease.release()
    expect(output).toBe(terminalSequences.ENTER_ALT + terminalSequences.LEAVE_ALT)
  })
})
