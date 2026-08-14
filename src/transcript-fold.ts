import type { SessionEvent } from '@deepseek-ai/dsh-session'

export interface TranscriptLine {
  seq: number
  role: 'user' | 'assistant' | 'system'
  text: string
}

export interface TranscriptState {
  lastSeq: number
  lines: readonly TranscriptLine[]
}

export const EMPTY_TRANSCRIPT: TranscriptState = Object.freeze({ lastSeq: -1, lines: Object.freeze([]) })

function textBlocks(content: readonly unknown[]): string {
  return content.flatMap((block) => {
    if (typeof block !== 'object' || block === null) return []
    const candidate = block as { type?: unknown; text?: unknown }
    return candidate.type === 'text' && typeof candidate.text === 'string' ? [candidate.text] : []
  }).join('')
}

/** M1 fold: durable user/assistant messages only. Streaming/tool trees remain M2 work. */
export function foldTranscript(state: TranscriptState, event: SessionEvent): TranscriptState {
  if (event.seq <= state.lastSeq) return state
  let next = state.lines
  if (event.type === 'user/message') {
    next = [...state.lines, { seq: event.seq, role: 'user', text: textBlocks(event.data.content) }]
  } else if (event.type === 'assistant/message') {
    next = [...state.lines, { seq: event.seq, role: 'assistant', text: textBlocks(event.data.message.content) }]
  }
  return { lastSeq: event.seq, lines: next }
}

export function foldEvents(events: readonly SessionEvent[]): TranscriptState {
  return events.reduce(foldTranscript, EMPTY_TRANSCRIPT)
}
