import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { EMPTY_TRANSCRIPT, foldEvents, foldTranscript, type EventLike, type TranscriptState } from './transcript-fold.js'

/**
 * Events stream in bursts (tokens, tool chunks) on separate macrotasks, so a
 * microtask coalescer still renders once per event. Budgeting notifications
 * keeps the frame rate capped during bursts — the TUI's keystroke handling
 * stays responsive while the agent's own activity floods the event log.
 */
const NOTIFY_INTERVAL_MS = 40

export class TranscriptStore {
  private state: TranscriptState
  private readonly listeners = new Set<() => void>()
  private notifyQueued = false
  private notifyTimer: ReturnType<typeof setTimeout> | undefined
  private lastNotifyAt = 0

  constructor(initial: TranscriptState = EMPTY_TRANSCRIPT) {
    this.state = initial
  }

  readonly getSnapshot = (): TranscriptState => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  replace(state: TranscriptState): void {
    if (state === this.state) return
    this.state = state
    this.notify()
  }

  dispatch(event: EventLike): TranscriptState {
    const next = foldTranscript(this.state, event)
    this.replace(next)
    return next
  }

  private notify(): void {
    if (this.notifyQueued) return
    this.notifyQueued = true
    const elapsed = Date.now() - this.lastNotifyAt
    const delay = Math.max(0, NOTIFY_INTERVAL_MS - elapsed)
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = undefined
      this.notifyQueued = false
      this.lastNotifyAt = Date.now()
      for (const listener of this.listeners) listener()
    }, delay)
  }
}

export interface AttachedTranscript {
  readonly store: TranscriptStore
  dispose(): void
}

/** Listener-first snapshot handoff from EVENT-SPEC section 6. */
export function attachTranscript(ctx: Context, session: Session, store = new TranscriptStore()): AttachedTranscript {
  let initialized = false
  const buffered: SessionEvent[] = []

  const dispose = ctx.on('session/event', (source, event) => {
    if (source !== session) return
    if (!initialized) {
      buffered.push(event)
      return
    }
    const next = store.dispatch(event)
    if (next.gap !== undefined) store.replace(foldEvents(session.events))
  })

  const snapshot = session.events
  const cut = snapshot.length
  store.replace(foldEvents(snapshot))
  for (const event of buffered.sort((left, right) => left.seq - right.seq)) {
    if (event.seq < cut) continue
    const next = store.dispatch(event)
    if (next.gap !== undefined) {
      store.replace(foldEvents(session.events))
      break
    }
  }
  initialized = true
  return { store, dispose: () => { dispose() } }
}
