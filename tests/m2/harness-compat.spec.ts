import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { eventLike } from '../../src/harness-compat.js'

describe('Harness event compatibility boundary', () => {
  it('normalizes current and rollout-era replace ranges', () => {
    const base = { type: 'user/message', seq: 3, time: 10, data: {} }
    const current = eventLike({ ...base, surfaceOp: { op: 'replace', startSeq: 1, endSeq: 2 } } as unknown as SessionEvent)
    const legacy = eventLike({ ...base, surfaceOp: { op: 'replace', start: 1, end: 2 } } as unknown as SessionEvent)

    expect(current.surfaceOp).toEqual({ op: 'replace', start: 1, end: 2 })
    expect(legacy.surfaceOp).toEqual({ op: 'replace', start: 1, end: 2 })
  })
})
