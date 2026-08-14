export interface EventLike {
  readonly type: string
  readonly seq: number
  readonly time?: number
  readonly data: unknown
  readonly ignorable?: true
  readonly sourceEventSeqs?: readonly number[]
  readonly surfaceOp?: 'append' | { readonly op: 'replace'; readonly start: number; readonly end: number }
}

export type ToolStatus = 'running' | 'success' | 'error' | 'cancelled' | 'orphan'

export type TranscriptBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'reasoning'; readonly text: string; readonly streaming?: true }
  | { readonly type: 'tool-call'; readonly id: string; readonly name: string; readonly arguments: string }
  | { readonly type: 'image'; readonly label: string }
  | { readonly type: 'raw'; readonly blockType: string; readonly value: unknown }

export interface MessageNode {
  readonly kind: 'message'
  readonly id: string
  readonly seq: number
  readonly role: 'user' | 'assistant'
  readonly source: string
  readonly blocks: readonly TranscriptBlock[]
  readonly streaming: boolean
  readonly turn?: number
  readonly step?: number
  readonly finish?: unknown
  readonly usage?: unknown
  /** Present (including an empty array) only when the committed event supplied provenance. */
  readonly sourceEventSeqs?: readonly number[]
}

export interface ToolNode {
  readonly kind: 'tool'
  readonly id: string
  readonly seq: number
  readonly callId: string
  readonly name: string
  readonly arguments: string
  readonly status: ToolStatus
  readonly result: readonly TranscriptBlock[]
  readonly children: readonly ToolNode[]
  readonly error?: unknown
  readonly meta?: unknown
}

export interface WorkflowChild {
  readonly seq: number
  readonly label: string
  readonly childId: string
  readonly phase?: string
  readonly outcome?: unknown
}

export interface WorkflowNode {
  readonly kind: 'workflow'
  readonly id: string
  readonly seq: number
  readonly runId: string
  readonly name: string
  readonly status: 'running' | 'success' | 'error' | 'stopped'
  readonly children: readonly WorkflowChild[]
  readonly reason?: unknown
}

export interface ActivityNode {
  readonly kind: 'activity'
  readonly id: string
  readonly seq: number
  readonly activity: 'command' | 'compaction' | 'hook' | 'retry'
  readonly label: string
  readonly status: 'running' | 'success' | 'error' | 'waiting'
  readonly detail?: unknown
}

export interface RawNode {
  readonly kind: 'raw'
  readonly id: string
  readonly seq: number
  readonly eventType: string
  readonly data: unknown
  readonly required: boolean
}

export type TranscriptNode = MessageNode | ToolNode | WorkflowNode | ActivityNode | RawNode

interface PartialAssistant {
  readonly nodeId: string
  readonly blocks: readonly (TranscriptBlock | null)[]
  readonly sourceSeqs: readonly number[]
  readonly usage?: unknown
  readonly finish?: unknown
}

/**
 * Task timing measured from the log's own turn brackets. The session layer
 * enforces one open turn at a time, so the span between a `turn/start` and its
 * matching `turn/end` is exactly how long that task ran.
 */
export interface TurnTiming {
  /** The turn currently running, when one is open. */
  readonly open?: { readonly turn: number; readonly startedAt: number }
  /** Turns closed with a span both boundaries timestamped; an untimed turn is not counted. */
  readonly measured: number
  /** Sum of the measured spans — the conversation's task time so far. */
  readonly workMs: number
  /** Span of the most recently measured turn. */
  readonly lastMs?: number
  /** How that turn ended, as the log recorded it: `completed`, `aborted`, … */
  readonly lastReason?: string
}

export const NO_TIMING: TurnTiming = Object.freeze({ measured: 0, workMs: 0 })

export interface TranscriptState {
  readonly lastSeq: number
  readonly nodes: readonly TranscriptNode[]
  readonly surface: readonly { readonly eventSeq: number; readonly nodeId: string }[]
  readonly partials: Readonly<Record<string, PartialAssistant>>
  readonly finalizedPairs: readonly string[]
  readonly toolIndex: Readonly<Record<string, string>>
  readonly workflowIndex: Readonly<Record<string, string>>
  readonly metadata: Readonly<Record<string, unknown>>
  readonly diagnostics: readonly { readonly seq: number; readonly type: string; readonly data: unknown }[]
  readonly timing: TurnTiming
  readonly gap?: { readonly expected: number; readonly received: number }
}

