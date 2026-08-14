import React from 'react'
import { render } from 'ink'
import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { Shell } from '../../src/ui/app.js'

const CARET = /\u001B\[(\d+);(\d+)H/u

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
  })
  return {
    stdin,
    instance,
    caret(): { row: number; column: number } | undefined {
      const match = chunks.filter(chunk => CARET.test(chunk)).at(-1)
      const parsed = match === undefined ? null : CARET.exec(match)
      return parsed === null ? undefined : { row: Number(parsed[1]), column: Number(parsed[2]) }
    },
    caretShown(): boolean {
      return chunks.filter(chunk => CARET.test(chunk)).at(-1)?.includes('\u001B[?25h') === true
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
  it('parks the terminal cursor on the caret cell after each frame, counting CJK cells', async () => {
    const app = harness()
    try {
      // The frame is painted first; the caret sequence must land after it.
      expect(await until(() => app.caret())).toEqual({ row: 21, column: 6 })
      expect(app.caretShown()).toBe(true)

      app.stdin.write('中文a')
      const moved = await until(() => {
        const caret = app.caret()
        return caret !== undefined && caret.column !== 6 ? caret : undefined
      })
      // ' │ › 中文a' — border, padding, prompt marker, then two wide graphemes.
      expect(moved).toEqual({ row: 21, column: 11 })
      expect(await until(() => app.frame().includes('中文a') || undefined)).toBe(true)
    } finally {
      app.instance.unmount()
    }
  })
})
