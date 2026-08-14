import { describe, expect, it } from 'vitest'
import { cursorCell } from '../../src/ui/display-width.js'
import {
  EMPTY_EDITOR, backspace, cursorForCell, cursorParts, deleteForward, deleteToEnd, deleteToStart, deleteWord,
  insertText, layoutEditor, moveCursor, moveCursorTo, presentEditor,
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

  it('wraps the composer by display cells and keeps the cursor on the current CJK grapheme', () => {
    const state = insertText(EMPTY_EDITOR, '中文路径测试🐋')
    const lines = presentEditor({ ...state, cursor: 2 }, 10)
    const flat = (line: (typeof lines)[number]): string => line.segments.map(segment => segment.text).join('')
    expect(lines[0]).toMatchObject({ hasCursor: true, hasSelection: false })
    expect(flat(lines[0]!)).toBe('中文路径')
    expect(lines.some(line => flat(line).includes('测'))).toBe(true)
    for (const line of lines) {
      expect(cursorCell(flat(line), 99) <= 8 || flat(line).length === 0).toBe(true)
    }
  })
})

describe('M5 mouse selection in the composer', () => {
  it('typing and deletion replace the selection, then edit normally', () => {
    const selected = { ...insertText(EMPTY_EDITOR, 'abc中文'), cursor: 0, selection: { start: 1, end: 4 } }
    expect(insertText(selected, 'X')).toMatchObject({ text: 'aX文', cursor: 2, selection: undefined })
    expect(backspace(selected)).toMatchObject({ text: 'a文', cursor: 1, selection: undefined })
    expect(deleteForward(selected)).toMatchObject({ text: 'a文', cursor: 1, selection: undefined })
    expect(deleteWord(selected)).toMatchObject({ text: 'a文', cursor: 1, selection: undefined })
  })

  it('arrow keys collapse the selection to its nearer edge', () => {
    const selected = { text: 'abc', cursor: 2, multiline: false, selection: { start: 0, end: 3 } }
    expect(moveCursor(selected, -1)).toMatchObject({ cursor: 0, selection: undefined })
    expect(moveCursor(selected, 1)).toMatchObject({ cursor: 3, selection: undefined })
    expect(moveCursorTo(selected, 'start')).toMatchObject({ cursor: 0, selection: undefined })
  })

  it('maps a click inside a wrapped line to the grapheme under the cell', () => {
    const layout = layoutEditor({ text: '中文abc中文', cursor: 5, multiline: false }, 10, 3)
    // width 10 → 8 cells: line 0 = 中文abc (7 cells), line 1 = 中文.
    expect(cursorForCell(layout, 0, 0)).toBe(0)
    expect(cursorForCell(layout, 0, 1)).toBe(0)
    expect(cursorForCell(layout, 0, 2)).toBe(1)
    expect(cursorForCell(layout, 0, 6)).toBe(4)
    expect(cursorForCell(layout, 0, 99)).toBe(5)
    expect(cursorForCell(layout, 1, 1)).toBe(5)
    expect(cursorForCell(layout, 1, 99)).toBe(7)
    expect(cursorForCell(layout, 2, 0)).toBeUndefined()
  })

  it('paints the selection across wrapped lines as inverse segments', () => {
    const lines = presentEditor({ text: '中文abc中文', cursor: 5, multiline: false, selection: { start: 1, end: 7 } }, 10, 3)
    expect(lines[0]!.hasSelection).toBe(true)
    expect(lines[1]!.hasSelection).toBe(true)
    const inverse = (line: (typeof lines)[number]): string => line.segments.filter(part => part.selected).map(part => part.text).join('')
    expect(inverse(lines[0]!)).toBe('文abc')
    expect(inverse(lines[1]!)).toBe('中文')
  })
})
