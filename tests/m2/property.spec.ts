import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { EMPTY_TRANSCRIPT, foldEvents, foldTranscript, type EventLike } from '../../src/transcript-fold.js'
import { TranscriptStore } from '../../src/transcript-store.js'

type Operation = { kind: 'user' | 'text' | 'unknown'; text: string }

function compile(operations: readonly Operation[]): EventLike[] {
  return operations.map((operation, seq): EventLike => {
    if (operation.kind === 'user') return { seq, type: 'user/message', data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: operation.text }] }, surfaceOp: 'append' }
    if (operation.kind === 'text') return { seq, type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: operation.text } } }
    return { seq, type: 'future/property-event', data: { text: operation.text }, ignorable: true }
  })
}

describe('AC-8 property invariants', () => {
  it('full replay equals arbitrary incremental partitions and duplicate seq is identity', () => {
    fc.assert(fc.property(
      fc.array(fc.record({
        kind: fc.constantFrom<Operation['kind']>('user', 'text', 'unknown'),
        text: fc.string({ unit: fc.constantFrom('a', '中', '，', '🐋', '\n', ' ') }),
      }), { maxLength: 80 }),
      fc.array(fc.nat({ max: 10 }), { maxLength: 20 }),
      (operations, cuts) => {
        const events = compile(operations)
        const replay = foldEvents(events)
        const store = new TranscriptStore()
        let cursor = 0
        for (const size of cuts) {
          const end = Math.min(events.length, cursor + size)
          for (; cursor < end; cursor += 1) store.dispatch(events[cursor]!)
        }
        for (; cursor < events.length; cursor += 1) store.dispatch(events[cursor]!)
        expect(store.getSnapshot()).toEqual(replay)
        if (events.length > 0) expect(foldTranscript(replay, events.at(-1)!)).toBe(replay)
      },
    ), { numRuns: 250, seed: 0xD55A })
  })

  it('empty incremental state is the replay identity', () => {
    expect(foldEvents([])).toBe(EMPTY_TRANSCRIPT)
  })

  it('folds a 5k-event stream without losing order or content', () => {
    const events: EventLike[] = Array.from({ length: 5_000 }, (_, seq) => ({
      seq,
      type: 'assistant/chunk',
      data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: String(seq % 10) } },
    }))
    const state = foldEvents(events)
    expect(state.lastSeq).toBe(4_999)
    expect(state.nodes).toHaveLength(1)
    expect((state.nodes[0] as { blocks: readonly { text?: string }[] }).blocks[0]?.text).toHaveLength(5_000)
  })
})
