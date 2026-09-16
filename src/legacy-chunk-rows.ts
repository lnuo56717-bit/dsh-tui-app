import type { EventLike } from './transcript-fold.js'

/**
 * Read-only decoder for the packed `assistant/chunk` rows written by Session
 * format v2. Harness v3 migrates healthy logs itself; the TUI keeps this small
 * decoder solely for its torn-log rescue path, which operates before Harness
 * can construct a Session.
 */
type LegacyTag = 'text-chunks' | 'reasoning-chunks' | 'tool-call-chunks'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exact(value: object, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function malformed(tag: string, why: string): never {
  throw new Error(`malformed ${tag} storage row: ${why}`)
}

function payload(tag: LegacyTag, data: Record<string, unknown>, key: 'texts' | 'args'): string[] {
  if (typeof data.turn !== 'number' || typeof data.step !== 'number' || typeof data.index !== 'number') {
    malformed(tag, 'turn/step/index must be numbers')
  }
  const values = data[key]
  if (!Array.isArray(values) || values.length === 0 || values.some(value => typeof value !== 'string')) {
    malformed(tag, `${key} must be a non-empty string array`)
  }
  if (!Array.isArray(data.dt) || data.dt.some(gap => !Number.isSafeInteger(gap))) {
    malformed(tag, 'dt must be an array of safe integers')
  }
  if (data.dt.length !== values.length - 1) malformed(tag, 'dt/member length mismatch')
  return values as string[]
}

/** Validate and expand one v2 packed row to its original logical events. */
export function decodeLegacyChunkRow(value: unknown): EventLike[] {
  if (!object(value)) throw new Error('legacy chunk row must be an object')
  const tag = value.type
  if (tag !== 'text-chunks' && tag !== 'reasoning-chunks' && tag !== 'tool-call-chunks') {
    throw new Error('not a legacy chunk row')
  }
  if (!exact(value, ['type', 'seq0', 'time0', 'data'])) malformed(tag, 'invalid envelope')
  if (!Number.isSafeInteger(value.seq0) || (value.seq0 as number) < 0) malformed(tag, 'invalid seq0')
  if (!Number.isSafeInteger(value.time0)) malformed(tag, 'invalid time0')
  if (!object(value.data)) malformed(tag, 'data must be an object')
  const data = value.data as Record<string, unknown>
  const isTool = tag === 'tool-call-chunks'
  if (isTool) {
    const withName = exact(data, ['turn', 'step', 'index', 'id', 'name', 'dt', 'args'])
    if (!withName && !exact(data, ['turn', 'step', 'index', 'id', 'dt', 'args'])) malformed(tag, 'invalid tool data')
    if (typeof data.id !== 'string' || (withName && typeof data.name !== 'string')) malformed(tag, 'invalid tool identity')
  } else if (!exact(data, ['turn', 'step', 'index', 'dt', 'texts'])) {
    malformed(tag, 'invalid text data')
  }
  const values = payload(tag, data, isTool ? 'args' : 'texts')
  if (!Number.isSafeInteger((value.seq0 as number) + values.length - 1)) malformed(tag, 'member seq overflow')
  const events: EventLike[] = []
  let time = value.time0 as number
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) time += (data.dt as number[])[index - 1]!
    if (!Number.isSafeInteger(time)) malformed(tag, 'member time overflow')
    const chunk = tag === 'text-chunks'
      ? { type: 'text-delta', index: data.index, text: values[index] }
      : tag === 'reasoning-chunks'
        ? { type: 'reasoning-delta', index: data.index, text: values[index] }
        : {
            type: 'tool-call-delta', index: data.index, id: data.id,
            ...(Object.hasOwn(data, 'name') ? { name: data.name } : {}),
            argumentsDelta: values[index],
          }
    events.push({
      type: 'assistant/chunk', seq: (value.seq0 as number) + index, time,
      data: { turn: data.turn, step: data.step, chunk },
    })
  }
  return events
}
