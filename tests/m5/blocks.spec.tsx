import React from 'react'
import { renderToString } from 'ink'
import { describe, expect, it } from 'vitest'
import { clipboardTarget, copyNotice, encodeForTarget, osc52, OSC52_LIMIT } from '../../src/clipboard.js'
import { foldEvents, type EventLike } from '../../src/transcript-fold.js'
import { composerCaret, moveCursorSequence } from '../../src/ui/cursor.js'
import { presentEditor } from '../../src/ui/editor.js'
import { resolveTheme } from '../../src/ui/theme.js'
import { TOOL_PREVIEW_ROWS, transcriptRows } from '../../src/ui/transcript-rows.js'
import { focusableBlocks, TranscriptView } from '../../src/ui/transcript-view.js'

const ansi = /\[[0-?]*[ -/]*[@-~]/gu
const theme = resolveTheme('abyss', 'mono')
const file = Array.from({ length: 40 }, (_, index) => `line ${index} 第 ${index} 行`).join('\n')

const events: EventLike[] = [
  { seq: 0, type: 'user/message', surfaceOp: 'append', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '读一下文件' }] } },
  { seq: 1, type: 'tool/call', data: { callId: 'read-1', name: 'read_file', arguments: '{"path":"src/ui/app.tsx"}' } },
  { seq: 2, type: 'tool/result', surfaceOp: 'append', data: { message: { content: [{ type: 'tool-result', toolCallId: 'read-1', content: [{ type: 'text', text: file }] }] } } },
  { seq: 3, type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, message: { role: 'assistant', source: { kind: 'model' }, content: [
    { type: 'reasoning', text: '先读文件\n再回答' }, { type: 'text', text: '共 40 行。' },
  ] } } },
]
const state = foldEvents(events)

function rows(expanded: ReadonlySet<string> = new Set(), focused?: string): ReturnType<typeof transcriptRows> {
  return transcriptRows(state, { width: 60, compact: false, expandedBlocks: expanded, focusedBlockKey: focused, thinkingGlyph: '◌' })
}

function text(row: ReturnType<typeof transcriptRows>[number]): string {
  return row.segments.map(part => part.text).join('')
}

describe('tool output folds instead of flooding the transcript', () => {
  it('shows a bounded preview with the real size and keeps the answer on screen', () => {
    const lines = rows().map(text)
    const header = lines.find(line => line.includes('read_file'))
    expect(header).toContain('· 40 lines')
    expect(lines.filter(line => /^ {4}line \d+ /u.test(line))).toHaveLength(TOOL_PREVIEW_ROWS)
    expect(lines.some(line => line.includes('… 34 more lines'))).toBe(true)
    // The assistant's own answer is still within a screenful of the tool call.
    expect(lines.length).toBeLessThan(20)
    expect(lines.some(line => line.includes('共 40 行。'))).toBe(true)
  })

  it('expands the same block on request and offers the copy affordance when focused', () => {
    const key = focusableBlocks(state).find(block => block.kind === 'tool')!.key
    expect(key).toBe('tool:tool:read-1')
    const expanded = rows(new Set([key])).map(text)
    expect(expanded.filter(line => /^ {4}line \d+ /u.test(line))).toHaveLength(40)
    expect(expanded.some(line => line.includes('more lines'))).toBe(false)
    expect(rows(new Set(), key).map(text).some(line => line.includes('→ expand · Ctrl+Y copy'))).toBe(true)
  })

  it('exposes messages, tools, and reasoning as one ordered selection list carrying raw copy text', () => {
    const blocks = focusableBlocks(state)
    expect(blocks.map(block => `${block.kind}/${block.label}`)).toEqual([
      'message/prompt', 'tool/read_file', 'message/answer', 'reasoning/thought',
    ])
    expect(blocks[0]!.text).toBe('读一下文件')
    expect(blocks[1]!.text).toBe(file)
    expect(blocks[2]!.text).toBe('共 40 行。')
    expect(blocks[3]!.text).toBe('先读文件\n再回答')
  })

  it('renders the folded transcript inside its viewport', () => {
    const frame = renderToString(<TranscriptView rows={rows()} viewport={12} offset={0} theme={theme} />, { columns: 62 }).replace(ansi, '')
    expect(frame.split('\n')).toHaveLength(12)
  })
})

describe('clipboard', () => {
  it('encodes Windows clipboard input as UTF-16LE with a BOM so CJK survives', () => {
    const target = clipboardTarget('win32')!
    expect(target.command).toBe('clip.exe')
    const encoded = encodeForTarget('中文 🐋', target)
    expect(encoded.subarray(0, 2)).toEqual(Buffer.from([0xFF, 0xFE]))
    expect(encoded.subarray(2).toString('utf16le')).toBe('中文 🐋')
  })

  it('picks a platform tool per host and none when there is nothing to spawn', () => {
    expect(clipboardTarget('darwin')?.command).toBe('pbcopy')
    expect(clipboardTarget('linux', {})?.args).toEqual(['-selection', 'clipboard'])
    expect(clipboardTarget('linux', { WAYLAND_DISPLAY: 'wayland-0' })?.command).toBe('wl-copy')
    expect(clipboardTarget('android' as NodeJS.Platform)).toBeUndefined()
  })

  it('builds an OSC 52 payload and declines one the terminal would truncate', () => {
    expect(osc52('中文')).toBe(`\u001B]52;c;${Buffer.from('中文', 'utf8').toString('base64')}\u0007`)
    expect(osc52('x'.repeat(OSC52_LIMIT * 2))).toBeUndefined()
  })

  it('never claims the clipboard changed when only the terminal was asked', () => {
    expect(copyNotice('a\nb', { terminal: true, process: 'ok' })).toBe('Copied 2 lines to the clipboard')
    expect(copyNotice('a', { terminal: true, process: 'failed' })).toContain('the terminal decides')
    expect(copyNotice('a', { terminal: false, process: 'unavailable' })).toContain('Could not reach a clipboard')
  })
})

describe('IME composition anchors to the composer caret', () => {
  it('places the hardware cursor on the typed cell, counting CJK width', () => {
    const lines = presentEditor({ text: '中文abc', cursor: 3, multiline: false }, 40, 3)
    expect(composerCaret({ rows: 24, margin: 1, lines })).toEqual({ row: 21, column: 11 })
    const empty = presentEditor({ text: '', cursor: 0, multiline: false }, 40, 3)
    expect(composerCaret({ rows: 24, margin: 1, lines: empty })).toEqual({ row: 21, column: 6 })
    expect(composerCaret({ rows: 24, margin: 0, lines: empty })).toEqual({ row: 21, column: 5 })
  })

  it('follows a multiline draft to the wrapped row holding the cursor', () => {
    const lines = presentEditor({ text: 'a\nbb\nccc', cursor: 8, multiline: true }, 40, 5)
    expect(lines).toHaveLength(3)
    expect(composerCaret({ rows: 30, margin: 2, lines })).toEqual({ row: 27, column: 10 })
  })

  it('reports nothing when no rendered row owns the cursor', () => {
    expect(composerCaret({ rows: 24, margin: 1, lines: [] })).toBeUndefined()
    expect(moveCursorSequence(21, 6)).toBe('\u001B[21;6H')
  })
})
