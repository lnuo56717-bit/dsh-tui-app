import React from 'react'
import { render } from 'ink'
import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { InteractionController, RuntimeSnapshot } from '../../src/interaction-controller.js'
import { foldEvents, type EventLike } from '../../src/transcript-fold.js'
import { TranscriptStore } from '../../src/transcript-store.js'
import { Shell } from '../../src/ui/app.js'

const CARET = /\u001B\[(\d+)A\u001B\[(\d+)G\u001B\[\?25h/gu

function conversation(turns: number): EventLike[] {
  const events: EventLike[] = []
  let seq = 0
  for (let turn = 1; turn <= turns; turn += 1) {
    events.push({
      seq: seq++, type: 'user/message', surfaceOp: 'append',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: `第 ${turn} 个问题 🐋` }] },
    })
    events.push({
      seq: seq++, type: 'assistant/message', surfaceOp: 'append',
      data: { turn, step: 1, message: { role: 'assistant', source: { kind: 'model' }, content: [
        { type: 'text', text: `回答 ${turn} 第一行\n\n回答 ${turn} 第二行\n\n回答 ${turn} 第三行` },
      ] } },
    })
  }
  return events
}

function harness(withTranscript: boolean) {
  const chunks: string[] = []
  const stdout = new Writable({ write(chunk, _encoding, done) { chunks.push(String(chunk)); done() } }) as unknown as NodeJS.WriteStream
  stdout.columns = 100
  stdout.rows = 30
  ;(stdout as { isTTY?: boolean }).isTTY = true

  const stdin = new PassThrough() as unknown as NodeJS.ReadStream
  ;(stdin as { isTTY?: boolean }).isTTY = true
  stdin.setRawMode = () => stdin
  stdin.ref = () => stdin
  stdin.unref = () => stdin

  const snapshot: RuntimeSnapshot = {
    sessionId: 'session-mouse', cwd: 'C:\\work', model: 'mock/whale', agentStatus: 'idle',
    permission: 'workspace-write', projection: undefined, theme: 'abyss', notice: undefined, error: undefined,
    approval: undefined, questions: undefined,
  }
  const controller = {
    transcript: withTranscript ? new TranscriptStore(foldEvents(conversation(2))) : new TranscriptStore(),
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    cancel: () => false,
    takeOver: () => false,
    submit: () => {},
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
    stdin,
    instance,
    chunks,
    caret(): { up: number; column: number } | undefined {
      const matches = [...chunks.join('').matchAll(CARET)]
      const match = matches.at(-1)
      return match === undefined ? undefined : { up: Number(match[1]), column: Number(match[2]) }
    },
    frame(): string {
      return (chunks.filter(chunk => chunk.includes('⌁')).at(-1) ?? '').replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
    },
  }
}

const settle = (ms = 80): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

async function until<T>(read: () => T | undefined, label: string, timeout = 2_000): Promise<T> {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

describe('mouse editing of the composer', () => {
  it('moves the caret to the clicked cell and drag-selection is replaced by typing', async () => {
    const app = harness(false)
    try {
      app.stdin.write('abc')
      // 100×30, margin 2: caret after 'abc' sits at column 10.
      await until(() => { const caret = app.caret(); return caret !== undefined && caret.column === 10 ? caret : undefined }, 'caret after typing')
      await settle()

      // Click the first text cell (screen column 7 = margin 2 + prefix + 1).
      app.stdin.write('\u001B[<0;7;27M')
      await until(() => { const caret = app.caret(); return caret !== undefined && caret.column === 7 ? caret : undefined }, 'caret after click')
      await settle()

      // Drag to the cell just past 'abc' (column 10): selection [0, 3).
      app.stdin.write('\u001B[<32;10;27M')
      await until(() => { const caret = app.caret(); return caret !== undefined && caret.column === 10 ? caret : undefined }, 'caret after drag')
      await settle()

      // Typing replaces the selection.
      app.stdin.write('X')
      await until(() => app.frame().includes('› X') ? app.frame() : undefined, 'replacement text')
      expect(app.frame()).not.toContain('abc')
      expect(app.caret()).toEqual({ up: 3, column: 8 })
    } finally {
      app.instance.unmount()
    }
  })
})

describe('mouse selection of the transcript', () => {
  it('drags across a row and copies the selected cells on release', async () => {
    const app = harness(true)
    try {
      await until(() => app.frame().includes('回答 2 第三行') ? app.frame() : undefined, 'transcript rows')

      // Last visible row = 回答 2 第三行 at screen row 22 (30 rows, composer 4).
      // Drag the whole row: from its first cell to well past its last one.
      app.stdin.write('\u001B[<0;3;22M')
      await settle()
      app.stdin.write('\u001B[<32;40;22M')
      await settle()
      app.stdin.write('\u001B[<0;40;22m')
      const expected = Buffer.from('  回答 2 第三行', 'utf8').toString('base64')
      const copied = await until(() => {
        return app.chunks.join('').includes(`\u001B]52;c;${expected}\u0007`) ? expected : undefined
      }, 'OSC 52 copy of the selected cells')
      expect(copied).toBe(expected)
    } finally {
      app.instance.unmount()
    }
  })
})
