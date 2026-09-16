import React from 'react'
import { render } from 'ink'
import stringWidth from 'string-width'
import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { InteractionController, RuntimeSnapshot } from '../../src/interaction-controller.js'
import { TranscriptStore } from '../../src/transcript-store.js'
import { Shell } from '../../src/ui/app.js'

function harness(columns: number, rows: number, finished = false) {
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
  const runtime: RuntimeSnapshot = {
    sessionId: 'session-throughput', cwd: 'C:\\work', model: 'deepseek/chat', agentStatus: finished ? 'idle' : 'running', permission: 'workspace-write',
    projection: undefined, theme: 'abyss', notice: undefined, error: undefined, approval: undefined, questions: undefined,
    pendingImages: [], imageInput: false,
  }
  const store = new TranscriptStore()
  const now = Date.now()
  store.dispatch({ seq: 0, time: now - 3_000, type: 'turn/start', data: { turn: 1 } })
  store.dispatch({ seq: 1, time: now - 700, type: 'step/start', data: { turn: 1, step: 0 } })
  store.dispatch({ seq: 2, time: now - 500, type: 'assistant/chunk', data: { turn: 1, step: 0, chunk: { type: 'text-delta', index: 0, text: 'A' } } })
  store.dispatch({ seq: 3, time: now - 250, type: 'assistant/chunk', data: { turn: 1, step: 0, chunk: { type: 'text-delta', index: 0, text: 'B' } } })
  if (finished) {
    store.dispatch({ seq: 4, time: now - 120, type: 'assistant/chunk', data: { turn: 1, step: 0, chunk: { type: 'usage', usage: { outputTokens: 5 } } } })
    store.dispatch({
      seq: 5, time: now - 100, type: 'assistant/message',
      data: { turn: 1, step: 0, usage: { outputTokens: 5 }, message: { source: { kind: 'model' }, content: [{ type: 'text', text: 'AB' }] } },
    })
    store.dispatch({ seq: 6, time: now - 90, type: 'step/end', data: { turn: 1, step: 0 } })
    store.dispatch({ seq: 7, time: now - 80, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  }
  const controller = {
    transcript: store,
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
  return {
    instance,
    frame() {
      return (chunks.filter(chunk => chunk.includes('⌁')).at(-1) ?? '').replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
    },
  }
}

async function until<T>(read: () => T | undefined, timeout = 3_000): Promise<T> {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error('timed out waiting for live throughput')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

function displayedRate(frame: string): string | undefined {
  return frame.match(/⚡ \d+\.\d tok\/s/u)?.[0]
}

describe('the live token-throughput chip', () => {
  it('updates during generation and stacks between time and cache on a wide terminal', async () => {
    const app = harness(100, 30)
    try {
      const first = await until(() => displayedRate(app.frame()))
      const next = await until(() => {
        const value = displayedRate(app.frame())
        return value !== undefined && value !== first ? value : undefined
      })
      expect(next).not.toBe(first)

      const lines = app.frame().trimEnd().split('\n')
      for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(100)
      const timer = lines.findIndex(line => line.includes('◷'))
      const throughput = lines.findIndex(line => line.includes('tok/s'))
      const transcript = lines.findIndex(line => line.includes('TRANSCRIPT'))
      expect(timer).toBeGreaterThanOrEqual(0)
      expect(throughput).toBe(timer + 1)
      expect(throughput).toBeLessThan(transcript)
    } finally {
      app.instance.unmount()
    }
  })

  it('keeps the live rate visible on the compact one-line header', async () => {
    const app = harness(40, 24)
    try {
      await until(() => displayedRate(app.frame()))
      const lines = app.frame().trimEnd().split('\n')
      for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(40)
      expect(lines[0]).toContain('⚡')
      expect(lines[0]).toContain('tok/s')
    } finally {
      app.instance.unmount()
    }
  })

  it('keeps the final average frozen after generation has completed', async () => {
    const app = harness(100, 30, true)
    try {
      const first = await until(() => displayedRate(app.frame()))
      expect(first).toBe('⚡ 12.5 tok/s')
      await new Promise(resolve => setTimeout(resolve, 300))
      expect(displayedRate(app.frame())).toBe(first)
    } finally {
      app.instance.unmount()
    }
  })
})