export const EMPTY_TRANSCRIPT: TranscriptState = Object.freeze({
  lastSeq: -1,
  nodes: Object.freeze([]),
  surface: Object.freeze([]),
  partials: Object.freeze({}),
  finalizedPairs: Object.freeze([]),
  toolIndex: Object.freeze({}),
  workflowIndex: Object.freeze({}),
  metadata: Object.freeze({}),
  diagnostics: Object.freeze([]),
  timing: NO_TIMING,
})

export const KNOWN_EVENT_TYPES = [
  'turn/start', 'turn/end', 'step/start', 'step/end', 'user/message', 'assistant/chunk', 'assistant/message',
  'tool/call', 'tool/result', 'tool/code-dispatch-start', 'tool/code-dispatch', 'todo/write', 'request/header',
  'request/context', 'session/end-seed', 'agent-preset/selected', 'agent/inbox/spliced', 'approval/asked',
  'approval/decided', 'approval/policy', 'permission/preset', 'sandbox/mode', 'plan/mode', 'command/run',
  'command/done', 'compaction/start', 'compaction/summary', 'compaction/end', 'compaction/prune', 'feedback/record',
  'goal/change', 'hook/invoked', 'hook/result', 'llm/retry', 'llm/retry-started', 'schedule/change', 'session/title',
  'session/title-llm-request', 'subagent/descriptor', 'tool-workflow/run-start', 'tool-workflow/agent-start',
  'tool-workflow/agent-end', 'tool-workflow/run-end', 'web/deepseek-search-llm-request',
] as const

