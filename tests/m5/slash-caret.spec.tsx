import React from 'react'
import { render } from 'ink'
import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { InteractionController, RuntimeSnapshot } from '../../src/interaction-controller.js'
import { TranscriptStore } from '../../src/transcript-store.js'
import { Shell } from '../../src/ui/app.js'

const CARET = /\u001B\[(\d+)A\u001B\[(\d+)G\u001B\[\?25h/gu

function harness(columns: number, rows: number) {
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
  const snapshot: RuntimeSnapshot = {
    sessionId: 's', cwd: '.', model: 'm', agentStatus: 'idle', permission: undefined,
    projection: undefined, theme: 'abyss', notice: undefined, error: undefined, approval: undefined, questions: undefined,
  }
  const controller = {
    transcript: new TranscriptStore(),
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    cancel: () => false,
    takeOver: () => false,
    submit: () => {},
    notify: () => {},
    // Long real-world command names and descriptions: before the fix they
    // wrapped inside the panel and pushed the frame past the terminal height.
    commandChoices: () => Array.from({ length: 9 }, (_, i) => ({
      name: `command-with-a-very-long-name-${i}`, source: 'dsh' as const,
      description: `a description long enough to wrap across the panel at this width ${i} ${'x'.repeat(80)}`,
      inputHint: 'some extra hint text that also takes cells',
    })),
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

describe('slash commands keep the caret on the composer', () => {
  for (const [columns, rows] of [[80, 24], [80, 20], [100, 30]] as const) {
    it(`never overflows the frame at ${columns}x${rows} and parks the caret on the draft`, async () => {
      const app = harness(columns, rows)
      try {
        await until(() => app.caret(), 'initial caret')
        app.stdin.write('/')
        await until(() => app.frame().includes('COMMAND SONAR') ? app.frame() : undefined, 'command panel')
        app.stdin.write('k')
        await settle(250)
        const lines = app.frame().split('\n')
        // No frame line may run past the terminal height: the panel clips its
        // list to the height budget instead of pushing the composer off-screen.
        expect(lines.length).toBeLessThanOrEqual(rows)
        expect(lines.some(line => line.includes('COMMAND SONAR'))).toBe(true)
        // The draft still renders in the composer, bottom-anchored.
        const editorIdx = lines.findIndex(line => line.includes('› /k'))
        expect(editorIdx).toBe(rows - 4)
        // The suffix lands exactly on the editor line: rows-3 from the frame
        // bottom, so the up-move is 3 regardless of panel height.
        expect(app.caret()).toEqual({ up: 3, column: columns <= 80 ? 8 : 9 })
      } finally {
        app.instance.unmount()
      }
    })
  }
})
