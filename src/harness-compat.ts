import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { EventLike } from './transcript-fold.js'

/**
 * The v0.1.6 Session log is private. Keep the one deprecated snapshot read in
 * this boundary until Harness publishes an asynchronous full-log reader for
 * attached consumers.
 */
export function sessionEvents(session: Session): readonly SessionEvent[] {
  const compatible = session as Session & {
    readonly events?: readonly SessionEvent[]
    snapshotEvents?: () => readonly SessionEvent[]
  }
  if (typeof compatible.snapshotEvents === 'function') return compatible.snapshotEvents()
  // Structural test doubles and the pre-v3 host expose the same immutable log
  // as `.events`; retaining this read makes the upgrade fail soft during rollout.
  return compatible.events ?? []
}

/** Normalize the v3 branded surface range into the TUI's serializable fold shape. */
export function eventLike(event: SessionEvent): EventLike {
  const value = event as SessionEvent & {
    readonly surfaceOp?: 'append' | {
      readonly op: 'replace'
      readonly startSeq?: number
      readonly endSeq?: number
      /** Pre-v3 rollout shape. */
      readonly start?: number
      readonly end?: number
    }
    readonly sourceEventSeqs?: readonly number[]
  }
  const surfaceOp = value.surfaceOp
  return {
    type: value.type,
    seq: Number(value.seq),
    time: value.time,
    data: value.data,
    ...(value.ignorable === true ? { ignorable: true as const } : {}),
    ...(value.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: value.sourceEventSeqs.map(Number) }),
    ...(surfaceOp === undefined
      ? {}
      : surfaceOp === 'append'
        ? { surfaceOp }
        : {
            surfaceOp: {
              op: 'replace' as const,
              start: Number(surfaceOp.startSeq ?? surfaceOp.start),
              end: Number(surfaceOp.endSeq ?? surfaceOp.end),
            },
          }),
  }
}

export function eventLikes(events: readonly SessionEvent[]): EventLike[] {
  return events.map(eventLike)
}

export function sessionEventLikes(session: Session): EventLike[] {
  return eventLikes(sessionEvents(session))
}
