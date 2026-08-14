import React from 'react'
import { Box, Text } from 'ink'
import type { MessageNode, ToolNode, TranscriptBlock, TranscriptNode, TranscriptState, WorkflowNode } from '../transcript-fold.js'
import { takeCells } from './display-width.js'
import { markdownToLines, type SegmentTone, type StyledLine } from './markdown.js'
import type { Theme } from './theme.js'

function toneColor(tone: SegmentTone, theme: Theme): Theme['text'] {
  if (tone === 'muted') return theme.muted
  if (tone === 'accent' || tone === 'link') return theme.accent
  if (tone === 'code') return theme.user
  if (tone === 'add') return theme.success
  if (tone === 'delete') return theme.danger
  return theme.text
}

function Styled({ line, theme }: { line: StyledLine; theme: Theme }): React.JSX.Element {
  if (line.segments.length === 0) return <Text> </Text>
  return <Text>{line.segments.map((part, index) => (
    <Text key={index} color={toneColor(part.tone, theme)}
      {...(part.bold === undefined ? {} : { bold: part.bold })}
      {...(part.italic === undefined ? {} : { italic: part.italic })}
      {...(part.strike === undefined ? {} : { strikethrough: part.strike })}>{part.text}</Text>
  ))}</Text>
}

function Markdown({ source, width, theme }: { source: string; width: number; theme: Theme }): React.JSX.Element {
  const lines = markdownToLines(source, Math.max(8, width))
  return <Box flexDirection="column">{lines.map((line, index) => <Styled key={index} line={line} theme={theme} />)}</Box>
}

function BlockView({ block, width, theme, toolIndex }: { block: TranscriptBlock; width: number; theme: Theme; toolIndex: TranscriptState['toolIndex'] }): React.JSX.Element | null {
  if (block.type === 'text') return <Markdown source={block.text} width={width} theme={theme} />
  if (block.type === 'reasoning') {
    const summary = block.text.replaceAll(/\s+/g, ' ').trim()
    return <Text color={theme.muted}>reasoning  [collapsed · {summary.length} chars]{summary === '' ? '' : `  ${takeCells(summary, Math.max(0, width - 38)).head}`}</Text>
  }
  if (block.type === 'tool-call') {
    if (block.id !== '' && toolIndex[block.id] !== undefined) return null
    return <Text color={theme.warning}>preparing {block.name || 'tool'}  {takeCells(block.arguments, Math.max(0, width - 18)).head}</Text>
  }
  if (block.type === 'image') return <Text color={theme.muted}>[image] {block.label}</Text>
  return <Text color={theme.warning}>[raw block: {block.blockType}] {takeCells(safeJson(block.value), Math.max(0, width - 20)).head}</Text>
}

function MessageView({ node, width, theme, toolIndex }: { node: MessageNode; width: number; theme: Theme; toolIndex: TranscriptState['toolIndex'] }): React.JSX.Element {
  const user = node.role === 'user'
  const sourceSuffix = user && node.source !== 'user' ? ` · ${node.source}` : ''
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={user ? theme.user : theme.primary} bold>{user ? 'YOU' : 'DEEPSEEK'}{sourceSuffix}{node.streaming ? '  ◌ streaming' : ''}</Text>
      <Box flexDirection="column" paddingLeft={2}>
        {node.blocks.length === 0 ? <Text color={theme.muted}>[empty message]</Text> : node.blocks.map((block, index) => (
          <BlockView key={index} block={block} width={Math.max(8, width - 2)} theme={theme} toolIndex={toolIndex} />
        ))}
      </Box>
    </Box>
  )
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

function DiffView({ diff, width, theme }: { diff: string; width: number; theme: Theme }): React.JSX.Element {
  return <Box flexDirection="column">{diff.split('\n').slice(0, 80).map((line, index) => {
    const tone = line.startsWith('+') && !line.startsWith('+++') ? theme.success
      : line.startsWith('-') && !line.startsWith('---') ? theme.danger
        : line.startsWith('@@') ? theme.accent : theme.muted
    return <Text key={index} color={tone}>{takeCells(line, width).head}</Text>
  })}</Box>
}

function statusGlyph(node: ToolNode, theme: Theme): { glyph: string; color: Theme['text'] } {
  if (node.status === 'running') return { glyph: '◌', color: theme.accent }
  if (node.status === 'success') return { glyph: '✓', color: theme.success }
  if (node.status === 'error') return { glyph: '×', color: theme.danger }
  return { glyph: '!', color: theme.warning }
}

