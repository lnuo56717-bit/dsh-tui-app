import type { MessageNode, ToolNode, TranscriptBlock, TranscriptNode, TranscriptState, WorkflowNode } from '../transcript-fold.js'
import { displayWidth, graphemes, takeCells } from './display-width.js'
import { markdownToLines, type SegmentTone } from './markdown.js'
import { presentReasoning } from './reasoning-view.js'
import { redactSecretValue } from './secrets.js'

export type RowColor = 'text' | 'muted' | 'accent' | 'primary' | 'user' | 'success' | 'warning' | 'danger' | 'border'

export interface RowSegment {
  readonly text: string
  readonly color?: RowColor
  readonly bold?: boolean
  readonly italic?: boolean
  readonly strike?: boolean
}

/** One terminal line. The transcript viewport is a window over these, never over nodes. */
export interface TranscriptRow {
  readonly key: string
  readonly nodeId: string
  readonly segments: readonly RowSegment[]
}

export interface RowOptions {
  readonly width: number
  readonly compact: boolean
  /** Keys of blocks the reader opened: `<nodeId>:reasoning:<i>` or `tool:<nodeId>`. */
  readonly expandedBlocks: ReadonlySet<string>
  readonly focusedBlockKey?: string | undefined
  readonly thinkingGlyph: string
}

interface BuildOptions extends RowOptions {
  readonly toolIndex: TranscriptState['toolIndex']
}

const REASONING_PREVIEW_ROWS = 3
/** Rows of tool output shown before the reader asks for the rest. */
export const TOOL_PREVIEW_ROWS = 6
/** Hard ceiling on one expanded tool body, so a huge file cannot stall the flattener. */
export const TOOL_MAX_ROWS = 500

export function toolKey(node: Pick<ToolNode, 'id'>): string {
  return `tool:${node.id}`
}

export function messageKey(nodeId: string): string {
  return `${nodeId}:message`
}

function toneColor(tone: SegmentTone): RowColor {
  if (tone === 'muted') return 'muted'
  if (tone === 'accent' || tone === 'link') return 'accent'
  if (tone === 'code') return 'user'
  if (tone === 'add') return 'success'
  if (tone === 'delete') return 'danger'
  return 'text'
}

function pad(indent: number): RowSegment[] {
  return indent <= 0 ? [] : [{ text: ' '.repeat(indent), color: 'muted' }]
}

class NodeRows {
  private readonly rows: RowSegment[][] = []

  push(segments: RowSegment[]): void {
    this.rows.push(segments)
  }

  blank(): void {
    this.rows.push([])
  }

  /** Raw segment rows, for a caller that needs to cap or re-emit them. */
  take(): readonly RowSegment[][] {
    return this.rows
  }

  collect(nodeId: string): TranscriptRow[] {
    return this.rows.map((segments, index) => ({ key: `${nodeId}#${index}`, nodeId, segments }))
  }
}

function safeJson(value: unknown): string {
  return redactSecretValue(value)
}

function argumentsSummary(raw: string, cells: number): string {
  let summary = raw
  try {
    const value = JSON.parse(raw) as unknown
    summary = typeof value === 'object' && value !== null
      ? Object.entries(value as Record<string, unknown>).slice(0, 3).map(([key, item]) => `${key}=${typeof item === 'string' ? item : safeJson(item)}`).join('  ')
      : String(value)
  } catch {}
  return takeCells(summary.replaceAll(/\s+/g, ' '), Math.max(0, cells)).head
}

function findDiff(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || value === null || typeof value !== 'object') return undefined
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((key === 'diff' || key === 'patch' || key === 'unifiedDiff') && typeof child === 'string') return child
    const nested = findDiff(child, depth + 1)
    if (nested !== undefined) return nested
  }
  return undefined
}

/**
 * A tool's output as the host produced it — the diff when there is one, else the
 * concatenated result blocks. This is what a copy hands to the clipboard, so it
 * carries no view chrome, prefixes, or truncation.
 */
export function toolOutputText(node: ToolNode): string {
  const diff = findDiff(node.meta) ?? findDiff(node.result)
  if (diff !== undefined) return diff
  return node.result.map(block => {
    if (block.type === 'text' || block.type === 'reasoning') return block.text
    if (block.type === 'image') return `[image] ${block.label}`
    if (block.type === 'tool-call') return `${block.name} ${block.arguments}`
    return safeJson(block.value)
  }).join('\n')
}

