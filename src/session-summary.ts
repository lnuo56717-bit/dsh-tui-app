import type { EventLike } from './transcript-fold.js'

/** What a persisted log says about itself, folded without publishing the session. */
export interface SessionSummaryFacts {
  /** Latest `session/title` payload, when the host logged one. */
  readonly title?: string
  /** First human prompt. Used only as a fallback label when no title was logged. */
  readonly firstPrompt?: string
  /** Human `user/message` events; assistant turns and tool traffic are not counted. */
  readonly prompts: number
  /** Time of the last stored event. */
  readonly updatedAt?: number
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function collapse(value: string): string {
  return value.replaceAll(/\s+/gu, ' ').trim()
}

function messageText(data: unknown): string {
  const content = record(data).content
  if (!Array.isArray(content)) return ''
  return collapse(content.flatMap(block => {
    const item = record(block)
    return item.type === 'text' && typeof item.text === 'string' ? [item.text] : []
  }).join(' '))
}

/**
 * Fold a stored log into picker facts. Nothing is invented: a session with no
 * logged title and no human prompt yields neither, and the caller falls back to
 * the durable id.
 */
export function foldSessionSummary(events: readonly EventLike[]): SessionSummaryFacts {
  let title: string | undefined
  let firstPrompt: string | undefined
  let prompts = 0
  let updatedAt: number | undefined
  for (const event of events) {
    if (typeof event.time === 'number' && Number.isFinite(event.time) && event.time > 0) {
      updatedAt = updatedAt === undefined ? event.time : Math.max(updatedAt, event.time)
    }
    if (event.type === 'session/title') {
      const value = record(event.data).title
      const text = typeof value === 'string' ? collapse(value) : ''
      if (text !== '') title = text
      continue
    }
    if (event.type !== 'user/message') continue
    if (record(record(event.data).source).kind !== 'user') continue
    prompts += 1
    if (firstPrompt === undefined) {
      const text = messageText(event.data)
      if (text !== '') firstPrompt = text
    }
  }
  return {
    ...(title === undefined ? {} : { title }),
    ...(firstPrompt === undefined ? {} : { firstPrompt }),
    prompts,
    ...(updatedAt === undefined ? {} : { updatedAt }),
  }
}
