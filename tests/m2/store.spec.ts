import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { attachTranscript } from '../../src/transcript-store.js'

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
})