function statusGlyph(node: ToolNode): { glyph: string; color: RowColor } {
  if (node.status === 'running') return { glyph: '◌', color: 'accent' }
  if (node.status === 'success') return { glyph: '✓', color: 'success' }
  if (node.status === 'error') return { glyph: '×', color: 'danger' }
  return { glyph: '!', color: 'warning' }
}

function emitMarkdown(out: NodeRows, source: string, width: number, indent: number): void {
  const lines = markdownToLines(source, Math.max(8, width))
  if (lines.length === 0) {
    out.blank()
    return
  }
  for (const line of lines) {
    out.push([...pad(indent), ...line.segments.map(part => ({
      text: part.text,
      color: toneColor(part.tone),
      ...(part.bold === undefined ? {} : { bold: part.bold }),
      ...(part.italic === undefined ? {} : { italic: part.italic }),
      ...(part.strike === undefined ? {} : { strike: part.strike }),
    }))])
  }
}

/**
 * Tool output is preformatted, not prose: file content keeps its own line breaks
 * and indentation instead of being re-flowed as a Markdown paragraph. It also
 * makes the folded row count mean what it says.
 */
function emitPreformatted(out: NodeRows, source: string, width: number, indent: number): void {
  const cells = Math.max(1, width)
  const lines = source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
  for (const line of lines) {
    if (line === '') {
      out.push([...pad(indent)])
      continue
    }
    let rest = line
    while (rest !== '') {
      const part = takeCells(rest, cells)
      const head = part.head === '' ? graphemes(rest)[0] ?? '' : part.head
      out.push([...pad(indent), { text: head, color: 'text' }])
      rest = part.head === '' ? rest.slice(head.length) : part.tail
    }
  }
}

interface ReasoningFlags {
  readonly running: boolean
  readonly expanded: boolean
  readonly focused: boolean
  readonly thinkingGlyph: string
}

function emitReasoning(out: NodeRows, text: string, width: number, indent: number, flags: ReasoningFlags): void {
  const label = flags.running ? 'Thinking' : 'Thought'
  const marker = flags.running ? flags.thinkingGlyph : flags.expanded ? '⌄' : '◇'
  const facts = presentReasoning(text, { running: flags.running, width: Math.max(8, width), mode: 'collapsed', offset: 0, rows: 0 })
  const meta = facts.totalRows > 1 ? ` · ${facts.totalRows} lines` : ''
  const fullLead = `${flags.focused ? '› ' : '  '}${marker} ${label} · `
  const lead = displayWidth(fullLead) <= width ? fullLead : `${flags.focused ? '›' : ' '} ${marker} `
  const fullHint = `${meta}${flags.focused ? ' · Enter full' : ''}`
  const hint = displayWidth(lead) + displayWidth(fullHint) + 4 <= width ? fullHint : ''
  const summary = facts.summary === '' ? (flags.running ? 'waiting for reasoning tokens…' : 'empty') : facts.summary
  const clipped = takeCells(summary, Math.max(0, width - displayWidth(lead) - displayWidth(hint))).head
  const color: RowColor = flags.focused ? 'accent' : 'muted'
  const head: RowSegment[] = [...pad(indent), { text: lead, color }, { text: clipped, color, italic: true }, { text: hint, color }]

  // Grok Truncated: a live thought shows its latest lines without requiring
  // expansion. Settled thoughts stay one row until previewed or opened.
  out.push(head)
  if (!flags.expanded && !flags.running) return

  const bodyWidth = Math.max(8, width - 4)
  const first = presentReasoning(text, { running: flags.running, width: bodyWidth, mode: 'expanded', offset: 0, rows: REASONING_PREVIEW_ROWS })
  const offset = flags.running ? Math.max(0, first.totalRows - REASONING_PREVIEW_ROWS) : 0
  const preview = presentReasoning(text, { running: flags.running, width: bodyWidth, mode: 'expanded', offset, rows: REASONING_PREVIEW_ROWS })
  if (preview.hasBefore) out.push([...pad(indent), { text: '    │ … earlier reasoning', color: 'muted' }])
  for (const line of preview.body) {
    out.push([...pad(indent), { text: '    │ ', color: 'muted' }, { text: line === '' ? ' ' : line, color: 'muted', italic: true }])
  }
  if (preview.hasAfter) {
    out.push([...pad(indent), { text: `    │ … ${preview.totalRows - offset - preview.body.length} more lines · Enter full`, color: 'muted' }])
  }
}

