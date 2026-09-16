import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { attachTranscript } from '../../src/transcript-store.js'
import { TranscriptStore } from '../../src/transcript-store.js'

describe('M2 live snapshot/subscription handoff', () => {
  it('folds the immutable snapshot and subsequent scoped events exactly once', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('session-m2-store'))
    session.append('user/message', {
      id: 'before', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'snapshot' }],
    }, { surfaceOp: 'append' })
    const attached = attachTranscript(ctx, session)
    session.append('assistant/message', {
      turn: 1, step: 1,
      message: { id: 'after', role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test' }, content: [{ type: 'text', text: 'live' }] },
      stream: [],
    }, { surfaceOp: 'append' })
    await Promise.resolve()
    expect(attached.store.getSnapshot().nodes).toMatchObject([
      { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'snapshot' }] },
      { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: 'live' }] },
    ])
    expect(attached.store.getSnapshot().lastSeq).toBe(1)
    attached.dispose()
    await ctx.fiber.dispose()
  })

  it('overlays v3 live frames without consuming a durable seq and settles from the embedded stream', () => {
    const store = new TranscriptStore()
    store.dispatch({ seq: 0, time: 900, type: 'turn/start', data: { turn: 1 } })
    store.dispatch({ seq: 1, time: 950, type: 'step/start', data: { turn: 1, step: 1 } })
    store.dispatchAssistantStream({ type: 'start', attemptId: 'attempt-1', revision: 1, turn: 1, step: 1 } as never)
    store.dispatchAssistantStream({
      type: 'chunk', attemptId: 'attempt-1', revision: 1, index: 0, time: 1_000,
      chunk: { type: 'text-delta', index: 0, text: '真' },
    } as never)
    store.dispatchAssistantStream({
      type: 'chunk', attemptId: 'attempt-1', revision: 1, index: 1, time: 1_100,
      chunk: { type: 'text-delta', index: 0, text: '实' },
    } as never)

    const live = store.getSnapshot()
    expect(live.lastSeq).toBe(1)
    expect(live.nodes.at(-1)).toMatchObject({ streaming: true, blocks: [{ type: 'text', text: '真实' }] })
    expect(live.throughput).toMatchObject({ tokenCount: 2, firstTokenAt: 1_000, lastTokenAt: 1_100 })

    store.dispatch({
      seq: 2, time: 1_200, type: 'assistant/message', surfaceOp: 'append',
      data: {
        turn: 1, step: 1,
        message: { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: '真实' }] },
        stream: [{ type: 'text-chunks', time0: 1_000, index: 0, dt: [100], texts: ['真', '实'] }],
        usage: { inputTokens: 4, outputTokens: 3 },
      },
    })
    const settled = store.getSnapshot()
    expect(settled.lastSeq).toBe(2)
    expect(settled.nodes.at(-1)).toMatchObject({ streaming: false, blocks: [{ type: 'text', text: '真实' }] })
    expect(settled.throughput).toMatchObject({ tokenCount: 3, exact: true, firstTokenAt: 1_000, finishedAt: 1_200 })
  })
})
