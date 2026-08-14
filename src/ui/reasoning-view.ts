import { graphemes, takeCells } from './display-width.js'

export type ReasoningMode = 'collapsed' | 'expanded' | 'detail'

export interface ReasoningPresentationOptions {
  readonly running: boolean
  readonly width: number
  readonly mode: ReasoningMode
  readonly offset: number
  readonly rows: number
}

export interface ReasoningPresentation {
  /** Stable first line when settled; live tail while reasoning is streaming. */
  readonly summary: string
  /** Display-cell wrapped window. Collapsed mode intentionally exposes no body. */
  readonly body: readonly string[]
  readonly totalRows: number
  readonly hasBefore: boolean
  readonly hasAfter: boolean
}

function wrappedRows(text: string, width: number): string[] {
  const cells = Math.max(1, width)
  const rows: string[] = []
  const logicalLines = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
  while (logicalLines[0]?.trim() === '') logicalLines.shift()
  while (logicalLines.at(-1)?.trim() === '') logicalLines.pop()
  for (const logical of logicalLines) {
    if (logical === '') {
      rows.push('')
      continue
    }
    let rest = logical
    while (rest !== '') {
      const part = takeCells(rest, cells)
      // A defensive fallback for a terminal-width implementation that reports
      // one grapheme wider than the supplied viewport.
      if (part.head === '') {
        const first = graphemes(rest)[0] ?? ''
        rows.push(first)
        rest = rest.slice(first.length)
      } else {
        rows.push(part.head)
        rest = part.tail
      }
    }
  }
  return rows
}

function summaryLine(text: string, running: boolean, width: number): string {
  const nonEmpty = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
    .map(line => line.trim()).filter(line => line !== '')
  const summary = running ? nonEmpty.at(-1) ?? '' : nonEmpty[0] ?? ''
  return takeCells(summary, Math.max(1, width)).head
}

/**
 * Project a real Harness reasoning block into collapsed, bounded-inline, or
 * independently scrollable detail form. This is view state only: source text
 * and transcript order are never rewritten.
 */
export function presentReasoning(text: string, options: ReasoningPresentationOptions): ReasoningPresentation {
  const rows = wrappedRows(text, options.width)
  const offset = Math.min(rows.length, Math.max(0, options.offset))
  const rowCount = Math.max(0, options.rows)
  const collapsed = options.mode === 'collapsed'
  const body = collapsed ? [] : rows.slice(offset, offset + rowCount)
  return {
    summary: summaryLine(text, options.running, options.width),
    body,
    totalRows: rows.length,
    hasBefore: offset > 0,
    hasAfter: collapsed ? rows.length > 1 : offset + body.length < rows.length,
  }
}
