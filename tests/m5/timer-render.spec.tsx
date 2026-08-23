import React from 'react'
import { render } from 'ink'
import stringWidth from 'string-width'
import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { InteractionController, RuntimeSnapshot } from '../../src/interaction-controller.js'
import { TranscriptStore } from '../../src/transcript-store.js'
import type { EventLike } from '../../src/transcript-fold.js'
import { Shell } from '../../src/ui/app.js'

function harness(columns: number, rows: number) {
  const chunks: string[] = []
  const stdout = new Writable({ write(chunk, _encoding, done) { chunks.push(String(chunk)); done() } }) as unknown as NodeJS.WriteStream
  stdout.columns = columns
  stdout.rows = rows
  ;(stdout as { isTTY?: boolean }).isTTY = true

  const stdin = new PassThrough() as unknown as NodeJS.ReadStream
  ;(stdin as { isTTY?: boolean }).isTTY = true
  stdin.setRawMode = () => stdin
  stdin.ref = () => stdin
  stdin.unref = () => stdin

  let snapshot: RuntimeSnapshot = {
    sessionId: 'session-timer', cwd: 'C:\\work', model: 'mock/whale', agentStatus: 'running',
    permission: 'workspace-write', projection: undefined, theme: 'abyss', notice: undefined, error: undefined,
    approval: undefined, questions: undefined, pendingImages: [], imageInput: false,
  }
  const store = new TranscriptStore()
  const controller = {
    transcript: store,
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    notify: () => {},
    commandChoices: () => [],
    permissionNames: () => [],
  } as unknown as InteractionController

  const instance = render(<Shell theme="abyss" color="mono" controller={controller} stdout={stdout} />, {
    stdout, stdin, patchConsole: false, exitOnCtrlC: false,
    // CI runners default Ink to non-interactive, which defers frame writes to unmount.
    interactive: true,
  })
  return {
    instance,
    store,
    dispatch(event: EventLike): void { store.dispatch(event) },
    idle(): void { snapshot = { ...snapshot, agentStatus: 'idle' } },
    frame(): string {
      return (chunks.filter(chunk => chunk.includes('⌁')).at(-1) ?? '').replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
    },
  }
}

async function until<T>(read: () => T | undefined, timeout = 3_000): Promise<T> {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error('timed out waiting for the elapsed chip')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

function turnStart(seq: number, turn: number, time: number): EventLike {
  return { seq, time, type: 'turn/start', data: { turn } }
}

function turnEnd(seq: number, turn: number, time: number): EventLike {
  return { seq, time, type: 'turn/end', data: { turn, reason: { kind: 'completed' } } }
}

describe('the chrome times the running task and then the conversation', () => {
  it('counts the open turn up on its own clock and settles on the totals when it closes', async () => {
    const app = harness(100, 30)
    try {
      // A first, already finished turn: five logged seconds of task time.
      const start = Date.now()
      app.dispatch(turnStart(0, 1, start - 65_000))
      app.dispatch(turnEnd(1, 1, start - 60_000))
      app.dispatch(turnStart(2, 2, start - 3_200))

      const opened = await until(() => /◷ (\d+)s · total (\d+)s/u.exec(app.frame()) ?? undefined)
      const seconds = Number(opened[1])
      expect(seconds).toBeGreaterThanOrEqual(3)
      // The running turn is added to the finished one; the total is not a separate clock.
      expect(Number(opened[2])).toBe(seconds + 5)

      // No further events: the chip advances because the task is still running.
      const ticked = await until(() => {
        const match = /◷ (\d+)s · total (\d+)s/u.exec(app.frame())
        return match !== null && Number(match[1]) > seconds ? Number(match[1]) : undefined
      })
      expect(ticked).toBe(seconds + 1)

      app.idle()
      app.dispatch(turnEnd(3, 2, start - 3_200 + 4_400))
      // Both spans are logged facts now, so the settled reading is exact.
      await until(() => app.frame().includes('◷ last 4s · total 9s') || undefined)

      const lines = app.frame().trimEnd().split('\n')
      expect(lines.length).toBeLessThanOrEqual(30)
      for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(100)
      // The chip rides the header: above the transcript chrome and the composer,
      // never competing with the status facts for the footer line.
      const chip = lines.findIndex(line => line.includes('◷'))
      const composer = lines.findIndex(line => line.includes('⌁'))
      expect(chip).toBeGreaterThanOrEqual(0)
      expect(chip).toBeLessThan(composer)
    } finally {
      app.instance.unmount()
    }
  })

  it('keeps the narrow header to one row by trading the title for the timer, never wrapping', async () => {
    const app = harness(40, 24)
    try {
      const start = Date.now()
      app.dispatch(turnStart(0, 1, start - 12_000))
      await until(() => app.frame().includes('◷ 12s') || undefined)

      const lines = app.frame().trimEnd().split('\n')
      expect(lines.length).toBeLessThanOrEqual(24)
      for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(40)
      // Compact mode has no padding row, so the chip shares the very first line.
      expect(lines[0]).toContain('◷')
    } finally {
      app.instance.unmount()
    }
  })

  it('shows no timer at all before the log has timed a single turn', async () => {
    const app = harness(100, 30)
    try {
      await until(() => app.frame().includes('⌁') || undefined)
      expect(app.frame()).not.toContain('◷')
    } finally {
      app.instance.unmount()
    }
  })
})
