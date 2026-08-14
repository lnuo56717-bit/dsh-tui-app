import React from 'react'
import { render } from 'ink'
import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { Shell } from '../../src/ui/app.js'

// Ink paints the cursor suffix inside the frame write itself: moveUp + cursorTo
// + show. The suffix rides every frame, so a delayed throttled repaint can
// never leave the terminal cursor parked at the end of the screen.
const CARET = /\u001B\[(\d+)A\u001B\[(\d+)G\u001B\[\?25h/gu

function harness() {
  const chunks: string[] = []
  const stdout = new Writable({ write(chunk, _encoding, done) { chunks.push(String(chunk)); done() } }) as unknown as NodeJS.WriteStream
  stdout.columns = 80
  stdout.rows = 24
  ;(stdout as { isTTY?: boolean }).isTTY = true

  const stdin = new PassThrough() as unknown as NodeJS.ReadStream
  ;(stdin as { isTTY?: boolean }).isTTY = true
  stdin.setRawMode = () => stdin
  stdin.ref = () => stdin
  stdin.unref = () => stdin

  const instance = render(<Shell theme="abyss" color="mono" sessionId="session-caret" stdout={stdout} />, {
    stdout, stdin, patchConsole: false, exitOnCtrlC: false,
    // CI runners default Ink to non-interactive, which defers frame writes to unmount.
    // Pin interactive so the caret/frame output stays real-time in tests on any host.
    interactive: true,
  })
  return {
    stdin,
    instance,
    caret(): { up: number; column: number } | undefined {
      const matches = [...chunks.join('').matchAll(CARET)]
      const match = matches.at(-1)
      return match === undefined ? undefined : { up: Number(match[1]), column: Number(match[2]) }
    },
    frame(): string {
      return (chunks.filter(chunk => chunk.includes('PROMPT')).at(-1) ?? '').replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
    },
  }
}

async function until<T>(read: () => T | undefined, timeout = 2_000): Promise<T> {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error('timed out waiting for the terminal caret')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

describe('IME pre-edit text follows the composer caret', () => {
  it('parks the terminal cursor on the caret cell with every frame, counting CJK cells', async () => {
    const app = harness()
    try {
      // 80×24, margin 1: blank caret at row 21, column 6 → up 4, cursorTo 6.
      expect(await until(() => app.caret())).toEqual({ up: 4, column: 6 })

      app.stdin.write('中文a')
      const moved = await until(() => {
        const caret = app.caret()
        return caret !== undefined && caret.column !== 6 ? caret : undefined
      })
      // ' │ › 中文a' — border, padding, prompt marker, then two wide graphemes.
      expect(moved).toEqual({ up: 4, column: 11 })
      expect(await until(() => app.frame().includes('中文a') || undefined)).toBe(true)
    } finally {
      app.instance.unmount()
    }
  })

  it('keeps the cursor on the composer while an empty draft is idle', async () => {
    const app = harness()
    try {
      expect(await until(() => app.caret())).toEqual({ up: 4, column: 6 })
    } finally {
      app.instance.unmount()
    }
  })
})
