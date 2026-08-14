import type { RuntimeSnapshot } from '../interaction-controller.js'

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

function contextPressure(runtime: RuntimeSnapshot): { used: number; capacity: number; percent: number } | undefined {
  const value = record(projectionValue(runtime, 'contextPressure'))
  if (value === undefined) return undefined
  const used = nonNegative(value.projectedTokens) ?? nonNegative(value.pressureTokens)
  const capacity = nonNegative(value.contextWindow)
  if (used === undefined || capacity === undefined || capacity === 0) return undefined
  return { used, capacity, percent: Math.round(used / capacity * 100) }
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

export function statusSegments(runtime: RuntimeSnapshot, detail = true): string[] {
  const segments = [runtime.model, runtime.cwd]
  const title = sessionTitle(runtime)
  if (title !== undefined) segments.push(title)
  if (runtime.sessionId !== undefined) segments.push(runtime.sessionId)
  const permission = effectivePermission(runtime)
  if (permission !== undefined) segments.push(permission)
  if (!detail) return segments

  const pressure = contextPressure(runtime)
  if (pressure !== undefined) segments.push(`${formatCount(pressure.used)}/${formatCount(pressure.capacity)} ${pressure.percent}%`)
  else {
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
  return segments
}

export function sessionInfoLines(runtime: RuntimeSnapshot): string[] {
  const lines: string[] = []
  const title = sessionTitle(runtime)
  if (title !== undefined) lines.push(`title        ${title}`)
  if (runtime.sessionId !== undefined) lines.push(`session      ${runtime.sessionId}`)
  lines.push(`cwd          ${runtime.cwd}`, `model        ${runtime.model}`)
  const permission = effectivePermission(runtime)
  if (permission !== undefined) lines.push(`permission   ${permission}`)
  if (runtime.projection !== undefined) lines.push(`projection   seq ${runtime.projection.asOfSeq}`)

  const usage = tokenUsage(runtime)
  if (usage !== undefined) {
    lines.push(`tokens       input ${formatCount(usage.input)} · output ${formatCount(usage.output)} · cache read ${formatCount(usage.read)} · write ${formatCount(usage.write)}`)
  }
  const pressure = contextPressure(runtime)
  if (pressure !== undefined) lines.push(`context      ${formatCount(pressure.used)}/${formatCount(pressure.capacity)} · ${pressure.percent}%`)
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
  return lines
}
