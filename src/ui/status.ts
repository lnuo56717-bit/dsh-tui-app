import type { RuntimeSnapshot } from '../interaction-controller.js'
import { displayWidth, takeCells } from './display-width.js'
import { redactSecrets } from './secrets.js'

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function nonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

export function projectionValue(runtime: RuntimeSnapshot, key: string): unknown {
  return runtime.projection?.values[key]
}

export function sessionTitle(runtime: RuntimeSnapshot): string | undefined {
  return text(projectionValue(runtime, 'title'))
}

/** Coarse age of a durable fact. Never invents precision the timestamp lacks. */
export function relativeTime(at: number | undefined, now = Date.now()): string | undefined {
  if (at === undefined || !Number.isFinite(at) || at <= 0) return undefined
  const delta = now - at
  if (delta < 60_000) return 'just now'
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`
  if (delta < 604_800_000) return `${Math.round(delta / 86_400_000)}d ago`
  return new Date(at).toLocaleDateString()
}

/** Fit text to an exact display-cell column: tail-ellipsized when long, padded when short. */
export function padCells(value: string, cells: number): string {
  const limit = Math.max(0, cells)
  if (limit === 0) return ''
  if (displayWidth(value) <= limit) return value + ' '.repeat(limit - displayWidth(value))
  const clipped = takeCells(value, limit - 1)
  return `${clipped.head}…${' '.repeat(Math.max(0, limit - 1 - clipped.width))}`
}

export function effectivePermission(runtime: RuntimeSnapshot): string | undefined {
  return text(record(projectionValue(runtime, 'permissions'))?.currentValue) ?? runtime.permission
}

export function formatCount(value: number): string {
  if (value < 1_000) return String(Math.round(value))
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0).replace(/\.0$/u, '')}k`
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0).replace(/\.0$/u, '')}m`
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0).replace(/\.0$/u, '')}s`
  return `${(ms / 60_000).toFixed(1).replace(/\.0$/u, '')}m`
}

function tokenUsage(runtime: RuntimeSnapshot): { input: number; output: number; read: number; write: number } | undefined {
  const value = record(projectionValue(runtime, 'tokenUsage'))
  if (value === undefined) return undefined
  const uncached = nonNegative(value.uncachedInputTokens)
  const output = nonNegative(value.outputTokens)
  const read = nonNegative(value.cacheReadTokens)
  const write = nonNegative(value.cacheWriteTokens)
  if (uncached === undefined || output === undefined || read === undefined || write === undefined) return undefined
  return { input: uncached, output, read, write }
}

/**
 * Cache-hit share of billed prompt input over the whole durable log — the same
 * metric the web UI's stats line prints. Absent until the log billed input.
 */
export function cacheHitLabel(runtime: RuntimeSnapshot): string | undefined {
  const usage = tokenUsage(runtime)
  if (usage === undefined) return undefined
  const billed = usage.input + usage.read + usage.write
  if (billed === 0) return undefined
  return `cache hit ${Math.round(usage.read / billed * 100)}%`
}

export function contextPressure(runtime: RuntimeSnapshot): { used: number; capacity: number; percent: number } | undefined {
  const value = record(projectionValue(runtime, 'contextPressure'))
  if (value === undefined) return undefined
  const used = nonNegative(value.projectedTokens) ?? nonNegative(value.pressureTokens)
  const capacity = nonNegative(value.contextWindow)
  if (used === undefined || capacity === undefined || capacity === 0) return undefined
  return { used, capacity, percent: Math.min(100, Math.round(used / capacity * 100)) }
}

/** Compact, high-priority context fact for persistent chrome. Unknown values stay absent. */
export function contextStatus(runtime: RuntimeSnapshot): string | undefined {
  const pressure = contextPressure(runtime)
  if (pressure !== undefined) return `ctx ${pressure.percent}% · ~${formatCount(pressure.used)}/${formatCount(pressure.capacity)}`
  const capacity = nonNegative(runtime.contextWindow)
  return capacity === undefined || capacity === 0 ? undefined : `ctx —/${formatCount(capacity)}`
}

