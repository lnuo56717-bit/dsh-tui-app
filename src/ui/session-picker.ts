import type { SessionChoice, SessionSummary } from '../interaction-controller.js'
import { redactSecrets } from './secrets.js'
import { relativeTime } from './status.js'

/**
 * What one persisted session is called in the picker: the durable title first,
 * then its opening prompt, and only then the id. Nothing is fabricated — a log
 * that carries neither says so.
 */
export function sessionLabel(item: SessionChoice, summary: SessionSummary | undefined): string {
  if (summary === undefined) return 'reading conversation…'
  const label = summary.title ?? summary.firstPrompt
  if (label !== undefined) return redactSecrets(label)
  return summary.unreadable === undefined ? `untitled · ${item.id}` : `unreadable log · ${item.id}`
}

/** Right-hand facts: whether it is the open session, prompt count, and age. */
export function sessionMeta(item: SessionChoice, summary: SessionSummary | undefined, now = Date.now()): string {
  return [
    item.current ? 'current' : undefined,
    summary === undefined || summary.unreadable !== undefined ? undefined : `${summary.prompts} prompt${summary.prompts === 1 ? '' : 's'}`,
    relativeTime(summary?.updatedAt ?? item.createdAt, now),
  ].filter((part): part is string => part !== undefined).join(' · ')
}

/** The one line where the opaque id belongs: the detail row for the selection. */
export function sessionDetail(item: SessionChoice | undefined): string | undefined {
  if (item === undefined) return undefined
  return `${item.id} · ${item.cwd ?? 'cwd unknown'} · created ${new Date(item.createdAt).toLocaleString()}`
}