function ToolView({ node, width, theme, compact, depth = 0 }: { node: ToolNode; width: number; theme: Theme; compact: boolean; depth?: number }): React.JSX.Element {
  const status = statusGlyph(node, theme)
  const branch = depth === 0 ? '└─' : '  ├─'
  const diff = findDiff(node.meta) ?? findDiff(node.result)
  const summary = argumentsSummary(node.arguments, width - node.name.length - 10)
  if (compact) return <Text><Text color={theme.border}>{branch} </Text><Text color={status.color}>{status.glyph} </Text><Text bold color={theme.text}>{node.name}</Text><Text color={theme.muted}>  {summary}</Text></Text>
  return (
    <Box flexDirection="column" marginBottom={depth === 0 ? 1 : 0}>
      <Text><Text color={theme.border}>{branch} </Text><Text color={status.color}>{status.glyph} </Text><Text bold color={theme.text}>{node.name}</Text><Text color={theme.muted}>  {summary}</Text></Text>
      {diff !== undefined ? <Box paddingLeft={4}><DiffView diff={diff} width={Math.max(8, width - 4)} theme={theme} /></Box> : node.result.map((block, index) => (
        <Box key={index} paddingLeft={4}><BlockView block={block} width={Math.max(8, width - 4)} theme={theme} toolIndex={{}} /></Box>
      ))}
      {node.meta !== undefined && diff === undefined && <Text color={theme.muted}>    raw metadata  {takeCells(safeJson(node.meta), Math.max(0, width - 18)).head}</Text>}
      {node.children.map(child => <Box key={child.id} paddingLeft={2}><ToolView node={child} width={Math.max(8, width - 2)} theme={theme} compact={compact} depth={depth + 1} /></Box>)}
    </Box>
  )
}

function WorkflowView({ node, width, theme, compact }: { node: WorkflowNode; width: number; theme: Theme; compact: boolean }): React.JSX.Element {
  const color = node.status === 'running' ? theme.accent : node.status === 'success' ? theme.success : node.status === 'error' ? theme.danger : theme.warning
  if (compact) return <Text color={color}>◇ workflow  <Text bold>{node.name}</Text>  {node.status} · {node.children.length} jobs</Text>
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={color}>◇ workflow  <Text bold>{node.name}</Text>  {node.status}</Text>
      {node.children.map(child => <Text key={`${child.seq}:${child.childId}`} color={child.outcome === undefined ? theme.muted : theme.text}>  ├─ {child.label}{child.phase === undefined ? '' : ` · ${child.phase}`}  {child.outcome === undefined ? 'running' : takeCells(safeJson(child.outcome), Math.max(0, width - child.label.length - 16)).head}</Text>)}
    </Box>
  )
}

function safeJson(value: unknown): string {
  try { return JSON.stringify(value) ?? String(value) } catch { return '[unserializable]' }
}

function NodeView({ node, width, theme, state, compact }: { node: TranscriptNode; width: number; theme: Theme; state: TranscriptState; compact: boolean }): React.JSX.Element {
  if (node.kind === 'message') return <MessageView node={node} width={width} theme={theme} toolIndex={state.toolIndex} />
  if (node.kind === 'tool') return <ToolView node={node} width={width} theme={theme} compact={compact} />
  if (node.kind === 'workflow') return <WorkflowView node={node} width={width} theme={theme} compact={compact} />
  if (node.kind === 'activity') {
    const color = node.status === 'error' ? theme.danger : node.status === 'success' ? theme.success : theme.accent
    return <Text color={color}>· {node.activity}  {node.label}  {node.status}</Text>
  }
  return <Text color={node.required ? theme.danger : theme.warning}>raw event #{node.seq} · {node.eventType}  {takeCells(safeJson(node.data), Math.max(0, width - node.eventType.length - 22)).head}</Text>
}

export function TranscriptView({ state, width, nodeBudget, offset, theme, compact = false }: { state: TranscriptState; width: number; nodeBudget: number; offset: number; theme: Theme; compact?: boolean }): React.JSX.Element {
  const end = Math.max(0, state.nodes.length - offset)
  const start = Math.max(0, end - Math.max(1, nodeBudget))
  const visible = state.nodes.slice(start, end)
  return (
    <Box flexDirection="column">
      {start > 0 && <Text color={theme.muted}>↑ {start} earlier nodes</Text>}
      {visible.length === 0 ? <Text color={theme.muted}>Event plane ready · waiting for a prompt</Text> : visible.map(node => <NodeView key={node.id} node={node} width={width} theme={theme} state={state} compact={compact} />)}
      {offset > 0 && <Text color={theme.muted}>↓ {offset} newer nodes</Text>}
    </Box>
  )
}
