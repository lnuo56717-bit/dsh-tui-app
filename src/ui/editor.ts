import { graphemes } from './display-width.js'

export interface EditorState {
  readonly text: string
  readonly cursor: number
  readonly multiline: boolean
}

export const EMPTY_EDITOR: EditorState = Object.freeze({ text: '', cursor: 0, multiline: false })

export function insertText(state: EditorState, input: string): EditorState {
  const units = graphemes(state.text)
  units.splice(state.cursor, 0, input)
  return { ...state, text: units.join(''), cursor: state.cursor + graphemes(input).length }
}

export function moveCursor(state: EditorState, delta: number): EditorState {
  return { ...state, cursor: Math.max(0, Math.min(graphemes(state.text).length, state.cursor + delta)) }
}

export function moveCursorTo(state: EditorState, edge: 'start' | 'end'): EditorState {
  return { ...state, cursor: edge === 'start' ? 0 : graphemes(state.text).length }
}

export function backspace(state: EditorState): EditorState {
  if (state.cursor === 0) return state
  const units = graphemes(state.text)
  units.splice(state.cursor - 1, 1)
  return { ...state, text: units.join(''), cursor: state.cursor - 1 }
}

export function deleteForward(state: EditorState): EditorState {
  const units = graphemes(state.text)
  if (state.cursor >= units.length) return state
  units.splice(state.cursor, 1)
  return { ...state, text: units.join('') }
}

export function deleteToStart(state: EditorState): EditorState {
  const units = graphemes(state.text)
  return { ...state, text: units.slice(state.cursor).join(''), cursor: 0 }
}

export function deleteToEnd(state: EditorState): EditorState {
  return { ...state, text: graphemes(state.text).slice(0, state.cursor).join('') }
}

export function deleteWord(state: EditorState): EditorState {
  if (state.cursor === 0) return state
  const units = graphemes(state.text)
  let start = state.cursor
  while (start > 0 && /\s/u.test(units[start - 1]!)) start -= 1
  while (start > 0 && !/\s/u.test(units[start - 1]!)) start -= 1
  units.splice(start, state.cursor - start)
  return { ...state, text: units.join(''), cursor: start }
}

export function cursorParts(state: EditorState): { before: string; current: string; after: string } {
  const units = graphemes(state.text)
  return {
    before: units.slice(0, state.cursor).join(''),
    current: units[state.cursor] ?? ' ',
    after: units.slice(state.cursor + (state.cursor < units.length ? 1 : 0)).join(''),
  }
}
