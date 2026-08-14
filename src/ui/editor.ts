import { displayWidth, graphemes } from './display-width.js'

export interface EditorSelection {
  /** Grapheme indices [start, end) inside `text`. */
  readonly start: number
  readonly end: number
}

export interface EditorState {
  readonly text: string
  readonly cursor: number
  readonly multiline: boolean
  /** Mouse/Shift selection; absent when nothing is selected. */
  readonly selection?: EditorSelection | undefined
}

export const EMPTY_EDITOR: EditorState = Object.freeze({ text: '', cursor: 0, multiline: false })

function deleteSelection(state: EditorState): EditorState {
  const selection = state.selection
  if (selection === undefined || selection.end === selection.start) {
    return { ...state, selection: undefined }
  }
  const units = graphemes(state.text)
  units.splice(selection.start, selection.end - selection.start)
  return { ...state, text: units.join(''), cursor: selection.start, selection: undefined }
}

export function insertText(state: EditorState, input: string): EditorState {
  const base = deleteSelection(state)
  const units = graphemes(base.text)
  units.splice(base.cursor, 0, input)
  return { ...base, text: units.join(''), cursor: base.cursor + graphemes(input).length }
}

export function moveCursor(state: EditorState, delta: number): EditorState {
  if (state.selection !== undefined && state.selection.end !== state.selection.start) {
    return { ...state, cursor: delta < 0 ? state.selection.start : state.selection.end, selection: undefined }
  }
  return { ...state, cursor: Math.max(0, Math.min(graphemes(state.text).length, state.cursor + delta)) }
}

export function moveCursorTo(state: EditorState, edge: 'start' | 'end'): EditorState {
  return { ...state, cursor: edge === 'start' ? 0 : graphemes(state.text).length, selection: undefined }
}

export function backspace(state: EditorState): EditorState {
  if (state.selection !== undefined && state.selection.end !== state.selection.start) return deleteSelection(state)
  if (state.cursor === 0) return state
  const units = graphemes(state.text)
  units.splice(state.cursor - 1, 1)
  return { ...state, text: units.join(''), cursor: state.cursor - 1 }
}

export function deleteForward(state: EditorState): EditorState {
  if (state.selection !== undefined && state.selection.end !== state.selection.start) return deleteSelection(state)
  const units = graphemes(state.text)
  if (state.cursor >= units.length) return state
  units.splice(state.cursor, 1)
  return { ...state, text: units.join('') }
}

export function deleteToStart(state: EditorState): EditorState {
  const base = deleteSelection(state)
  if (base.text !== state.text) return base
  const units = graphemes(base.text)
  return { ...base, text: units.slice(base.cursor).join(''), cursor: 0 }
}

export function deleteToEnd(state: EditorState): EditorState {
  const base = deleteSelection(state)
  if (base.text !== state.text) return base
  return { ...base, text: graphemes(base.text).slice(0, base.cursor).join('') }
}

export function deleteWord(state: EditorState): EditorState {
  const base = deleteSelection(state)
  if (base.text !== state.text) return base
  if (base.cursor === 0) return base
  const units = graphemes(base.text)
  let start = base.cursor
  while (start > 0 && /\s/u.test(units[start - 1]!)) start -= 1
  while (start > 0 && !/\s/u.test(units[start - 1]!)) start -= 1
  units.splice(start, base.cursor - start)
  return { ...base, text: units.join(''), cursor: start }
}

export function cursorParts(state: EditorState): { before: string; current: string; after: string } {
  const units = graphemes(state.text)
  return {
    before: units.slice(0, state.cursor).join(''),
    current: units[state.cursor] ?? ' ',
    after: units.slice(state.cursor + (state.cursor < units.length ? 1 : 0)).join(''),
  }
}

export interface EditorLineSegment {
  /** Plain text of the segment; the caret segment may be a phantom space. */
  readonly text: string
  /** Whether the cells belong to the selection and should render inverse. */
  readonly selected: boolean
  /** Whether the segment carries the painted caret. */
  readonly caret: boolean
}

export interface EditorLine {
  /** Render pieces in order; `selected` pieces paint inverse, `caret` paints the caret. */
  readonly segments: readonly EditorLineSegment[]
  /** The real graphemes of this wrapped line, phantom caret cell excluded. */
  readonly units: readonly string[]
  readonly hasCursor: boolean
  readonly hasSelection: boolean
}