const KNOWN_EVENTS = new Set<string>(KNOWN_EVENT_TYPES)

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function string(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeBlock(value: unknown): TranscriptBlock {
  const block = record(value)
  const type = string(block.type, 'unknown')
  if (type === 'text' || type === 'reasoning') return { type, text: string(block.text) }
  if (type === 'tool-call') {
    return { type, id: string(block.id), name: string(block.name, 'tool'), arguments: string(block.arguments) }
  }
  if (type === 'image') {
    const attachment = record(block.attachment)
    return { type, label: string(attachment.name, string(attachment.mimeType, 'image attachment')) }
  }
  if (type === 'tool-result') {
    const content = Array.isArray(block.content) ? block.content : []
    return { type: 'raw', blockType: 'tool-result', value: content }
  }
  return { type: 'raw', blockType: type, value }
}

function normalizeBlocks(value: unknown): TranscriptBlock[] {
  return Array.isArray(value) ? value.map(normalizeBlock) : []
}

function pairKey(turn: unknown, step: unknown): string {
  return `${number(turn)}:${number(step)}`
}

function sameSeqSet(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false
  const expected = new Set(right)
  return expected.size === right.length && left.every(seq => expected.has(seq))
}

function replaceNode(nodes: readonly TranscriptNode[], node: TranscriptNode): TranscriptNode[] {
  const index = nodes.findIndex(current => current.id === node.id)
  if (index < 0) return [...nodes, node]
  const next = [...nodes]
  next[index] = node
  return next
}

function removeNodes(nodes: readonly TranscriptNode[], ids: ReadonlySet<string>, except: string): TranscriptNode[] {
  return nodes.filter(node => node.id === except || !ids.has(node.id))
}

function placeSurface(state: TranscriptState, event: EventLike, nodeId: string): Pick<TranscriptState, 'nodes' | 'surface'> {
  const op = event.surfaceOp ?? 'append'
  if (op === 'append') {
    if (state.surface.some(item => item.eventSeq === event.seq)) return { nodes: state.nodes, surface: state.surface }
    return { nodes: state.nodes, surface: [...state.surface, { eventSeq: event.seq, nodeId }] }
  }
  const start = state.surface.findIndex(item => item.eventSeq === op.start)
  const end = state.surface.findIndex(item => item.eventSeq === op.end)
  if (start < 0 || end < start) {
    return { nodes: state.nodes, surface: [...state.surface, { eventSeq: event.seq, nodeId }] }
  }
  const shadowed = state.surface.slice(start, end + 1)
  const ids = new Set(shadowed.map(item => item.nodeId))
  const surface = [...state.surface.slice(0, start), { eventSeq: event.seq, nodeId }, ...state.surface.slice(end + 1)]
  const newNode = state.nodes.find(node => node.id === nodeId)
  const originalIndex = Math.min(...shadowed.map(item => state.nodes.findIndex(node => node.id === item.nodeId)).filter(index => index >= 0))
  let nodes = removeNodes(state.nodes, ids, nodeId).filter(node => node.id !== nodeId)
  if (newNode !== undefined) nodes.splice(Number.isFinite(originalIndex) ? originalIndex : nodes.length, 0, newNode)
  return { nodes, surface }
}

function boundedDiagnostic(state: TranscriptState, event: EventLike): TranscriptState['diagnostics'] {
  return [...state.diagnostics, { seq: event.seq, type: event.type, data: event.data }].slice(-32)
}

function updateTool(nodes: readonly TranscriptNode[], nodeId: string, update: (tool: ToolNode) => ToolNode): TranscriptNode[] {
  const visit = (tool: ToolNode): ToolNode => {
    if (tool.id === nodeId) return update(tool)
    const children = tool.children.map(visit)
    return children.every((child, index) => child === tool.children[index]) ? tool : { ...tool, children }
  }
  return nodes.map(node => node.kind === 'tool' ? visit(node) : node)
}

function findTool(nodes: readonly TranscriptNode[], nodeId: string): ToolNode | undefined {
  for (const node of nodes) {
    if (node.kind !== 'tool') continue
    const stack = [node]
    while (stack.length > 0) {
      const next = stack.pop()!
      if (next.id === nodeId) return next
      stack.push(...next.children)
    }
  }
  return undefined
}

function foldChunk(state: TranscriptState, event: EventLike): TranscriptState {
  const data = record(event.data)
  const key = pairKey(data.turn, data.step)
  if (state.finalizedPairs.includes(key)) return { ...state, lastSeq: event.seq, diagnostics: boundedDiagnostic(state, event) }
  const nodeId = `assistant:${key}`
  const previous = state.partials[key] ?? { nodeId, blocks: [], sourceSeqs: [] }
  const chunk = record(data.chunk)
  const index = number(chunk.index, -1)
  let blocks = [...previous.blocks]
  let usage = previous.usage
  let finish = previous.finish
  switch (chunk.type) {
    case 'block-start':
      if (index >= 0) {
        const type = string(chunk.blockType)
        blocks[index] = type === 'reasoning' ? { type: 'reasoning', text: '', streaming: true }
          : type === 'tool-call' ? { type: 'tool-call', id: '', name: '', arguments: '' }
            : type === 'text' ? { type: 'text', text: '' }
              : { type: 'raw', blockType: type, value: null }
      }
      break
    case 'text-delta':
    case 'reasoning-delta':
      if (index >= 0) {
        const type = chunk.type === 'text-delta' ? 'text' : 'reasoning'
        const current = blocks[index]
        blocks[index] = current?.type === type
          ? { type, text: current.text + string(chunk.text), ...(type === 'reasoning' ? { streaming: true as const } : {}) }
          : { type, text: string(chunk.text), ...(type === 'reasoning' ? { streaming: true as const } : {}) }
      }
      break
    case 'tool-call-delta':
      if (index >= 0) {
        const current = blocks[index]
        blocks[index] = current?.type === 'tool-call'
          ? {
              type: 'tool-call',
              id: current.id || string(chunk.id),
              name: chunk.name === undefined ? current.name : string(chunk.name),
              arguments: current.arguments + string(chunk.argumentsDelta),
            }
          : { type: 'tool-call', id: string(chunk.id), name: string(chunk.name), arguments: string(chunk.argumentsDelta) }
      }
      break
    case 'block-end':
      if (index >= 0) blocks[index] = normalizeBlock(chunk.block)
      break
    case 'usage':
      usage = chunk.usage
      break
    case 'finish':
      finish = chunk.reason
      break
    default:
      return { ...state, lastSeq: event.seq, diagnostics: boundedDiagnostic(state, event) }
  }
  const partial: PartialAssistant = {
    nodeId,
    blocks,
    sourceSeqs: [...previous.sourceSeqs, event.seq],
    ...(usage === undefined ? {} : { usage }),
    ...(finish === undefined ? {} : { finish }),
  }
  const node: MessageNode = {
    kind: 'message', id: nodeId, seq: previous.sourceSeqs[0] ?? event.seq, role: 'assistant', source: 'model',
    blocks: blocks.filter((block): block is TranscriptBlock => block != null), streaming: true,
    turn: number(data.turn), step: number(data.step),
    ...(usage === undefined ? {} : { usage }), ...(finish === undefined ? {} : { finish }),
  }
  return { ...state, lastSeq: event.seq, nodes: replaceNode(state.nodes, node), partials: { ...state.partials, [key]: partial } }
}

function foldAssistantMessage(state: TranscriptState, event: EventLike): TranscriptState {
  const data = record(event.data)
  const key = pairKey(data.turn, data.step)
  const message = record(data.message)
  const matchedEntry = event.sourceEventSeqs === undefined
    ? (state.partials[key] === undefined ? undefined : [key, state.partials[key]] as const)
    : Object.entries(state.partials).find(([, partial]) => sameSeqSet(partial.sourceSeqs, event.sourceEventSeqs!))
  const matchedKey = matchedEntry?.[0]
  const nodeId = matchedEntry?.[1].nodeId ?? `assistant:${key}`
  const node: MessageNode = {
    kind: 'message', id: nodeId, seq: event.seq, role: 'assistant', source: string(record(message.source).kind, 'model'),
    blocks: normalizeBlocks(message.content), streaming: false, turn: number(data.turn), step: number(data.step),
    ...(data.usage === undefined ? {} : { usage: data.usage }),
    ...(event.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: [...event.sourceEventSeqs] }),
  }
  const partials = { ...state.partials }
  if (matchedKey !== undefined) delete partials[matchedKey]
  const finalizedPairs = new Set(state.finalizedPairs)
  finalizedPairs.add(key)
  if (matchedKey !== undefined) finalizedPairs.add(matchedKey)
  let next: TranscriptState = {
    ...state,
    lastSeq: event.seq,
    nodes: replaceNode(state.nodes, node),
    partials,
    finalizedPairs: [...finalizedPairs],
  }
  const placed = placeSurface(next, event, nodeId)
  next = { ...next, ...placed }
  return next
}