function stats(runtime: RuntimeSnapshot): { turns: number; steps: number; llmMs?: number; toolMs?: number } | undefined {
  const value = record(projectionValue(runtime, 'sessionStats'))
  if (value === undefined) return undefined
  const turns = nonNegative(value.turns)
  const steps = nonNegative(value.steps)
  if (turns === undefined || steps === undefined) return undefined
  const llmMs = nonNegative(value.llmMs)
  const toolMs = nonNegative(value.toolMs)
  return { turns, steps, ...(llmMs === undefined ? {} : { llmMs }), ...(toolMs === undefined ? {} : { toolMs }) }
}

const UUID_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu

function looksLikeOpaqueId(value: string): boolean {
  return UUID_LIKE.test(value)
    || /sk-|Bearer\s/iu.test(value)
    || /(?:[0-9a-f]{4,}-){2,}[0-9a-f]{8,}/iu.test(value)
    || (value.length >= 32 && /[0-9a-f]{20,}/iu.test(value))
}

/** Short provider/model label. Opaque ids and routes stay off the footer. */
export function shortModelLabel(model: string): string | undefined {
  const cleaned = redactSecrets(model).trim()
  if (cleaned === '') return undefined
  const slash = cleaned.lastIndexOf('/')
  if (slash <= 0) return looksLikeOpaqueId(cleaned) ? undefined : (cleaned.length <= 28 ? cleaned : `${cleaned.slice(0, 16)}…`)
  const provider = cleaned.slice(0, slash)
  const name = cleaned.slice(slash + 1)
  if (name === '' || looksLikeOpaqueId(name)) return looksLikeOpaqueId(provider) ? undefined : provider
  return cleaned.length <= 32 ? cleaned : name
}

export function statusSegments(runtime: RuntimeSnapshot, detail = true): string[] {
  const context = contextStatus(runtime)
  const model = shortModelLabel(runtime.model)
  const segments = [
    ...(context === undefined ? [] : [context]),
    ...(model === undefined ? [] : [model]),
    `effort ${runtime.reasoningEffort ?? 'default'}`,
  ]
  const permission = effectivePermission(runtime)
  if (permission !== undefined) segments.push(permission)
  if (!detail) return segments.map(redactSecrets)

  if (context === undefined) {
    const usage = tokenUsage(runtime)
    if (usage !== undefined) segments.push(`tokens in ${formatCount(usage.input + usage.read + usage.write)} out ${formatCount(usage.output)}`)
  }
  const sessionStats = stats(runtime)
  if (sessionStats !== undefined) segments.push(`${formatCount(sessionStats.turns)} turns/${formatCount(sessionStats.steps)} steps`)
  const plan = record(projectionValue(runtime, 'plan'))
  if (typeof plan?.active === 'boolean' && typeof plan.pending === 'boolean') {
    segments.push(`plan ${plan.active ? 'on' : 'off'}${plan.pending ? ' pending' : ''}`)
  }
  const todos = projectionValue(runtime, 'todos')
  if (Array.isArray(todos)) segments.push(`todos ${todos.length}`)
  return segments.map(redactSecrets)
}

/**
 * The footer's status row is fixed at one line, and the composer's caret is
 * measured from that fact. Multi-line signals (a dsh command result like
 * `/goal`'s status view) are folded onto that one line, or the footer would
 * grow under the composer and drag the caret suffix off the draft.
 */
function singleLineSignal(value: string): string {
  return value.split(/\r?\n/u).map(line => line.trim()).filter(line => line !== '').join(' · ')
}

