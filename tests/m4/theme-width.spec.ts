import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import { middleEllipsis } from '../../src/ui/display-width.js'
import { detectColorTier, resolveTheme } from '../../src/ui/theme.js'

describe('M4 themes and compact display cells', () => {
  it('ships distinct Abyss/Pearl palettes and explicit capability tiers', () => {
    expect(resolveTheme('abyss', 'truecolor', {}).canvas).toBe('#06111F')
    expect(resolveTheme('pearl', 'truecolor', {}).canvas).toBe('#F4F7FA')
    expect(resolveTheme('abyss', '256', {}).primary).toBe('ansi256(33)')
    expect(resolveTheme('auto', 'auto', { TERM: 'xterm-256color' }).tier).toBe('256')
    expect(detectColorTier({ COLORTERM: 'truecolor' })).toBe('truecolor')
    expect(resolveTheme('pearl', 'truecolor', { NO_COLOR: '1' }).monochrome).toBe(true)
  })

  it('middle-ellipsizes CJK, combining, and emoji only at grapheme boundaries', () => {
    for (const value of ['中文项目路径与鲸鱼会话标题', 'Cafe\u0301/深海/🐋/long-title']) {
      const clipped = middleEllipsis(value, 12)
      expect(stringWidth(clipped)).toBeLessThanOrEqual(12)
      expect(clipped).toContain('…')
      expect(clipped).not.toContain('\uFFFD')
    }
  })
})
