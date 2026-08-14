import { describe, expect, it } from 'vitest'
import { attachProjections } from '../../src/projection-store.js'

describe('M4 projection snapshots', () => {
  it('subscribes before the first whole cut and coalesces same-session changes', async () => {
    const session = { id: 'active' }
    const other = { id: 'other' }
    const order: string[] = []
    const published: unknown[] = []
    let listener: ((changed: typeof session, key: string, value: unknown, seq: number) => void) | undefined
    let reads = 0
    const attached = attachProjections({
      onChanged(next) { order.push('subscribe'); listener = next; return () => { order.push('dispose') } },
      snapshot() { reads += 1; order.push('snapshot'); return { asOfSeq: reads - 1, values: { title: `cut-${reads}` } } },
    }, session, snapshot => published.push(snapshot))

    expect(order.slice(0, 2)).toEqual(['subscribe', 'snapshot'])
    listener!(session, 'title', 'one', 1)
    listener!(session, 'todos', [], 1)
    listener!(other, 'title', 'ignored', 1)
    await Promise.resolve()
    expect(reads).toBe(2)
    expect(published).toHaveLength(2)
    expect(published[1]).toEqual({ asOfSeq: 1, values: { title: 'cut-2' } })

    attached.dispose()
    listener!(session, 'title', 'late', 2)
    await Promise.resolve()
    expect(reads).toBe(2)
    expect(order.at(-1)).toBe('dispose')
  })
})
