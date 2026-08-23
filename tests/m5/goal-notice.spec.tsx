import React from 'react'
import { render } from 'ink'
import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { InteractionController, RuntimeSnapshot } from '../../src/interaction-controller.js'
import { TranscriptStore } from '../../src/transcript-store.js'
import { Shell } from '../../src/ui/app.js'

const CARET = /\u001B\[(\d+)A\u001B\[(\d+)G\u001B\[\?25h/gu

function harness(columns: number, rows: number, runtime: RuntimeSnapshot) {
  const chunks: string[] = []
  const stdout = new Writable({ write(chunk, _e, done) { chunks.push(String(chunk)); done() } }) as unknown as NodeJS.WriteStream
  stdout.columns = columns
  stdout.rows = rows
  ;(stdout as { isTTY?: boolean }).isTTY = true
  const stdin = new PassThrough() as unknown as NodeJS.ReadStream
  ;(stdin as { isTTY?: boolean }).isTTY = true
  stdin.setRawMode = () => stdin
  stdin.ref = () => stdin
  stdin.unref = () => stdin
  const controller = {
    transcript: new TranscriptStore(),
    subscribe: () => () => {},
    getSnapshot: () => runtime,
    cancel: () => false,
    takeOver: () => false,
    submit: () => {},
    notify: () => {},
    commandChoices: () => [],
    permissionNames: () => [],
  } as unknown as InteractionController
  const instance = render(<Shell theme="abyss" color="mono" controller={controller} stdout={stdout} />, {
    stdout, stdin, patchConsole: false, exitOnCtrlC: false, interactive: true,
  })
  return { stdin, instance, chunks, caret() {
    const matches = [...chunks.join('').matchAll(CARET)]
    const match = matches.at(-1)
    return match === undefined ? undefined : { up: Number(match[1]), column: Number(match[2]) }
  }, frame() {
    return (chunks.filter(chunk => chunk.includes('⌁')).at(-1) ?? '').replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
  } }
}

const settle = (ms = 100): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
async function until<T>(read: () => T | undefined, label: string, timeout = 2_000): Promise<T> {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

const GOAL_NOTICE = 'Goal created\nStatus: active\nObjective: fix the caret\n\nCommands: /goal pause'

describe('a multi-line dsh command result never moves the composer', () => {
  for (const [columns, rows] of [[80, 24], [120, 32]] as const) {
    it(`collapses the ${columns}x${rows} footer to its fixed rows and parks the caret on the draft`, async () => {
      const runtime: RuntimeSnapshot = {
        sessionId: 's', cwd: '.', model: 'm', agentStatus: 'idle', permission: undefined,
        projection: undefined, theme: 'abyss', notice: GOAL_NOTICE, error: undefined, approval: undefined, questions: undefined,
        pendingImages: [], imageInput: false,
      }
      const app = harness(columns, rows, runtime)
      try {
        await until(() => app.caret(), 'initial caret')
        await settle(150)
        const lines = app.frame().split('\n')
        // The frame never outgrows the terminal: the signal folds onto the one
        // status row instead of growing the footer under the composer.
        expect(lines.length).toBeLessThanOrEqual(rows)
        // The folded notice is one single status line, not a multi-row block.
        const folded = lines.filter(line => line.includes('Status: active'))
        expect(folded).toHaveLength(1)
        expect(folded[0]).toContain('Goal created')
        // The narrow footer tail-truncates the folded line; the wide one keeps it whole.
        expect(folded[0]).toContain(columns <= 80 ? 'Commands: /goal' : 'Commands: /goal pause')
        expect(lines.some(line => line.trim() === 'Objective: fix the caret')).toBe(false)
        // The help row stays the last frame line.
        expect(lines.at(-1)).toContain('Enter send')
        // The composer is bottom-anchored exactly where the caret math expects.
        const editorIdx = lines.findIndex(line => /│ ›\s*│$/u.test(line))
        expect(editorIdx).toBe(rows - 4)
        expect(app.caret()).toEqual({ up: 3, column: columns <= 80 ? 6 : 7 })
      } finally {
        app.instance.unmount()
      }
    })
  }

  it('collapses a multi-line harness error the same way', async () => {
    const runtime: RuntimeSnapshot = {
      sessionId: 's', cwd: '.', model: 'm', agentStatus: 'idle', permission: undefined,
      projection: undefined, theme: 'abyss', notice: undefined, error: 'first failure\nsecond failure\nthird failure', approval: undefined, questions: undefined,
      pendingImages: [], imageInput: false,
    }
    const app = harness(80, 24, runtime)
    try {
      await until(() => app.caret(), 'initial caret')
      await settle(150)
      const lines = app.frame().split('\n')
      expect(lines.length).toBeLessThanOrEqual(24)
      const folded = lines.filter(line => line.includes('second failure'))
      expect(folded).toHaveLength(1)
      expect(folded[0]).toContain('first failure')
      expect(folded[0]).toContain('third failure')
      const editorIdx = lines.findIndex(line => /│ ›\s*│$/u.test(line))
      expect(editorIdx).toBe(24 - 4)
      expect(app.caret()).toEqual({ up: 3, column: 6 })
    } finally {
      app.instance.unmount()
    }
  })
})
