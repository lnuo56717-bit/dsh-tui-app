import { describe, expect, it } from 'vitest'
import { cursorCell, displayWidth, takeCells } from '../../src/ui/display-width.js'
import { markdownToLines, plainStyledText } from '../../src/ui/markdown.js'

describe('AC-6 CJK and Markdown layout', () => {
  it('wraps mixed CJK, full-width punctuation, emoji, and Markdown without half-glyph clipping', () => {
    const source = '# 标题 DeepSeek\n\n中文，English；鲸鱼🐋 **加粗** 与 `code()`。\n\n- 第一项\n- second item\n\n| 键 | 值 |\n|---|---|\n| 模式 | 深海 |'
    const lines = markdownToLines(source, 18)
    expect(lines.length).toBeGreaterThan(8)
    for (const line of lines) expect(displayWidth(plainStyledText(line))).toBeLessThanOrEqual(18)
    expect(lines.map(plainStyledText).join('\n')).toContain('标题 DeepSeek')
    expect(lines.map(plainStyledText).join('').replaceAll(/\s+/g, '')).toContain('键:模式·值:深海')
  })

  it('reports cursor cells by grapheme and clips only at grapheme boundaries', () => {
    const text = 'A中文，🐋éZ'
    expect(cursorCell(text, 0)).toBe(0)
    expect(cursorCell(text, 3)).toBe(5)
    const clipped = takeCells(text, 6)
    expect(displayWidth(clipped.head)).toBeLessThanOrEqual(6)
    expect(clipped.head + clipped.tail).toBe(text)
    expect(clipped.head).not.toContain('\uFFFD')
  })
})