function emitBlock(out: NodeRows, block: TranscriptBlock, width: number, indent: number, toolIndex: TranscriptState['toolIndex'], reasoning?: ReasoningFlags, preformatted = false): void {
  if (block.type === 'text') {
    if (preformatted) emitPreformatted(out, block.text, width, indent)
    else emitMarkdown(out, block.text, width, indent)
    return
  }
  if (block.type === 'reasoning') {
    emitReasoning(out, block.text, width, indent, reasoning ?? { running: false, expanded: false, focused: false, thinkingGlyph: '◌' })
    return
  }
  if (block.type === 'tool-call') {
    if (block.id !== '' && toolIndex[block.id] !== undefined) return
    out.push([...pad(indent), { text: `preparing ${block.name || 'tool'}  ${takeCells(block.arguments, Math.max(0, width - 18)).head}`, color: 'warning' }])
    return
  }
  if (block.type === 'image') {
    out.push([...pad(indent), { text: `[image] ${takeCells(block.label, Math.max(0, width - 8)).head}`, color: 'muted' }])
    return
  }
  out.push([...pad(indent), {
    text: `[raw block: ${block.blockType}] ${takeCells(safeJson(block.value), Math.max(0, width - displayWidth(block.blockType) - 20)).head}`,
    color: 'warning',
  }])
}

function emitMessage(out: NodeRows, node: MessageNode, width: number, options: BuildOptions): void {
  const user = node.role === 'user'
  const sourceSuffix = user && node.source !== 'user' ? ` · ${node.source}` : ''
  const focused = options.focusedBlockKey === messageKey(node.id)
  out.push([
    ...(focused ? [{ text: '› ', color: 'accent' as RowColor }] : []),
    {
      text: `${user ? 'YOU' : 'DEEPSEEK'}${sourceSuffix}${node.streaming ? '  ◌ streaming' : ''}${focused ? '  Ctrl+Y copy' : ''}`,
      color: focused ? 'accent' : user ? 'user' : 'primary',
      bold: true,
    },
  ])
  if (node.blocks.length === 0) out.push([...pad(2), { text: '[empty message]', color: 'muted' }])
  else {
    node.blocks.forEach((block, index) => {
      const key = `${node.id}:reasoning:${index}`
      emitBlock(out, block, Math.max(8, width - 2), 2, options.toolIndex, block.type !== 'reasoning' ? undefined : {
        running: block.streaming === true,
        expanded: options.expandedBlocks.has(key),
        focused: options.focusedBlockKey === key,
        thinkingGlyph: options.thinkingGlyph,
      })
    })
  }
  out.blank()
}

function emitDiff(out: NodeRows, diff: string, width: number, indent: number): void {
  for (const line of diff.split('\n').slice(0, 80)) {
    const color: RowColor = line.startsWith('+') && !line.startsWith('+++') ? 'success'
      : line.startsWith('-') && !line.startsWith('---') ? 'danger'
        : line.startsWith('@@') ? 'accent' : 'muted'
    out.push([...pad(indent), { text: takeCells(line, Math.max(0, width)).head, color }])
  }
}

function emitTool(out: NodeRows, node: ToolNode, width: number, options: BuildOptions, indent: number, depth = 0): void {
  const status = statusGlyph(node)
  const key = toolKey(node)
  const focused = options.focusedBlockKey === key
  const expanded = options.expandedBlocks.has(key)
  const branch = `${focused ? '›' : ' '}${depth === 0 ? '└─' : ' ├─'}`

  // Render the body first: its real row count decides the header's size hint.
  const body = new NodeRows()
  const diff = findDiff(node.meta) ?? findDiff(node.result)
  if (diff !== undefined) emitDiff(body, diff, Math.max(8, width - 4), indent + 4)
  else for (const block of node.result) emitBlock(body, block, Math.max(8, width - 4), indent + 4, {}, undefined, true)
  if (node.meta !== undefined && diff === undefined) {
    body.push([...pad(indent), { text: `    raw metadata  ${takeCells(safeJson(node.meta), Math.max(0, width - 18)).head}`, color: 'muted' }])
  }
  const rows = body.take()
  // A narrow terminal keeps tools at one line until the reader opens one.
  const preview = options.compact ? 0 : TOOL_PREVIEW_ROWS
  const shown = Math.min(rows.length, expanded ? TOOL_MAX_ROWS : preview)
  const hidden = rows.length - shown
  const size = hidden > 0 ? ` · ${rows.length} lines` : ''
  const summary = argumentsSummary(node.arguments, width - displayWidth(node.name) - displayWidth(size) - 12)
  out.push([
    ...pad(indent),
    { text: `${branch} `, color: 'border' },
    { text: `${status.glyph} `, color: status.color },
    { text: node.name, color: focused ? 'accent' : 'text', bold: true },
    { text: `  ${summary}`, color: 'muted' },
    { text: size, color: 'accent' },
  ])

  for (const row of rows.slice(0, shown)) out.push(row)
  if (hidden > 0 && (!options.compact || focused)) {
    out.push([...pad(indent), {
      text: `    … ${hidden} more lines${expanded ? ' · output capped' : `${focused ? ' · → expand · Ctrl+Y copy' : ' · Tab then → to expand'}`}`,
      color: focused ? 'accent' : 'muted',
    }])
  }
  for (const child of node.children) emitTool(out, child, Math.max(8, width - 2), options, indent + 2, depth + 1)
  if (depth === 0 && !options.compact) out.blank()
}

