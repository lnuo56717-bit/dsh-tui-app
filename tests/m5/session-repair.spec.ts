import { describe, expect, it } from 'vitest'
import { contiguousEventPrefix, parseRawSessionEvents, repairedSeed } from '../../src/session-repair.js'

describe('repair a stored log with a committed seq gap', () => {
  it('keeps the first event per seq and the prefix contiguous from 0', () => {
    const events = [
      { seq: 0, type: 'session/created', data: {} },
      { seq: 1, type: 'user/message', data: { source: { kind: 'user' } } },
      { seq: 1, type: 'user/message', data: { source: { kind: 'duplicate' } } },
      { seq: 2, type: 'assistant/message', data: {} },
    ]
    const prefix = contiguousEventPrefix(events)
    expect(prefix.map(item => item.seq)).toEqual([0, 1, 2])
    expect(prefix[1]).toMatchObject({ data: { source: { kind: 'user' } } })
  })

  it('stops before a hole so the seed stays valid', () => {
    const prefix = contiguousEventPrefix([
      { seq: 0, type: 'session/created', data: {} },
      { seq: 1, type: 'user/message', data: {} },
      { seq: 3, type: 'assistant/message', data: {} },
    ])
    expect(prefix.map(item => item.seq)).toEqual([0, 1])
  })

  it('expands packed chunk rows from a raw artifact', () => {
    const raw = [
      JSON.stringify({ seq: 0, type: 'session/created', data: {} }),
      JSON.stringify({ type: 'reasoning-chunks', seq0: 1, time0: 3_000, data: { turn: 1, step: 1, index: 0, dt: [5], texts: ['a', 'b'] } }),
    ].join('\n')
    const events = parseRawSessionEvents(raw)
    expect(events.length).toBeGreaterThan(1)
    expect(repairedSeed(events)[0]).toMatchObject({ seq: 0, type: 'session/created' })
  })
})
