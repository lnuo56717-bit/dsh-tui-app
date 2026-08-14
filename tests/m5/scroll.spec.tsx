import React from 'react'
import { renderToString } from 'ink'
import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import { foldEvents, type EventLike } from '../../src/transcript-fold.js'
import { TranscriptStore } from '../../src/transcript-store.js'
import { Shell } from '../../src/ui/app.js'
import { parseWheelBurst } from '../../src/ui/mouse.js'
import { transcriptRows } from '../../src/ui/transcript-rows.js'
import { resolveTheme } from '../../src/ui/theme.js'
import { scrollbarGlyphs, TranscriptView, viewportWindow } from '../../src/ui/transcript-view.js'

const ansi = /\[[0-?]*[ -/]*[@-~]/gu
const theme = resolveTheme('abyss', 'mono')

function conversation(turns: number): EventLike[] {
  const events: EventLike[] = []
  let seq = 0
  for (let turn = 1; turn <= turns; turn += 1) {
    events.push({
      seq: seq++, type: 'user/message', surfaceOp: 'append',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: `第 ${turn} 个问题 🐋` }] },
    })
    events.push({
      seq: seq++, type: 'assistant/message', surfaceOp: 'append',
      data: { turn, step: 1, message: { role: 'assistant', source: { kind: 'model' }, content: [
        { type: 'text', text: `回答 ${turn} 第一行\n\n回答 ${turn} 第二行\n\n回答 ${turn} 第三行` },
      ] } },
    })
  }
  return events
}

function rowsOf(turns: number, width = 60): ReturnType<typeof transcriptRows> {
  return transcriptRows(foldEvents(conversation(turns)), {
    width, compact: false, expandedBlocks: new Set(), thinkingGlyph: '◌',
  })
}

function frame(rows: ReturnType<typeof transcriptRows>, viewport: number, offset: number): string[] {
  return renderToString(<TranscriptView rows={rows} viewport={viewport} offset={offset} theme={theme} />, { columns: 60 })
    .replace(ansi, '').split('\n')
}

describe('row-precise transcript viewport', () => {
  it('shifts the window by exactly the requested number of rows, whatever a node costs', () => {
    const rows = rowsOf(6)
    const viewport = 10
    const strip = (line: string): string => line.replace(/[\s│┃]+$/u, '')
    const top = frame(rows, viewport, 0).map(strip)
    const oneUp = frame(rows, viewport, 1).map(strip)
    const threeUp = frame(rows, viewport, 3).map(strip)
    expect(oneUp.slice(1)).toEqual(top.slice(0, viewport - 1))
    expect(threeUp.slice(3)).toEqual(top.slice(0, viewport - 3))
  })

  it('never renders more rows than the viewport and always shows the newest row at rest', () => {
    const rows = rowsOf(8)
    expect(rows.length).toBeGreaterThan(12)
    const lines = frame(rows, 12, 0)
    expect(lines.length).toBe(12)
    const last = rows.at(-1)!.segments.map(part => part.text).join('').trimEnd()
    expect(lines.at(-1)!.trimEnd()).toContain(last)
  })

  it('clamps the offset to the oldest row instead of scrolling into emptiness', () => {
    const rows = rowsOf(4)
    const window = viewportWindow(rows.length, 10, 9_999)
    expect(window.start).toBe(0)
    expect(window.end).toBe(10)
    expect(window.maxOffset).toBe(rows.length - 10)
  })

  it('draws a proportional scrollbar that reaches both ends', () => {
    const bottom = scrollbarGlyphs(100, 10, 0, false)
    const top = scrollbarGlyphs(100, 10, 90, false)
    expect(bottom).toHaveLength(10)
    expect(bottom.at(-1)).toBe('┃')
    expect(bottom[0]).toBe('│')
    expect(top[0]).toBe('┃')
    expect(top.at(-1)).toBe('│')
    // A transcript shorter than the viewport reserves the column without drawing.
    expect(scrollbarGlyphs(4, 10, 0, false).every(glyph => glyph === ' ')).toBe(true)
    expect(scrollbarGlyphs(100, 10, 0, true).at(-1)).toBe('#')
  })

  it('reuses cached rows for untouched nodes while a turn streams', () => {
    const base = conversation(3)
    const first = transcriptRows(foldEvents(base), { width: 60, compact: false, expandedBlocks: new Set(), thinkingGlyph: '◌' })
    const grown = transcriptRows(foldEvents([...base, {
      seq: base.length, type: 'user/message', surfaceOp: 'append',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: '新的问题' }] },
    }]), { width: 60, compact: false, expandedBlocks: new Set(), thinkingGlyph: '◌' })
    expect(grown.length).toBeGreaterThan(first.length)
    expect(grown.slice(0, first.length).map(row => row.key)).toEqual(first.map(row => row.key))
  })

  it('counts every wheel report in one stdin chunk and keeps mouse bytes out of the composer', () => {
    expect(parseWheelBurst('[<64;10;5M')).toEqual({ notches: -1, mouse: true })
    expect(parseWheelBurst('[<65;10;5M[<65;10;6M[<65;10;7M')).toEqual({ notches: 3, mouse: true })
    expect(parseWheelBurst('[<64;1;1M[<65;1;1M')).toEqual({ notches: 0, mouse: true })
    expect(parseWheelBurst('[<0;12;20M')).toEqual({ notches: 0, mouse: true })
    expect(parseWheelBurst('hello')).toEqual({ notches: 0, mouse: false })
    expect(parseWheelBurst('')).toEqual({ notches: 0, mouse: false })
  })

  it('keeps an 80x24 shell inside its frame with a long transcript', () => {
    const store = new TranscriptStore(foldEvents(conversation(12)))
    const lines = renderToString(<Shell theme="abyss" color="mono" store={store} sessionId="session-scroll" />, { columns: 80 })
      .replace(ansi, '').trimEnd().split('\n')
    expect(lines.length).toBeLessThanOrEqual(24)
    for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(80)
    // The newest exchange stays visible: the composer never pushes it off-frame.
    expect(lines.join('\n')).toContain('回答 12 第三行')
  })
})