/** Fit notice + public facts without middle-ellipsis, which can splice a UUID into the model field. */
export function formatFooter(runtime: RuntimeSnapshot, signal: string | undefined, cells: number, detail = true): string {
  const facts = statusSegments(runtime, detail)
  const notice = signal === undefined || signal.trim() === '' ? undefined : redactSecrets(singleLineSignal(signal))
  const limit = Math.max(1, cells)
  const render = (parts: string[]): string => parts.join(' · ')
  if (notice === undefined) {
    const kept = [...facts]
    while (kept.length > 1 && displayWidth(render(kept)) > limit) kept.pop()
    return takeCells(render(kept), limit).head
  }
  const kept = [...facts]
  const withNotice = (): string => (kept.length === 0 ? notice : `${notice} │ ${render(kept)}`)
  while (kept.length > 0 && displayWidth(withNotice()) > limit) kept.pop()
  return takeCells(withNotice(), limit).head
}

export function sessionInfoLines(runtime: RuntimeSnapshot): string[] {
  const lines: string[] = []
  const title = sessionTitle(runtime)
  if (title !== undefined) lines.push(`title        ${title}`)
  if (runtime.sessionId !== undefined) lines.push(`session      ${runtime.sessionId}`)
  lines.push(`cwd          ${runtime.cwd}`, `model        ${runtime.model}`, `effort       ${runtime.reasoningEffort ?? 'default'}`)
  const permission = effectivePermission(runtime)
  if (permission !== undefined) lines.push(`permission   ${permission}`)
  if (runtime.projection !== undefined) lines.push(`projection   seq ${runtime.projection.asOfSeq}`)

  const usage = tokenUsage(runtime)
  if (usage !== undefined) {
    lines.push(`tokens       input ${formatCount(usage.input)} · output ${formatCount(usage.output)} · cache read ${formatCount(usage.read)} · write ${formatCount(usage.write)}`)
  }
  const pressure = contextPressure(runtime)
  if (pressure !== undefined) lines.push(`context      ~${formatCount(pressure.used)}/${formatCount(pressure.capacity)} · ${pressure.percent}%`)
  else if (runtime.contextWindow !== undefined) lines.push(`context      —/${formatCount(runtime.contextWindow)}`)
  const breakdown = record(projectionValue(runtime, 'contextBreakdown'))
  const system = nonNegative(breakdown?.systemTokens)
  const tools = nonNegative(breakdown?.toolsTokens)
  const messages = nonNegative(breakdown?.messageTokens)
  if (system !== undefined && tools !== undefined && messages !== undefined) {
    lines.push(`composition  system ~${formatCount(system)} · tools ~${formatCount(tools)} · messages ~${formatCount(messages)}`)
  }
  const sessionStats = stats(runtime)
  if (sessionStats !== undefined) {
    const timing = [sessionStats.llmMs === undefined ? undefined : `LLM ${formatDuration(sessionStats.llmMs)}`, sessionStats.toolMs === undefined ? undefined : `tools ${formatDuration(sessionStats.toolMs)}`].filter(item => item !== undefined)
    lines.push(`stats        ${sessionStats.turns} turns · ${sessionStats.steps} steps${timing.length === 0 ? '' : ` · ${timing.join(' · ')}`}`)
  }
  const plan = record(projectionValue(runtime, 'plan'))
  if (typeof plan?.active === 'boolean' && typeof plan.pending === 'boolean') lines.push(`plan         ${plan.active ? 'on' : 'off'}${plan.pending ? ' · change pending' : ''}`)
  const todos = projectionValue(runtime, 'todos')
  if (Array.isArray(todos)) {
    const counts = new Map<string, number>()
    for (const item of todos) {
      const status = text(record(item)?.status)
      if (status !== undefined) counts.set(status, (counts.get(status) ?? 0) + 1)
    }
    const summary = [...counts].map(([status, count]) => `${status} ${count}`).join(' · ')
    lines.push(`todos        ${todos.length}${summary === '' ? '' : ` · ${summary}`}`)
  }
  const subagent = record(projectionValue(runtime, 'subagent'))
  if (subagent !== undefined && (subagent.mode === 'one-shot' || subagent.mode === 'continuable')) {
    lines.push(`subagent     ${String(subagent.mode)}${text(subagent.label) === undefined ? '' : ` · ${text(subagent.label)}`}`)
  }
  return lines.map(redactSecrets)
}
