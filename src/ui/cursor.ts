import { displayWidth } from './display-width.js'
import type { EditorLine } from './editor.js'

export const CURSOR_SHOW = '\u001B[?25h'
export const CURSOR_HIDE = '\u001B[?25l'

export function moveCursorSequence(row: number, column: number): string {
  return `\u001B[${Math.max(1, Math.round(row))};${Math.max(1, Math.round(column))}H`
}

export interface CaretPosition {
  /** One-based terminal row. */
  readonly row: number
  /** One-based terminal column. */
  readonly column: number
}

/**
 * Where the hardware cursor must sit for the composer caret.
 *
 * An IME draws its pre-edit text at the terminal's own cursor, not at whatever
 * the app paints. The composer is measured from the bottom edge because
 * everything below it has a fixed height: two footer rows, then the composer's
 * own bottom border, then its editor rows.
 */
export function composerCaret(input: {
  readonly rows: number
  readonly margin: number
  readonly lines: readonly EditorLine[]
}): CaretPosition | undefined {
  const index = input.lines.findIndex(line => line.hasCursor)
  if (index < 0) return undefined
  const row = input.rows - 2 - input.lines.length + index
  // border + horizontal padding + the two-cell composer prefix, then the typed
  // cells that render before the caret segment.
  let cells = 0
  for (const segment of input.lines[index]!.segments) {
    if (segment.caret) break
    cells += displayWidth(segment.text)
  }
  const column = input.margin + 5 + cells
  return row < 1 ? undefined : { row, column }
}