function foldUserMessage(state: TranscriptState, event: EventLike): TranscriptState {
  const message = record(event.data)
  const source = record(message.source)
  const node: MessageNode = {
    kind: 'message', id: `message:${event.seq}`, seq: event.seq, role: 'user', source: string(source.kind, 'user'),
    blocks: normalizeBlocks(message.content), streaming: false,
  }
  let next: TranscriptState = { ...state, lastSeq: event.seq, nodes: [...state.nodes, node] }
  next = { ...next, ...placeSurface(next, event, node.id) }
  return next
}

function foldToolCall(state: TranscriptState, event: EventLike): TranscriptState {
  const data = record(event.data)
  const callId = string(data.callId, `orphan-${event.seq}`)
  const id = `tool:${callId}`
  const tool: ToolNode = {
    kind: 'tool', id, seq: event.seq, callId, name: string(data.name, 'tool'), arguments: string(data.arguments),
    status: 'running', result: [], children: [],
  }
  return { ...state, lastSeq: event.seq, nodes: replaceNode(state.nodes, tool), toolIndex: { ...state.toolIndex, [callId]: id } }
}

function foldToolResult(state: TranscriptState, event: EventLike): TranscriptState {
  const data = record(event.data)
  const message = record(data.message)
  const block = record(Array.isArray(message.content) ? message.content[0] : undefined)
  const callId = string(block.toolCallId, string(record(message.source).callId, `orphan-${event.seq}`))
  let nodeId = state.toolIndex[callId]
  let nodes = state.nodes
  let toolIndex = state.toolIndex
  if (nodeId === undefined || findTool(nodes, nodeId) === undefined) {
    nodeId = `tool:orphan:${event.seq}`
    const orphan: ToolNode = {
      kind: 'tool', id: nodeId, seq: event.seq, callId, name: 'orphan result', arguments: '', status: 'orphan',
      result: normalizeBlocks(block.content), children: [], ...(data.error === undefined ? {} : { error: data.error }),
      ...(data.meta === undefined ? {} : { meta: data.meta }),
    }
    nodes = [...nodes, orphan]
    toolIndex = { ...toolIndex, [callId]: nodeId }
  } else {
    const failed = data.error !== undefined || block.isError === true
    nodes = updateTool(nodes, nodeId, tool => ({
      ...tool, status: failed ? 'error' : 'success', result: normalizeBlocks(block.content),
      ...(data.error === undefined ? {} : { error: data.error }), ...(data.meta === undefined ? {} : { meta: data.meta }),
    }))
  }
  let next: TranscriptState = { ...state, lastSeq: event.seq, nodes, toolIndex }
  next = { ...next, ...placeSurface(next, event, nodeId) }
  return next
}

