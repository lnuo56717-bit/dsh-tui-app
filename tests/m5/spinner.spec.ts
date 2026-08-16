import { describe, expect, it } from 'vitest'
import { foldEvents, type EventLike } from '../../src/transcript-fold.js'
import { transcriptRows } from '../../src/ui/transcript-rows.js'

function event(seq: number, type: string, data: unknown, extra: Partial<EventLike> = {}): EventLike {
  return { seq, type, time: 1_700_000_000_000 + seq, data, ...extra }
}

function text(row: ReturnType<typeof transcriptRows>[number]): string {
  return row.segments.map(part => part.text).join('')
}

function rows(state: ReturnType<typeof foldEvents>, glyph: string) {
  return transcriptRows(state, { width: 60, compact: false, expandedBlocks: new Set(), thinkingGlyph: glyph })
}

describe('live spinner paints only running rows', () => {
  const state = foldEvents([
    event(0, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: '查一下' }] }, { surfaceOp: 'append' }),
    event(1, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: '先读文件' } }),
    event(2, 'tool/call', { callId: 'read-1', name: 'read_file', arguments: '{"path":"a.ts"}' }),
    event(3, 'assistant/message', {
      turn: 0, step: 1,
      message: { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: '上一条已经说完。' }] },
    }, { surfaceOp: 'append' }),
  ])

  it('puts the shared frame on the live thought, running tool, and streaming label', () => {
    const lines = rows(state, '◑').map(text)
    expect(lines.some(line => line.includes('◑ Thinking'))).toBe(true)
    expect(lines.some(line => line.includes('◑') && line.includes('read_file'))).toBe(true)
    expect(lines.some(line => line.includes('◑ streaming'))).toBe(true)
    expect(lines.some(line => line.includes('◇ Thought'))).toBe(false)
  })

  it('leaves settled markers alone when the frame advances', () => {
    const first = rows(state, '◐')
    const next = rows(state, '◓')
    const settled = (list: typeof first) => list.filter(row => {
      const line = text(row)
      return line.includes('YOU') || line.includes('上一条已经说完')
    })
    const live = (list: typeof first) => list.filter(row => {
      const line = text(row)
      return line.includes('Thinking') || line.includes('read_file') || line.includes('streaming')
    })

    const settledFirst = settled(first)
    const settledNext = settled(next)
    expect(settledFirst.length).toBeGreaterThan(0)
    expect(settledNext.map(text)).toEqual(settledFirst.map(text))
    expect(settledNext.every((row, index) => row === settledFirst[index])).toBe(true)

    expect(live(first).some(row => text(row).includes('◐'))).toBe(true)
    expect(live(next).some(row => text(row).includes('◓'))).toBe(true)
    expect(live(first).every((row, index) => row !== live(next)[index])).toBe(true)
  })

  it('settles a finished thought on the static mark, not the spin frame', () => {
    const closed = foldEvents([
      event(0, 'assistant/message', {
        turn: 1, step: 1,
        message: { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'reasoning', text: '已经形成判断' }] },
      }, { surfaceOp: 'append' }),
    ])
    const lines = rows(closed, '◑').map(text)
    expect(lines.some(line => line.includes('◇ Thought · 已经形成判断'))).toBe(true)
    expect(lines.some(line => line.includes('◑'))).toBe(false)
  })
})
