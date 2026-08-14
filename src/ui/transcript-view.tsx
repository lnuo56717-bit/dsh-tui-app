import React from 'react'
import { Box, Text } from 'ink'
import type { ToolNode, TranscriptState } from '../transcript-fold.js'
import { presentReasoning } from './reasoning-view.js'
import { messageKey, toolKey, toolOutputText, type RowColor, type TranscriptRow } from './transcript-rows.js'
import type { Theme } from './theme.js'

/** One keyboard-selectable block: a message's text, a reasoning trace, or a tool's output. */
export interface TranscriptBlockRef {
  readonly key: string
  readonly kind: 'reasoning' | 'tool' | 'message'
  readonly nodeId: string
  /** Short human name for notices, e.g. `thought` or the tool name. */
  readonly label: string
  /** Raw source text, used for the detail view and for copying. */
  readonly text: string
  readonly running: boolean
}

export type ReasoningItem = TranscriptBlockRef

function toolBlocks(node: ToolNode): TranscriptBlockRef[] {
  return [
    { key: toolKey(node), kind: 'tool', nodeId: node.id, label: node.name, text: toolOutputText(node), running: node.status === 'running' },
    ...node.children.flatMap(toolBlocks),
  ]
}

/** Selectable blocks in visual order, so arrow navigation matches what is on screen. */
export function focusableBlocks(state: TranscriptState): TranscriptBlockRef[] {
  return state.nodes.flatMap((node): TranscriptBlockRef[] => {
    if (node.kind === 'tool') return toolBlocks(node)
    if (node.kind !== 'message') return []
    const prose = node.blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n\n')
    return [
      ...(prose.trim() === '' ? [] : [{
        key: messageKey(node.id),
        kind: 'message' as const,
        nodeId: node.id,
        label: node.role === 'user' ? 'prompt' : 'answer',
        text: prose,
        running: node.streaming,
      }]),
      ...node.blocks.flatMap((block, index) => block.type !== 'reasoning' ? [] : [{
        key: `${node.id}:reasoning:${index}`,
        kind: 'reasoning' as const,
        nodeId: node.id,
        label: 'thought',
        text: block.text,
        running: block.streaming === true,
      }]),
    ]
  })
}

export function reasoningItems(state: TranscriptState): TranscriptBlockRef[] {
  return focusableBlocks(state).filter(item => item.kind === 'reasoning')
}

function rowColor(color: RowColor | undefined, theme: Theme): Theme['text'] {
  return color === undefined ? theme.text : theme[color]
}

function Row({ row, theme }: { row: TranscriptRow; theme: Theme }): React.JSX.Element {
  if (row.segments.length === 0) return <Text> </Text>
  return <Text wrap="truncate">{row.segments.map((part, index) => (
    <Text key={index} color={rowColor(part.color, theme)}
      {...(part.bold === undefined ? {} : { bold: part.bold })}
      {...(part.italic === undefined ? {} : { italic: part.italic })}
      {...(part.strike === undefined ? {} : { strikethrough: part.strike })}>{part.text}</Text>
  ))}</Text>
}

/** Window geometry for a row-precise viewport. `offset` counts rows above the bottom. */
export function viewportWindow(total: number, viewport: number, offset: number): { start: number; end: number; maxOffset: number } {
  const rows = Math.max(1, viewport)
  const maxOffset = Math.max(0, total - rows)
  const clamped = Math.min(Math.max(0, offset), maxOffset)
  const end = Math.max(0, total - clamped)
  return { start: Math.max(0, end - rows), end, maxOffset }
}

/**
 * Proportional thumb for a fixed-width scrollbar column. The column is always
 * rendered so growing past the viewport never reflows the content width.
 */
export function scrollbarGlyphs(total: number, viewport: number, offset: number, plain: boolean): string[] {
  const rows = Math.max(1, viewport)
  if (total <= rows) return Array.from({ length: rows }, () => ' ')
  const track = plain ? '|' : '│'
  const thumb = plain ? '#' : '┃'
  const size = Math.max(1, Math.round(rows * rows / total))
  const span = rows - size
  const above = total - rows - Math.min(Math.max(0, offset), total - rows)
  const start = span === 0 ? 0 : Math.round(span * above / (total - rows))
  return Array.from({ length: rows }, (_, index) => index >= start && index < start + size ? thumb : track)
}

export function TranscriptView({ rows, viewport, offset, theme, plain = false }: {
  rows: readonly TranscriptRow[]
  viewport: number
  offset: number
  theme: Theme
  plain?: boolean
}): React.JSX.Element {
  const window = viewportWindow(rows.length, viewport, offset)
  const visible = rows.slice(window.start, window.end)
  const bar = scrollbarGlyphs(rows.length, viewport, offset, plain)
  return (
    <Box flexDirection="row">
      <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
        {visible.length === 0
          ? <Text color={theme.muted}>Event plane ready · waiting for a prompt</Text>
          : visible.map(row => <Row key={row.key} row={row} theme={theme} />)}
      </Box>
      <Box flexDirection="column" flexShrink={0} marginLeft={1}>
        {bar.slice(0, Math.max(visible.length, 1)).map((glyph, index) => (
          <Text key={index} color={theme.border}>{glyph}</Text>
        ))}
      </Box>
    </Box>
  )
}

export function ReasoningDetailView({ item, width, rows, offset, theme }: {
  item: ReasoningItem
  width: number
  rows: number
  offset: number
  theme: Theme
}): React.JSX.Element {
  const view = presentReasoning(item.text, {
    // Reserve one title row plus both possible scroll markers. This keeps the
    // detail view within its viewport even at a middle offset.
    running: item.running, width: Math.max(8, width - 4), mode: 'detail', offset, rows: Math.max(0, rows - 3),
  })
  let markerSlots = Math.max(0, rows - 1 - view.body.length)
  const showBefore = view.hasBefore && markerSlots-- > 0
  const showAfter = view.hasAfter && markerSlots > 0
  return <Box flexDirection="column">
    <Text bold color={theme.accent}>{item.running ? '◌ THINKING · LIVE DETAIL' : '◇ THOUGHT · DETAIL'}<Text color={theme.muted}> · {view.totalRows} rows</Text></Text>
    {showBefore && <Text color={theme.muted}>↑ earlier reasoning</Text>}
    {view.body.map((line, index) => <Text key={index} color={theme.muted} italic>│ {line === '' ? ' ' : line}</Text>)}
    {showAfter && <Text color={theme.muted}>↓ more reasoning · PgDn</Text>}
  </Box>
}
