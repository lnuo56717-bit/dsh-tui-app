import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { eventLike, eventLikes, sessionEvents } from './harness-compat.js'
import { EMPTY_TRANSCRIPT, foldEvents, foldLiveAssistantChunk, foldTranscript, type EventLike, type TranscriptState } from './transcript-fold.js'

/**
 * Events stream in bursts (tokens, tool chunks) on separate macrotasks, so a
 * microtask coalescer still renders once per event. Budgeting notifications
 * keeps the frame rate capped during bursts — the TUI's keystroke handling
 * stays responsive while the agent's own activity floods the event log.
 */
const NOTIFY_INTERVAL_MS = 40

export class TranscriptStore {
  private state: TranscriptState
  private durable: TranscriptState
  private live: { readonly attemptId: string; readonly revision: number; readonly turn: number; readonly step: number; nextIndex: number } | undefined
  private readonly listeners = new Set<() => void>()
  private notifyQueued = false
  private notifyTimer: ReturnType<typeof setTimeout> | undefined
  private lastNotifyAt = 0

  constructor(initial: TranscriptState = EMPTY_TRANSCRIPT) {
    this.state = initial
    this.durable = initial
  }

  readonly getSnapshot = (): TranscriptState => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  replace(state: TranscriptState): void {
    if (state === this.state) return
    this.durable = state
    this.live = undefined
    this.state = state
    this.notify()
  }

  dispatch(event: EventLike): TranscriptState {
    const next = foldTranscript(this.durable, event)
    this.durable = next
    const data = typeof event.data === 'object' && event.data !== null ? event.data as Record<string, unknown> : {}
    const settlesLive = this.live !== undefined
      && (event.type === 'assistant/message' || event.type === 'assistant/attempt')
      && Number(data.turn) === this.live.turn
      && Number(data.step) === this.live.step
    if (settlesLive) this.live = undefined
    this.setState(next)
    return next
  }

  dispatchAssistantStream(frame: AssistantStreamFrame): void {
    if (frame.type === 'start') {
      this.live = {
        attemptId: String(frame.attemptId), revision: frame.revision,
        turn: frame.turn, step: frame.step, nextIndex: 0,
      }
      this.setState(this.durable)
      return
    }
    const live = this.live
    if (live === undefined || live.attemptId !== String(frame.attemptId) || live.revision !== frame.revision) return
    if (frame.type === 'end') {
      this.live = undefined
      this.setState(this.durable)
      return
    }
    if (frame.index !== live.nextIndex) {
      this.live = undefined
      this.setState(this.durable)
      return
    }
    live.nextIndex += 1
    this.setState(foldLiveAssistantChunk(this.state, {
      turn: live.turn, step: live.step, time: frame.time, chunk: frame.chunk,
    }))
  }

  private setState(state: TranscriptState): void {
    if (state === this.state) return
    this.state = state
    this.notify()
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
export function attachTranscript(ctx: Context, session: Session, store = new TranscriptStore(), agent?: Agent): AttachedTranscript {
  let initialized = false
  const buffered: SessionEvent[] = []

  const dispose = ctx.on('session/event', (source, event) => {
    if (source !== session) return
    if (!initialized) {
      buffered.push(event)
      return
    }
    const next = store.dispatch(eventLike(event))
    if (next.gap !== undefined) store.replace(foldEvents(eventLikes(sessionEvents(session))))
  })

  const disposeStream = agent?.ctx.on('agent/assistant-stream', ({ agent: source, frame }) => {
    if (source === agent) store.dispatchAssistantStream(frame)
  })

  const snapshot = sessionEvents(session)
  const cut = snapshot.length
  store.replace(foldEvents(eventLikes(snapshot)))
  for (const event of buffered.sort((left, right) => left.seq - right.seq)) {
    if (event.seq < cut) continue
    const next = store.dispatch(eventLike(event))
    if (next.gap !== undefined) {
      store.replace(foldEvents(eventLikes(sessionEvents(session))))
      break
    }
  }
  initialized = true
  return { store, dispose: () => { disposeStream?.(); dispose() } }
}
