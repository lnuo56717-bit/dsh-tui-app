import React from 'react'
import { render } from 'ink'
import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { InteractionController, QuestionAnswerItem, RuntimeSnapshot } from '../../src/interaction-controller.js'
import { TranscriptStore } from '../../src/transcript-store.js'
import { Shell } from '../../src/ui/app.js'

const REQUEST: RuntimeSnapshot['questions'] = {
  id: 7,
  questions: [
    {
      id: 'q1', question: '需要哪些改动？', detail: '可多选', header: '范围', multiSelect: true, approve: undefined,
      options: [{ label: '折叠工具输出' }, { label: '滚动手感' }, { label: '复制能力' }],
    },
    {
      id: 'q2', question: '先做哪个？', detail: undefined, header: '顺序', multiSelect: false, approve: undefined,
      options: [{ label: '滚动' }, { label: '复制' }],
    },
  ],
}

function harness(questions: RuntimeSnapshot['questions']) {
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

  const answered: QuestionAnswerItem[][] = []
  const snapshot: RuntimeSnapshot = {
    sessionId: 'session-questions', cwd: 'C:\\work', model: 'mock/whale', agentStatus: 'running',
    permission: 'workspace-write', projection: undefined, theme: 'abyss', notice: undefined, error: undefined,
    approval: undefined, questions,
  }
  const controller = {
    transcript: new TranscriptStore(),
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    answerQuestions: (answers: QuestionAnswerItem[]) => { answered.push(answers) },
    cancel: () => false,
    notify: () => {},
    commandChoices: () => [],
    permissionNames: () => [],
  } as unknown as InteractionController

  const instance = render(<Shell theme="abyss" color="mono" controller={controller} stdout={stdout} />, {
    stdout, stdin, patchConsole: false, exitOnCtrlC: false,
    // CI runners default Ink to non-interactive, which defers frame writes to
    // unmount; pin interactive so the card assertions see real-time frames.
    interactive: true,
  })
  return {
    stdin,
    instance,
    answered,
    frame(): string {
      return (chunks.filter(chunk => chunk.includes('⌁')).at(-1) ?? '').replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
    },
  }
}

const settle = (ms = 40): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

async function untilFrame(app: ReturnType<typeof harness>, text: string, timeout = 2_000): Promise<void> {
  const deadline = Date.now() + timeout
  for (;;) {
    if (app.frame().includes(text)) return
    if (Date.now() > deadline) throw new Error(`timed out waiting for frame text: ${text}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function press(app: ReturnType<typeof harness>, keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    app.stdin.write(key)
    // Generous gap so slow CI runners finish parsing and rendering one
    // keystroke (Ink buffers escapes ~20ms) before the next one lands.
    await settle(80)
  }
}

const DOWN = '\u001B[B'
const RIGHT = '\u001B[C'
const ENTER = '\r'

describe('QuestionCard answers a real ask_user_question request', () => {
  it('walks options with arrows, multi-selects with Space, takes free text with z, and submits with Enter', async () => {
    const app = harness(REQUEST)
    try {
      await untilFrame(app, '范围 · 1/2')
      expect(app.frame()).toContain('1. [ ] 折叠工具输出')

      // Arrow to the second option, Space it, arrow again, Space the third.
      await press(app, [DOWN, ' ', DOWN, ' '])
      await untilFrame(app, '3. [x] 复制能力')
      expect(app.frame()).toContain('2. [x] 滚动手感')
      // A multi-select question must not submit on Space.
      expect(app.answered).toHaveLength(0)

      // z opens the free-text field; Enter finalizes it without leaving the card stuck.
      await press(app, ['z'])
      await press(app, ['都', '要'])
      await untilFrame(app, 'z. Other: 都要')
      await press(app, [ENTER])
      expect(app.answered).toHaveLength(0)

      // Right moves to the next question; a digit answers it and submits the set.
      await press(app, [RIGHT])
      await untilFrame(app, '顺序 · 2/2')
      await press(app, ['1'])

      expect(app.answered).toHaveLength(1)
      expect(app.answered[0]).toEqual([
        { id: 'q1', selected: ['滚动手感', '复制能力'], custom: '都要' },
        { id: 'q2', selected: ['滚动'] },
      ])
    } finally {
      app.instance.unmount()
    }
  })

  it('parks the card with Esc without fabricating an answer', async () => {
    const app = harness(REQUEST)
    try {
      await settle(120)
      await press(app, ['\u001B'])
      await settle(60)
      expect(app.frame()).toContain('Parked')
      expect(app.answered).toHaveLength(0)
    } finally {
      app.instance.unmount()
    }
  })
})
