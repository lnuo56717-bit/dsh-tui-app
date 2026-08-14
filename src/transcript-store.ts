import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { EMPTY_TRANSCRIPT, foldEvents, foldTranscript, type EventLike, type TranscriptState } from './transcript-fold.js'

export class TranscriptStore {
  private state: TranscriptState
  private readonly listeners = new Set<() => void>()
  private notifyQueued = false

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
    queueMicrotask(() => {
      this.notifyQueued = false
      for (const listener of this.listeners) listener()
    })
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
