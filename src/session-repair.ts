import { decodeStorageRecord, interruptedTurnClosers, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { EventLike } from './transcript-fold.js'

/** Decode a backend raw artifact into logical events, expanding packed chunk rows. */
export function parseRawSessionEvents(content: string): EventLike[] {
  const events: EventLike[] = []
  for (const line of content.split('\n')) {
    if (line.trim() === '') continue
    let record: unknown
    try { record = JSON.parse(line) } catch { continue }
    if (typeof record !== 'object' || record === null) continue
    const item = record as { type?: unknown }
    if (item.type === 'text-chunks' || item.type === 'reasoning-chunks' || item.type === 'tool-call-chunks') {
      try { events.push(...decodeStorageRecord(record as never) as unknown as EventLike[]) } catch { continue }
    } else if (typeof item.type === 'string' && typeof (record as { seq?: unknown }).seq === 'number') {
      events.push(record as EventLike)
    }
  }
  return events
}

/**
 * Keep the first event for each seq and the longest prefix contiguous from 0.
 * A duplicate or hole in the committed region is how jsonl resume rejects;
 * the prefix is still a valid seed after crash closers are appended.
 */
export function contiguousEventPrefix(events: readonly EventLike[]): SessionEvent[] {
  const first = new Map<number, EventLike>()
  for (const event of events) {
    if (!Number.isInteger(event.seq) || event.seq < 0 || first.has(event.seq)) continue
    first.set(event.seq, event)
  }
  const prefix: SessionEvent[] = []
  for (let seq = 0; first.has(seq); seq += 1) prefix.push(first.get(seq) as SessionEvent)
  return prefix
}

/** Balanced seed: contiguous prefix plus any synthetic interrupted-turn closers. */
export function repairedSeed(events: readonly EventLike[]): SessionEvent[] {
  const prefix = contiguousEventPrefix(events)
  if (prefix.length === 0) return []
  return [...prefix, ...interruptedTurnClosers(prefix)]
}
