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
    expect(state.lines).toEqual([
      { seq: 1, role: 'user', text: '你好' },
      { seq: 2, role: 'assistant', text: 'Hello' },
    ])
  })

  it('treats duplicate and older seq values as no-ops', () => {
    const first = foldTranscript(EMPTY_TRANSCRIPT, event(4, 'user/message', { content: [{ type: 'text', text: 'one' }] }))
    expect(foldTranscript(first, event(4, 'user/message', { content: [{ type: 'text', text: 'duplicate' }] }))).toBe(first)
    expect(foldTranscript(first, event(3, 'user/message', { content: [{ type: 'text', text: 'older' }] }))).toBe(first)
  })

  it('advances across unrelated events without inventing transcript text', () => {
    const state = foldTranscript(EMPTY_TRANSCRIPT, event(7, 'tool/call', { name: 'read' }))
    expect(state).toEqual({ lastSeq: 7, lines: [] })
  })
})
