import React from 'react'
import { render } from 'ink'
import stringWidth from 'string-width'
import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { InteractionController, RuntimeSnapshot } from '../../src/interaction-controller.js'
import { TranscriptStore } from '../../src/transcript-store.js'
import { Shell } from '../../src/ui/app.js'

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
  const runtime: RuntimeSnapshot = {
    sessionId: 'session-cache', cwd: 'C:\\work', model: 'mock/whale', agentStatus: 'running', permission: 'workspace-write',
    projection: { asOfSeq: 1, values: {
      // 90 of 100 billed prompt tokens came from the cache: the web metric.
      tokenUsage: { uncachedInputTokens: 10, outputTokens: 5, cacheReadTokens: 90, cacheWriteTokens: 0 },
    } },
    theme: 'abyss', notice: undefined, error: undefined, approval: undefined, questions: undefined,
  }
  const store = new TranscriptStore()
  store.dispatch({ seq: 0, time: Date.now() - 12_000, type: 'turn/start', data: { turn: 1 } })
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
  return { instance, frame() {
    return (chunks.filter(chunk => chunk.includes('⌁')).at(-1) ?? '').replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
  } }
}

async function until<T>(read: () => T | undefined, timeout = 3_000): Promise<T> {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error('timed out waiting for the header chips')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

describe('the header chips the cache hit rate under the elapsed timer', () => {
  it('stacks the cache rate below the timer chip on a wide terminal', async () => {
    const app = harness(100, 30)
    try {
      await until(() => app.frame().includes('cache hit 90%') ? app.frame() : undefined)
      const lines = app.frame().trimEnd().split('\n')
      expect(lines.length).toBeLessThanOrEqual(30)
      for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(100)
      const timer = lines.findIndex(line => line.includes('◷'))
      const cache = lines.findIndex(line => line.includes('cache hit 90%'))
      const transcript = lines.findIndex(line => line.includes('TRANSCRIPT'))
      const composer = lines.findIndex(line => line.includes('⌁'))
      expect(timer).toBeGreaterThanOrEqual(0)
      expect(cache).toBe(timer + 1)
      expect(timer).toBeLessThan(transcript)
      expect(transcript).toBeLessThan(composer)
      // The status footer keeps its full width: no chip crowds it anymore.
      const footer = lines.filter(line => line.includes('effort default'))
      expect(footer).toHaveLength(1)
      expect(footer[0]).toContain('workspace-write')
    } finally {
      app.instance.unmount()
    }
  })

  it('keeps both chips on the one compact header row', async () => {
    const app = harness(40, 24)
    try {
      await until(() => app.frame().includes('cache hit 90%') ? app.frame() : undefined)
      const lines = app.frame().trimEnd().split('\n')
      expect(lines.length).toBeLessThanOrEqual(24)
      for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(40)
      expect(lines[0]).toContain('◷')
      expect(lines[0]).toContain('cache hit 90%')
    } finally {
      app.instance.unmount()
    }
  })
})
