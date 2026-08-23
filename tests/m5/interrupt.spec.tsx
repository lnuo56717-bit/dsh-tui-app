import React from 'react'
import { render } from 'ink'
import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { InteractionController, RuntimeSnapshot } from '../../src/interaction-controller.js'
import { TranscriptStore } from '../../src/transcript-store.js'
import { Shell } from '../../src/ui/app.js'

function harness(agentStatus: RuntimeSnapshot['agentStatus']) {
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
    sessionId: 'session-stop', cwd: 'C:\\work', model: 'mock/whale', agentStatus,
    permission: 'workspace-write', projection: undefined, theme: 'abyss', notice: undefined, error: undefined,
    approval: undefined, questions: undefined, pendingImages: [], imageInput: false,
  }
  const calls = { cancels: 0, submits: 0, takeOvers: 0, keep: [] as boolean[], takeoverTexts: [] as string[][] }
  const controller = {
    transcript: new TranscriptStore(),
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    cancel: (keepInbox?: boolean) => { calls.cancels += 1; calls.keep.push(keepInbox === true); return true },
    takeOver: (texts: readonly string[]) => { calls.takeOvers += 1; calls.takeoverTexts.push([...texts]); return true },
    submit: () => { calls.submits += 1 },
    notify: () => {},
    commandChoices: () => [],
    permissionNames: () => [],
  } as unknown as InteractionController

  const instance = render(<Shell theme="abyss" color="mono" controller={controller} stdout={stdout} />, {
    stdout, stdin, patchConsole: false, exitOnCtrlC: false,
    // CI runners default Ink to non-interactive, which defers frame writes to unmount.
    interactive: true,
  })
  return { stdin, instance, calls, chunks, frame(): string {
    return (chunks.filter(chunk => chunk.includes('⌁')).at(-1) ?? '').replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
  } }
}

const settle = (ms = 80): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

async function untilFrame(app: ReturnType<typeof harness>, text: string, timeout = 2_000): Promise<void> {
  const deadline = Date.now() + timeout
  for (;;) {
    if (app.frame().includes(text)) return
    if (Date.now() > deadline) throw new Error(`timed out waiting for frame text: ${text}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function untilCount(app: ReturnType<typeof harness>, field: 'cancels' | 'submits' | 'takeOvers', count: number, timeout = 2_000): Promise<void> {
  const deadline = Date.now() + timeout
  for (;;) {
    if (app.calls[field] === count) return
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${field} to reach ${count}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

describe('interrupting a running turn', () => {
  it('Esc stops the turn outright', async () => {
    const app = harness('running')
    try {
      await untilFrame(app, 'FOLLOW-UP')
      app.stdin.write('\u001B')
      await untilCount(app, 'cancels', 1)
      expect(app.calls.keep).toEqual([false])
    } finally {
      app.instance.unmount()
    }
  })

  it('Enter sends the draft and a second Enter takes over with it', async () => {
    const app = harness('running')
    try {
      await untilFrame(app, 'FOLLOW-UP')
      app.stdin.write('继续')
      await settle()
      app.stdin.write('\r')
      await untilCount(app, 'submits', 1)
      expect(app.calls.cancels).toBe(0)
      // The sent draft arms the take-over hint on the help line.
      expect(app.frame()).toContain('Enter again or Esc to take over')
      app.stdin.write('\r')
      await untilCount(app, 'takeOvers', 1)
      // The wake is re-sent after the abort, so the draft survives and the
      // agent keeps thinking with it — the plain stop path never fires.
      expect(app.calls.cancels).toBe(0)
      expect(app.calls.takeoverTexts).toEqual([['继续']])
    } finally {
      app.instance.unmount()
    }
  })

  it('Esc takes over with the sent draft instead of dropping it', async () => {
    const app = harness('running')
    try {
      await untilFrame(app, 'FOLLOW-UP')
      app.stdin.write('继续')
      await settle()
      app.stdin.write('\r')
      await untilCount(app, 'submits', 1)
      app.stdin.write('\u001B')
      await untilCount(app, 'takeOvers', 1)
      expect(app.calls.cancels).toBe(0)
      expect(app.calls.takeoverTexts).toEqual([['继续']])
    } finally {
      app.instance.unmount()
    }
  })

  it('two Enters with no draft still stop the turn', async () => {
    const app = harness('running')
    try {
      await untilFrame(app, 'FOLLOW-UP')
      app.stdin.write('\r')
      await settle()
      expect(app.calls.cancels).toBe(0)
      expect(app.frame()).toContain('Enter again to stop')
      app.stdin.write('\r')
      await untilCount(app, 'cancels', 1)
      expect(app.calls.keep).toEqual([false])
    } finally {
      app.instance.unmount()
    }
  })

  it('a single armed Enter expires without stopping', async () => {
    const app = harness('running')
    try {
      await untilFrame(app, 'FOLLOW-UP')
      app.stdin.write('\r')
      await untilFrame(app, 'Enter again to stop')
      await settle(1_300)
      expect(app.calls.cancels).toBe(0)
      expect(app.frame()).not.toContain('Enter again to stop')
    } finally {
      app.instance.unmount()
    }
  })

  it('take-over still fires after a long pause, as long as the turn runs', async () => {
    const app = harness('running')
    try {
      await untilFrame(app, 'FOLLOW-UP')
      app.stdin.write('继续')
      await settle()
      app.stdin.write('\r')
      await untilCount(app, 'submits', 1)
      await untilFrame(app, 'Enter again or Esc to take over')
      // The armed hint expires, but the take-over arm does not.
      await settle(1_300)
      expect(app.frame()).toContain('Enter again or Esc to take over')
      app.stdin.write('\r')
      await untilCount(app, 'takeOvers', 1)
      expect(app.calls.cancels).toBe(0)
    } finally {
      app.instance.unmount()
    }
  })

  it('Enter with a draft queues a follow-up instead of stopping', async () => {
    const app = harness('running')
    try {
      await untilFrame(app, 'FOLLOW-UP')
      app.stdin.write('继续')
      await settle()
      app.stdin.write('\r')
      await untilCount(app, 'submits', 1)
      expect(app.calls.cancels).toBe(0)
    } finally {
      app.instance.unmount()
    }
  })

  it('Esc closes the command palette without stopping the running turn', { timeout: 8_000 }, async () => {
    const app = harness('running')
    try {
      await untilFrame(app, 'FOLLOW-UP')
      app.stdin.write('/')
      await untilFrame(app, 'COMMAND SONAR')
      app.stdin.write('\u001B')
      await untilFrame(app, 'FOLLOW-UP')
      await settle()
      expect(app.calls.cancels).toBe(0)
      expect(app.calls.takeOvers).toBe(0)
      expect(app.frame()).not.toContain('COMMAND SONAR')
    } finally {
      app.instance.unmount()
    }
  })

  it('Esc stays inert when nothing is running', async () => {
    const app = harness('idle')
    try {
      await untilFrame(app, 'PROMPT')
      app.stdin.write('\u001B')
      await settle()
      expect(app.calls.cancels).toBe(0)
    } finally {
      app.instance.unmount()
    }
  })
})