function foldCodeDispatch(state: TranscriptState, event: EventLike): TranscriptState {
  const data = record(event.data)
  const subCallId = string(data.subCallId, `dispatch-${event.seq}`)
  const childId = `tool:${subCallId}`
  const existing = state.toolIndex[subCallId]
  if (event.type === 'tool/code-dispatch' && existing !== undefined) {
    const nodes = updateTool(state.nodes, existing, tool => ({
      ...tool, status: data.isError === true ? 'error' : 'success', result: normalizeBlocks(data.content),
    }))
    return { ...state, lastSeq: event.seq, nodes }
  }
  const child: ToolNode = {
    kind: 'tool', id: childId, seq: event.seq, callId: subCallId, name: string(data.name, 'dispatch'),
    arguments: typeof data.arguments === 'string' ? data.arguments : JSON.stringify(data.arguments ?? {}),
    status: event.type === 'tool/code-dispatch' ? (data.isError === true ? 'error' : 'success') : 'running',
    result: event.type === 'tool/code-dispatch' ? normalizeBlocks(data.content) : [], children: [],
  }
  const parentCallId = string(data.parentCallId)
  const parentId = state.toolIndex[parentCallId]
  const nodes = parentId === undefined
    ? [...state.nodes, { ...child, status: 'orphan' as const }]
    : updateTool(state.nodes, parentId, parent => ({ ...parent, children: [...parent.children, child] }))
  return { ...state, lastSeq: event.seq, nodes, toolIndex: { ...state.toolIndex, [subCallId]: childId } }
}

function foldWorkflow(state: TranscriptState, event: EventLike): TranscriptState {
  const data = record(event.data)
  const runId = string(data.runId, `run-${event.seq}`)
  const id = state.workflowIndex[runId] ?? `workflow:${runId}`
  const current = state.nodes.find((node): node is WorkflowNode => node.id === id && node.kind === 'workflow')
  let workflow: WorkflowNode = current ?? {
    kind: 'workflow', id, seq: event.seq, runId, name: string(data.name, 'workflow'), status: 'running', children: [],
  }
  if (event.type === 'tool-workflow/agent-start') {
    workflow = {
      ...workflow,
      children: [...workflow.children, {
        seq: number(data.seq), label: string(data.label, 'agent'), childId: string(data.childId),
        ...(data.phase === undefined ? {} : { phase: string(data.phase) }),
      }],
    }
  } else if (event.type === 'tool-workflow/agent-end') {
    const memberSeq = number(data.seq)
    workflow = { ...workflow, children: workflow.children.map(child => child.seq === memberSeq ? { ...child, outcome: data.outcome } : child) }
  } else if (event.type === 'tool-workflow/run-end') {
    const reason = data.reason
    const kind = string(record(reason).kind)
    workflow = { ...workflow, status: kind === 'completed' ? 'success' : kind === 'error' ? 'error' : 'stopped', reason }
  }
  return {
    ...state, lastSeq: event.seq, nodes: replaceNode(state.nodes, workflow),
    workflowIndex: { ...state.workflowIndex, [runId]: id },
  }
}

function foldActivity(state: TranscriptState, event: EventLike): TranscriptState {
  const data = record(event.data)
  const family = event.type.split('/')[0]
  const activity: ActivityNode['activity'] = family === 'command' ? 'command' : family === 'compaction' ? 'compaction' : family === 'hook' ? 'hook' : 'retry'
  const key = string(data.commandId, string(data.compactionId, string(data.handlerId, string(data.retryId, `${activity}-${event.seq}`))))
  const id = `activity:${activity}:${key}`
  const ending = /(?:done|end|result|started)$/.test(event.type)
  const failed = data.error !== undefined || string(record(data.reason).kind) === 'error'
  const node: ActivityNode = {
    kind: 'activity', id, seq: event.seq, activity,
    label: string(data.name, string(data.point, activity)),
    status: failed ? 'error' : activity === 'retry' ? 'waiting' : ending ? 'success' : 'running',
    detail: event.data,
  }
  return { ...state, lastSeq: event.seq, nodes: replaceNode(state.nodes, node) }
}

