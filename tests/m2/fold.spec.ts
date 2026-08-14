import { describe, expect, it } from 'vitest'
import {
  EMPTY_TRANSCRIPT, KNOWN_EVENT_TYPES, foldEvents, foldTranscript, type EventLike, type MessageNode, type ToolNode,
} from '../../src/transcript-fold.js'

function event(seq: number, type: string, data: unknown, extra: Partial<EventLike> = {}): EventLike {
  return { seq, type, time: 1_700_000_000_000 + seq, data, ...extra }
}

describe('M2 deterministic transcript fold', () => {
  it('implements all seven stream variants, sparse indexes, reset, and final supersession', () => {
    const events: EventLike[] = [
      event(0, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 2, text: 'provisional' } }),
      event(1, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-start', index: 2, blockType: 'text' } }),
      event(2, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 2, text: '流式' } }),
      event(3, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: '想一想' } }),
      event(4, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'tool-call-delta', index: 4, id: 'call-1', name: 'write', argumentsDelta: '{"path":' } }),
      event(5, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'tool-call-delta', index: 4, id: 'ignored', argumentsDelta: '"a"}' } }),
      event(6, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-end', index: 2, block: { type: 'text', text: '流式完成' } } }),
      event(7, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 2, outputTokens: 3 } } }),
      event(8, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'finish', reason: { kind: 'stop' } } }),
    ]
    const partial = foldEvents(events)
    const node = partial.nodes[0] as MessageNode
    expect(node.streaming).toBe(true)
    expect(node.blocks).toEqual([
      { type: 'reasoning', text: '想一想' },
      { type: 'text', text: '流式完成' },
      { type: 'tool-call', id: 'call-1', name: 'write', arguments: '{"path":"a"}' },
    ])
    expect(node.usage).toEqual({ inputTokens: 2, outputTokens: 3 })

    const final = foldTranscript(partial, event(9, 'assistant/message', {
      turn: 1, step: 1,
      message: { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: '**最终**' }] },
    }, { surfaceOp: 'append', sourceEventSeqs: [0, 1, 2, 3, 4, 5, 6, 7, 8] }))
    expect(final.nodes).toHaveLength(1)
    expect((final.nodes[0] as MessageNode).streaming).toBe(false)
    expect((final.nodes[0] as MessageNode).blocks).toEqual([{ type: 'text', text: '**最终**' }])
    const late = foldTranscript(final, event(10, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'late' } }))
    expect(late.nodes).toEqual(final.nodes)
    expect(late.diagnostics.at(-1)?.type).toBe('assistant/chunk')
  })

  it.each([
    ['absent', undefined],
    ['present-populated', [0]],
  ] as const)('preserves %s assistant source-event provenance while superseding the exact partial', (_label, sourceEventSeqs) => {
    const partial = foldTranscript(EMPTY_TRANSCRIPT, event(0, 'assistant/chunk', {
      turn: 7, step: 2, chunk: { type: 'text-delta', index: 0, text: 'draft' },
    }))
    const final = foldTranscript(partial, event(1, 'assistant/message', {
      turn: 7, step: 2,
      message: { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: 'final' }] },
    }, { surfaceOp: 'append', ...(sourceEventSeqs === undefined ? {} : { sourceEventSeqs }) }))
    expect(final.nodes).toHaveLength(1)
    expect(final.nodes[0]).toMatchObject({ id: 'assistant:7:2', streaming: false })
    if (sourceEventSeqs === undefined) expect(final.nodes[0]).not.toHaveProperty('sourceEventSeqs')
    else expect((final.nodes[0] as MessageNode).sourceEventSeqs).toEqual(sourceEventSeqs)
  })

  it('preserves a present empty source-event set as known-empty provenance', () => {
    const final = foldTranscript(EMPTY_TRANSCRIPT, event(0, 'assistant/message', {
      turn: 7, step: 3,
      message: { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: 'no streamed chunks' }] },
    }, { surfaceOp: 'append', sourceEventSeqs: [] }))
    expect((final.nodes[0] as MessageNode).sourceEventSeqs).toEqual([])
  })

  it('pairs tools, nests Code Mode dispatches, and keeps orphan results visible', () => {
    const state = foldEvents([
      event(0, 'tool/call', { turn: 1, step: 1, callId: 'root', name: 'code', arguments: '{"task":"edit"}' }),
      event(1, 'tool/code-dispatch-start', { rootCallId: 'root', parentCallId: 'root', subCallId: 'child', name: 'write', arguments: { path: '目标.txt' } }),
      event(2, 'tool/code-dispatch', { rootCallId: 'root', parentCallId: 'root', subCallId: 'child', name: 'write', arguments: { path: '目标.txt' }, isError: false, content: [{ type: 'text', text: 'ok' }] }),
      event(3, 'tool/result', { message: { source: { kind: 'tool', callId: 'root' }, content: [{ type: 'tool-result', toolCallId: 'root', content: [{ type: 'text', text: 'done' }] }] } }, { surfaceOp: 'append' }),
      event(4, 'tool/result', { message: { content: [{ type: 'tool-result', toolCallId: 'missing', content: [{ type: 'text', text: 'orphan' }], isError: true }] } }, { surfaceOp: 'append' }),
    ])
    const root = state.nodes[0] as ToolNode
    expect(root.status).toBe('success')
    expect(root.children).toMatchObject([{ callId: 'child', name: 'write', status: 'success' }])
    expect(state.nodes[1]).toMatchObject({ kind: 'tool', name: 'orphan result', status: 'orphan' })
  })

  it('applies inclusive surface replacement and preserves the replacement position', () => {
    const state = foldEvents([
      event(0, 'user/message', { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'old user' }] }, { surfaceOp: 'append' }),
      event(1, 'assistant/message', { turn: 1, step: 1, message: { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: 'old answer' }] } }, { surfaceOp: 'append' }),
      event(2, 'assistant/message', { turn: 2, step: 1, message: { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: 'summary' }] } }, { surfaceOp: { op: 'replace', start: 0, end: 1 }, sourceEventSeqs: [0, 1] }),
    ])
    expect(state.surface).toEqual([{ eventSeq: 2, nodeId: 'assistant:2:1' }])
    expect(state.nodes).toMatchObject([{ kind: 'message', blocks: [{ type: 'text', text: 'summary' }] }])
  })

  it('recognizes all 44 locked event names and renders an unknown event exactly once', () => {
    expect(KNOWN_EVENT_TYPES).toHaveLength(44)
    let state = EMPTY_TRANSCRIPT
    KNOWN_EVENT_TYPES.forEach((type, seq) => { state = foldTranscript(state, event(seq, type, {})) })
    expect(state.nodes.filter(node => node.kind === 'raw')).toEqual([])
    state = foldTranscript(state, event(44, 'future/sea-change', { payload: 'kept' }))
    expect(state.nodes.filter(node => node.kind === 'raw')).toEqual([
      { kind: 'raw', id: 'raw:44', seq: 44, eventType: 'future/sea-change', data: { payload: 'kept' }, required: true },
    ])
    expect(foldTranscript(state, event(44, 'future/sea-change', { payload: 'duplicate' }))).toBe(state)
  })

  it('marks a seq gap for controller resnapshot instead of guessing missing events', () => {
    const state = foldTranscript(EMPTY_TRANSCRIPT, event(2, 'turn/start', { turn: 1 }))
    expect(state.lastSeq).toBe(-1)
    expect(state.gap).toEqual({ expected: 0, received: 2 })
  })
})
