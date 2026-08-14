import React from 'react'
import { renderToString } from 'ink'
import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import { borderStyleForWidth, Shell } from '../../src/ui/app.js'

const ansi = /\u001B\[[0-?]*[ -/]*[@-~]/gu

describe('M4 narrow terminal presentation', () => {
  it('selects plain borders below 60 and keeps the 80-column snapshot bounded', () => {
    expect(borderStyleForWidth(59)).toBe('classic')
    expect(borderStyleForWidth(60)).toBe('single')
    const frame = renderToString(<Shell theme="abyss" color="mono" sessionId="会话-session-with-a-very-long-id" />, { columns: 80 }).replace(ansi, '')
    expect(frame).toContain('dsh-tui ·')
    for (const line of frame.split('\n')) expect(stringWidth(line)).toBeLessThanOrEqual(80)
  })
})
