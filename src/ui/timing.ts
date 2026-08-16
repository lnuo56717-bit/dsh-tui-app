import type { TurnTiming } from '../transcript-fold.js'

/** Marks the elapsed-time chip in the chrome; width-1 like the rest of the geometry set. */
export const TIMER_GLYPH = '◷'

/** Idle / settled thinking mark. Same width as every spin frame. */
export const THINKING_REST_GLYPH = '◌'

/**
 * Grok Build's circling-dot frames: a one-cell braille comet that travels
 * around the glyph. Each frame is one display cell so a tick cannot reflow
 * a row or shift the caret.
 */
export const SPIN_FRAMES = [...'⠁⠁⠉⠙⠚⠒⠂⠂⠒⠲⠴⠤⠄⠄⠤⠠⠠⠤⠦⠖⠒⠐⠐⠒⠓⠋⠉⠈⠈'] as const

/** How often the live spinner advances. Matches Grok's cadence; the elapsed chip still floors to seconds. */
export const SPIN_TICK_MS = 80

/**
 * The spinner frame for `now`. Derived from the clock, not from view state, so
 * a given timestamp always paints the same glyph.
 */
export function thinkingFrame(now: number): string {
  const index = Math.floor(Math.max(0, now) / SPIN_TICK_MS) % SPIN_FRAMES.length
  return SPIN_FRAMES[index]!
}

/**
 * Stopwatch reading of a span: whole seconds, then minutes, then hours. Floored
 * rather than rounded, so a live counter never reads ahead of the clock.
 */
export function formatElapsed(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1_000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes}m` : `${minutes}m${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h${minutes % 60}m`
}

export interface ElapsedFacts {
  /** How long the open turn has been running; absent when no turn is live. */
  readonly runningMs?: number
  /** Span of the last measured turn. */
  readonly lastMs?: number
  /** Task time across the conversation, including the turn still running. */
  readonly totalMs: number
  /** Turns whose span was measured from the log. */
  readonly measured: number
}

/** The timing as it reads with no live turn; a parked open turn measures nothing. */
export function settledTiming(timing: TurnTiming): TurnTiming {
  const { open, ...settled } = timing
  return settled
}

export function elapsedFacts(timing: TurnTiming, now: number): ElapsedFacts {
  const runningMs = timing.open === undefined ? undefined : Math.max(0, now - timing.open.startedAt)
  return {
    ...(runningMs === undefined ? {} : { runningMs }),
    ...(timing.lastMs === undefined ? {} : { lastMs: timing.lastMs }),
    totalMs: timing.workMs + (runningMs ?? 0),
    measured: timing.measured,
  }
}

/**
 * The chrome's timing chip: the running task's elapsed time while a turn is
 * open, and the conversation's task time once it finishes. A conversation with
 * one measured turn states a single number — its last turn is its total.
 * `detail` is the wide-terminal budget; a narrow header keeps the headline fact.
 */
export function elapsedLabel(timing: TurnTiming, now: number, detail = true): string | undefined {
  const facts = elapsedFacts(timing, now)
  if (facts.runningMs !== undefined) {
    return facts.measured === 0 || !detail
      ? `${TIMER_GLYPH} ${formatElapsed(facts.runningMs)}`
      : `${TIMER_GLYPH} ${formatElapsed(facts.runningMs)} · total ${formatElapsed(facts.totalMs)}`
  }
  if (facts.lastMs === undefined) return undefined
  if (facts.measured === 1) return `${TIMER_GLYPH} ${formatElapsed(facts.lastMs)}`
  return detail
    ? `${TIMER_GLYPH} last ${formatElapsed(facts.lastMs)} · total ${formatElapsed(facts.totalMs)}`
    : `${TIMER_GLYPH} total ${formatElapsed(facts.totalMs)}`
}
