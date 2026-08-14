import { describe, expect, it } from 'vitest'
import { cursorCell } from '../../src/ui/display-width.js'
import {
  EMPTY_EDITOR, backspace, cursorParts, deleteForward, deleteToEnd, deleteToStart, deleteWord,
  insertText, moveCursor,
} from '../../src/ui/editor.js'

describe('M3 grapheme composer', () => {
  it('edits CJK, emoji, and combining marks without splitting a grapheme', () => {
    let state = insertText(EMPTY_EDITOR, 'A中文🐋éZ')
    expect(state.cursor).toBe(6)
    state = moveCursor(state, -2)
    expect(cursorParts(state)).toEqual({ before: 'A中文🐋', current: 'é', after: 'Z' })
    expect(cursorCell(state.text, state.cursor)).toBe(7)
    state = backspace(state)
    expect(state.text).toBe('A中文éZ')
    state = deleteForward(state)
    expect(state.text).toBe('A中文Z')
  })

  it('implements terminal deletion chords deterministically', () => {
    const initial = insertText(EMPTY_EDITOR, 'alpha 中文 beta')
    expect(deleteWord(initial).text).toBe('alpha 中文 ')
    const middle = moveCursor(initial, -5)
    expect(deleteToStart(middle)).toMatchObject({ text: ' beta', cursor: 0 })
    expect(deleteToEnd(middle).text).toBe('alpha 中文')
  })
})
