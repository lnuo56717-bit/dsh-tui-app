import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { EMPTY_TRANSCRIPT, foldEvents, foldTranscript } from '../../src/transcript-fold.js'

function event(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, type, data } as SessionEvent
}

describe('M1 transcript fold', () => {
  it('folds committed user and assistant text in event order', () => {
    const state = foldEvents([
      event(0, 'turn/start', { turn: 1 }),
      event(1, 'user/message', { content: [{ type: 'text', text: '你好' }], role: 'user' }),
      event(2, 'assistant/message', { message: { content: [{ type: 'text', text: 'Hello' }, { type: 'image' }] } }),
    ])
    expect(state.lastSeq).toBe(2)
    expect(state.nodes[0]).toMatchObject({ kind: 'message', seq: 1, role: 'user', blocks: [{ type: 'text', text: '你好' }] })
    expect(state.nodes[1]).toMatchObject({ kind: 'message', seq: 2, role: 'assistant' })
    expect((state.nodes[1] as { blocks: unknown[] }).blocks[0]).toEqual({ type: 'text', text: 'Hello' })
  })

  it('treats duplicate and older seq values as no-ops', () => {
    const first = foldTranscript(EMPTY_TRANSCRIPT, event(0, 'user/message', { content: [{ type: 'text', text: 'one' }] }))
    expect(foldTranscript(first, event(0, 'user/message', { content: [{ type: 'text', text: 'duplicate' }] }))).toBe(first)
    expect(foldTranscript(first, event(-1, 'user/message', { content: [{ type: 'text', text: 'older' }] }))).toBe(first)
  })

  it('advances across unrelated events without inventing transcript text', () => {
    const state = foldTranscript(EMPTY_TRANSCRIPT, event(0, 'turn/start', { turn: 1 }))
    expect(state.lastSeq).toBe(0)
    expect(state.nodes).toEqual([])
  })
})