function buildLine(units: readonly string[], caretIndex: number | undefined, selection: { start: number; end: number } | undefined): EditorLine {
  const segments: EditorLineSegment[] = []
  const start = Math.max(0, Math.min(selection?.start ?? 0, units.length))
  const end = Math.max(0, Math.min(selection?.end ?? 0, units.length))
  const hasSelection = selection !== undefined && end > start
  const inSelection = (index: number): boolean => hasSelection && index >= start && index < end
  const push = (text: string, selected: boolean, caret: boolean): void => {
    if (text !== '' || caret) segments.push({ text: caret && text === '' ? ' ' : text, selected, caret })
  }
  let run = ''
  let runSelected = false
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index]!
    const selected = inSelection(index)
    if (caretIndex === index) {
      push(run, runSelected, false)
      push(unit, selected, true)
      run = ''
      runSelected = false
      continue
    }
    if (run === '') runSelected = selected
    else if (runSelected !== selected) {
      push(run, runSelected, false)
      run = ''
      runSelected = selected
    }
    run += unit
  }
  if (caretIndex === units.length) {
    push(run, runSelected, false)
    push('', false, true)
  } else {
    push(run, runSelected, false)
  }
  return { segments, units, hasCursor: caretIndex !== undefined, hasSelection }
}

export interface EditorLayout {
  /** The visible editor rows, newest wrap line last. */
  readonly lines: readonly EditorLine[]
  /** Grapheme index in `state.text` where each visible line begins. */
  readonly starts: readonly number[]
  /** Index of the first visible text line (window offset over wrapped lines). */
  readonly from: number
}

/** Wrap the draft by terminal display cells, keeping the caret and selection on real graphemes. */
export function layoutEditor(state: EditorState, width: number, maxRows = 3): EditorLayout {
  const cells = Math.max(1, width - 2)
  const units = graphemes(state.text)
  const rows: string[] = []
  const starts: number[] = [0]
  let line = ''
  let lineWidth = 0
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index]!
    if (state.multiline && unit === '\n') {
      rows.push(line)
      line = ''
      lineWidth = 0
      starts.push(index + 1)
      continue
    }
    const unitWidth = Math.max(1, displayWidth(unit))
    if (line !== '' && lineWidth + unitWidth > cells) {
      rows.push(line)
      line = unit
      lineWidth = unitWidth
      starts.push(index)
    } else {
      line += unit
      lineWidth += unitWidth
    }
  }
  rows.push(line)

  let cursorRow = 0
  for (let index = 1; index < starts.length; index += 1) {
    if (state.cursor >= starts[index]!) cursorRow = index
    else break
  }
  const window = Math.max(1, maxRows)
  const from = Math.max(0, Math.min(cursorRow - window + 1, Math.max(0, rows.length - window)))
  const visible: EditorLine[] = []
  for (let row = from; row < Math.min(rows.length, from + window); row += 1) {
    const lineStart = starts[row]!
    const lineUnits = graphemes(rows[row]!)
    const selection = state.selection === undefined ? undefined : {
      start: Math.max(0, Math.min(state.selection.start - lineStart, lineUnits.length)),
      end: Math.max(0, Math.min(state.selection.end - lineStart, lineUnits.length)),
    }
    const caret = row === cursorRow ? Math.max(0, Math.min(lineUnits.length, state.cursor - lineStart)) : undefined
    visible.push(buildLine(lineUnits, caret, selection))
  }
  return { lines: visible, starts: starts.slice(from), from }
}

/** Mirror of the previous editor API: the visible rows of `layoutEditor`. */
export function presentEditor(state: EditorState, width: number, maxRows = 3): readonly EditorLine[] {
  return layoutEditor(state, width, maxRows).lines
}

/**
 * Map a click inside a visible editor line to a grapheme cursor position.
 * `cells` is the zero-based cell offset from the line's text start; clicks past
 * the last cell land at the line end, clicks left of the start at the line start.
 */
export function cursorForCell(layout: EditorLayout, line: number, cells: number): number | undefined {
  const entry = layout.lines[line]
  const start = layout.starts[line]
  if (entry === undefined || start === undefined) return undefined
  const units = entry.units
  if (cells < 0) return start
  let width = 0
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index]!
    const next = Math.max(1, displayWidth(unit))
    if (width + next > cells) return start + index
    width += next
  }
  return start + units.length
}
