import { describe, expect, it } from 'vitest'
import { cursorCell } from '../../src/ui/display-width.js'
import {
  EMPTY_EDITOR, backspace, cursorParts, deleteForward, deleteToEnd, deleteToStart, deleteWord,
  insertText, moveCursor, presentEditor,
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
    expect(lines[0]).toMatchObject({ before: '中文', current: '路', hasCursor: true })
    expect(lines.some(line => line.after.includes('测') || line.before.includes('测') || line.current === '测')).toBe(true)
    for (const line of lines) {
      const painted = `${line.before}${line.current}${line.after}`
      expect(cursorCell(painted, 99) <= 8 || painted.length === 0).toBe(true)
    }
  })
})
