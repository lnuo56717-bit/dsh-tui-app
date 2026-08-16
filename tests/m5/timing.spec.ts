import { describe, expect, it } from 'vitest'
import { EMPTY_TRANSCRIPT, foldEvents, foldTranscript, NO_TIMING, type EventLike } from '../../src/transcript-fold.js'
import { displayWidth } from '../../src/ui/display-width.js'
import { elapsedFacts, elapsedLabel, formatElapsed, settledTiming, SPIN_FRAMES, SPIN_TICK_MS, THINKING_REST_GLYPH, thinkingFrame } from '../../src/ui/timing.js'

const T0 = 1_700_000_000_000

function turn(seq: number, type: 'turn/start' | 'turn/end', turnNumber: number, time?: number, reason = 'completed'): EventLike {
  return {
    seq,
    type,
    ...(time === undefined ? {} : { time }),
    data: type === 'turn/start' ? { turn: turnNumber } : { turn: turnNumber, reason: { kind: reason } },
  }
}

describe('task timing measured from the log', () => {
  it('reads spans from the turn brackets the session already writes', () => {
    const state = foldEvents([
      turn(0, 'turn/start', 1, T0),
      { seq: 1, time: T0 + 1_000, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] } },
      turn(2, 'turn/end', 1, T0 + 5_000),
      turn(3, 'turn/start', 2, T0 + 20_000),
      turn(4, 'turn/end', 2, T0 + 32_500, 'aborted'),
    ])
    expect(state.timing).toEqual({ measured: 2, workMs: 17_500, lastMs: 12_500, lastReason: 'aborted' })
    expect(elapsedLabel(state.timing, T0 + 40_000)).toBe('◷ last 12s · total 17s')
  })

  it('keeps the open turn running until its own end event closes it', () => {
    const open = foldEvents([turn(0, 'turn/start', 1, T0), turn(1, 'turn/end', 1, T0 + 4_000), turn(2, 'turn/start', 2, T0 + 10_000)])
    expect(open.timing.open).toEqual({ turn: 2, startedAt: T0 + 10_000 })
    // The finished turn is still the last measured fact while the next one runs.
    expect(open.timing.lastMs).toBe(4_000)
    expect(elapsedFacts(open.timing, T0 + 13_000)).toEqual({ runningMs: 3_000, lastMs: 4_000, totalMs: 7_000, measured: 1 })
    expect(elapsedLabel(open.timing, T0 + 13_000)).toBe('◷ 3s · total 7s')
    expect(elapsedLabel(open.timing, T0 + 13_000, false)).toBe('◷ 3s')
  })

  it('measures nothing from a turn the log did not timestamp', () => {
    const untimed = foldEvents([turn(0, 'turn/start', 1), turn(1, 'turn/end', 1)])
    expect(untimed.timing).toEqual(NO_TIMING)
    expect(elapsedLabel(untimed.timing, T0)).toBeUndefined()

    const halfTimed = foldEvents([turn(0, 'turn/start', 1, T0), turn(1, 'turn/end', 1)])
    expect(halfTimed.timing).toEqual(NO_TIMING)
  })

  it('ignores an end that does not match the open turn and never reports a negative span', () => {
    const mismatched = foldEvents([turn(0, 'turn/start', 1, T0), turn(1, 'turn/end', 7, T0 + 9_000)])
    expect(mismatched.timing).toEqual(NO_TIMING)
    expect(foldEvents([turn(0, 'turn/end', 1, T0)]).timing).toEqual(NO_TIMING)
    // A repaired closer reuses an earlier timestamp; the floor is zero, not a negative span.
    const skewed = foldEvents([turn(0, 'turn/start', 1, T0 + 5_000), turn(1, 'turn/end', 1, T0)])
    expect(skewed.timing).toEqual({ measured: 1, workMs: 0, lastMs: 0, lastReason: 'completed' })
  })

  it('restates one conversation total after a resumed log replays its whole history', () => {
    const log = [turn(0, 'turn/start', 1, T0), turn(1, 'turn/end', 1, T0 + 6_000), turn(2, 'turn/start', 2, T0 + 60_000), turn(3, 'turn/end', 2, T0 + 90_000)]
    const incremental = log.reduce(foldTranscript, EMPTY_TRANSCRIPT)
    expect(foldEvents(log).timing).toEqual(incremental.timing)
    expect(elapsedLabel(foldEvents(log).timing, T0 + 120_000)).toBe('◷ last 30s · total 36s')
  })

  it('parks the chip on settled facts when a turn stays open with no live task', () => {
    const stuck = foldEvents([turn(0, 'turn/start', 1, T0), turn(1, 'turn/end', 1, T0 + 3_000), turn(2, 'turn/start', 2, T0 + 4_000)])
    expect(elapsedLabel(settledTiming(stuck.timing), T0 + 86_400_000)).toBe('◷ 3s')
    expect(settledTiming(NO_TIMING)).toEqual(NO_TIMING)
  })

  it('states a single measured turn as one number, because its last turn is its total', () => {
    const one = foldEvents([turn(0, 'turn/start', 1, T0), turn(1, 'turn/end', 1, T0 + 12_000)])
    expect(elapsedLabel(one.timing, T0 + 99_000)).toBe('◷ 12s')
    expect(elapsedLabel(one.timing, T0 + 99_000, false)).toBe('◷ 12s')
  })

  it('counts up in whole seconds, then minutes, then hours', () => {
    expect(formatElapsed(0)).toBe('0s')
    expect(formatElapsed(-5)).toBe('0s')
    expect(formatElapsed(999)).toBe('0s')
    expect(formatElapsed(1_000)).toBe('1s')
    expect(formatElapsed(59_999)).toBe('59s')
    expect(formatElapsed(60_000)).toBe('1m')
    expect(formatElapsed(64_400)).toBe('1m4s')
    expect(formatElapsed(3_599_000)).toBe('59m59s')
    expect(formatElapsed(3_600_000)).toBe('1h')
    expect(formatElapsed(3_900_000)).toBe('1h5m')
    expect(formatElapsed(90_000_000)).toBe('25h')
  })

  it('shows the running task alone until a second turn gives a total to compare', () => {
    const first = foldEvents([turn(0, 'turn/start', 1, T0)])
    expect(elapsedLabel(first.timing, T0 + 8_400)).toBe('◷ 8s')
    expect(elapsedLabel(NO_TIMING, T0)).toBeUndefined()
  })
})

describe('the live thinking spinner', () => {
  it('cycles Grok\'s width-1 circling-dot frames and is deterministic', () => {
    expect(SPIN_FRAMES.join('')).toBe('⠁⠁⠉⠙⠚⠒⠂⠂⠒⠲⠴⠤⠄⠄⠤⠠⠠⠤⠦⠖⠒⠐⠐⠒⠓⠋⠉⠈⠈')
    expect(SPIN_FRAMES).toHaveLength(29)
    expect(thinkingFrame(0)).toBe('⠁')
    expect(thinkingFrame(SPIN_TICK_MS - 1)).toBe('⠁')
    expect(thinkingFrame(SPIN_TICK_MS)).toBe('⠁')
    expect(thinkingFrame(SPIN_TICK_MS * 2)).toBe('⠉')
    expect(thinkingFrame(SPIN_TICK_MS * 29)).toBe('⠁')
    expect(thinkingFrame(SPIN_TICK_MS)).toBe(thinkingFrame(SPIN_TICK_MS))
    expect(thinkingFrame(-50)).toBe('⠁')
    expect(displayWidth(THINKING_REST_GLYPH)).toBe(1)
    for (const glyph of SPIN_FRAMES) expect(displayWidth(glyph)).toBe(1)
  })
})