function emitWorkflow(out: NodeRows, node: WorkflowNode, width: number, compact: boolean): void {
  const color: RowColor = node.status === 'running' ? 'accent' : node.status === 'success' ? 'success' : node.status === 'error' ? 'danger' : 'warning'
  if (compact) {
    out.push([{ text: '◇ workflow  ', color }, { text: node.name, color, bold: true }, { text: `  ${node.status} · ${node.children.length} jobs`, color }])
    return
  }
  out.push([{ text: '◇ workflow  ', color }, { text: node.name, color, bold: true }, { text: `  ${node.status}`, color }])
  for (const child of node.children) {
    const detail = child.outcome === undefined ? 'running' : takeCells(safeJson(child.outcome), Math.max(0, width - displayWidth(child.label) - 16)).head
    out.push([{
      text: `  ├─ ${child.label}${child.phase === undefined ? '' : ` · ${child.phase}`}  ${detail}`,
      color: child.outcome === undefined ? 'muted' : 'text',
    }])
  }
  out.blank()
}

function buildNodeRows(node: TranscriptNode, options: BuildOptions): TranscriptRow[] {
  const out = new NodeRows()
  const width = Math.max(8, options.width)
  if (node.kind === 'message') emitMessage(out, node, width, options)
  else if (node.kind === 'tool') emitTool(out, node, width, options, 0)
  else if (node.kind === 'workflow') emitWorkflow(out, node, width, options.compact)
  else if (node.kind === 'activity') {
    const color: RowColor = node.status === 'error' ? 'danger' : node.status === 'success' ? 'success' : 'accent'
    out.push([{ text: takeCells(`· ${node.activity}  ${node.label}  ${node.status}`, width).head, color }])
  } else {
    out.push([{
      text: `raw event #${node.seq} · ${node.eventType}  ${takeCells(safeJson(node.data), Math.max(0, width - displayWidth(node.eventType) - 22)).head}`,
      color: node.required ? 'danger' : 'warning',
    }])
  }
  return out.collect(node.id)
}

/**
 * Per-node row memo. `foldTranscript` reuses untouched node objects, so a
 * streaming turn only re-flattens the node that actually changed.
 */
const nodeCache = new WeakMap<TranscriptNode, { signature: string; rows: TranscriptRow[] }>()

function blockSignature(key: string, options: RowOptions): string {
  return `${options.expandedBlocks.has(key) ? 'e' : ''}${options.focusedBlockKey === key ? 'f' : ''}`
}

function nodeSignature(node: TranscriptNode, options: RowOptions): string {
  const blocks = node.kind === 'message'
    ? [blockSignature(messageKey(node.id), options), ...node.blocks.map((block, index) => block.type !== 'reasoning' ? '' : blockSignature(`${node.id}:reasoning:${index}`, options))].join(',')
    : node.kind === 'tool' ? toolSignature(node, options) : ''
  return `${options.width}|${options.compact ? 'c' : 'w'}|${options.thinkingGlyph}|${blocks}`
}

function toolSignature(node: ToolNode, options: RowOptions): string {
  return [blockSignature(toolKey(node), options), ...node.children.map(child => toolSignature(child, options))].join(',')
}

/** Flatten the whole transcript into exact terminal rows, newest last. */
export function transcriptRows(state: TranscriptState, options: RowOptions): TranscriptRow[] {
  const rows: TranscriptRow[] = []
  for (const node of state.nodes) {
    const signature = nodeSignature(node, options)
    const cached = nodeCache.get(node)
    if (cached !== undefined && cached.signature === signature) {
      rows.push(...cached.rows)
      continue
    }
    const built = buildNodeRows(node, { ...options, toolIndex: state.toolIndex })
    nodeCache.set(node, { signature, rows: built })
    rows.push(...built)
  }
  return rows
}