/**
 * Fold a turn bracket into measured task time. Both boundaries carry the log's
 * own clock, so the span is read rather than sampled; an event that arrived
 * without a `time` contributes no span, because the fold never invents a
 * duration it was not given.
 */
function foldTurnBoundary(state: TranscriptState, event: EventLike): TranscriptState {
  const turn = number(record(event.data).turn)
  const at = typeof event.time === 'number' && Number.isFinite(event.time) ? event.time : undefined
  const { open, ...settled } = state.timing
  if (event.type === 'turn/start') {
    return { ...state, lastSeq: event.seq, timing: at === undefined ? settled : { ...settled, open: { turn, startedAt: at } } }
  }
  if (open === undefined || open.turn !== turn || at === undefined) return { ...state, lastSeq: event.seq, timing: settled }
  // A crash-repaired closer reuses the last real event's timestamp, so a span
  // is never negative in practice; clamping keeps a skewed clock from lying.
  const span = Math.max(0, at - open.startedAt)
  const reason = string(record(record(event.data).reason).kind)
  return {
    ...state,
    lastSeq: event.seq,
    timing: {
      measured: settled.measured + 1,
      workMs: settled.workMs + span,
      lastMs: span,
      ...(reason === '' ? {} : { lastReason: reason }),
    },
  }
}

function updateMetadata(state: TranscriptState, event: EventLike): TranscriptState {
  return { ...state, lastSeq: event.seq, metadata: { ...state.metadata, [event.type]: event.data } }
}

/** Pure, serializable event fold. Duplicate/old seqs are identity no-ops; gaps request a resnapshot. */
export function foldTranscript(state: TranscriptState, event: EventLike): TranscriptState {
  if (event.seq <= state.lastSeq) return state
  const expected = state.lastSeq + 1
  if (event.seq !== expected) return { ...state, gap: { expected, received: event.seq } }
  if (!KNOWN_EVENTS.has(event.type)) {
    const raw: RawNode = {
      kind: 'raw', id: `raw:${event.seq}`, seq: event.seq, eventType: event.type, data: event.data, required: event.ignorable !== true,
    }
    return { ...state, lastSeq: event.seq, nodes: [...state.nodes, raw] }
  }
  switch (event.type) {
    case 'turn/start':
    case 'turn/end': return foldTurnBoundary(state, event)
    case 'user/message': return foldUserMessage(state, event)
    case 'assistant/chunk': return foldChunk(state, event)
    case 'assistant/message': return foldAssistantMessage(state, event)
    case 'tool/call': return foldToolCall(state, event)
    case 'tool/result': return foldToolResult(state, event)
    case 'tool/code-dispatch-start':
    case 'tool/code-dispatch': return foldCodeDispatch(state, event)
    case 'tool-workflow/run-start':
    case 'tool-workflow/agent-start':
    case 'tool-workflow/agent-end':
    case 'tool-workflow/run-end': return foldWorkflow(state, event)
    case 'command/run':
    case 'command/done':
    case 'compaction/start':
    case 'compaction/end':
    case 'hook/invoked':
    case 'hook/result':
    case 'llm/retry':
    case 'llm/retry-started': return foldActivity(state, event)
    case 'todo/write':
    case 'request/header':
    case 'request/context':
    case 'agent-preset/selected':
    case 'approval/asked':
    case 'approval/decided':
    case 'approval/policy':
    case 'permission/preset':
    case 'sandbox/mode':
    case 'plan/mode':
    case 'goal/change':
    case 'session/title':
    case 'subagent/descriptor': return updateMetadata(state, event)
    default: return { ...state, lastSeq: event.seq }
  }
}

export function foldEvents(events: readonly EventLike[]): TranscriptState {
  return events.reduce(foldTranscript, EMPTY_TRANSCRIPT)
}
