import { describe, expect, it } from 'vitest'
import { parseMouseBurst, parseWheel } from '../../src/ui/mouse.js'
import { redactSecrets } from '../../src/ui/secrets.js'

describe('mouse wheel and secret chrome', () => {
  it('reads SGR wheel reports after Ink strips the ESC prefix', () => {
    expect(parseWheel('[<64;12;20M]')).toBeUndefined()
    expect(parseWheel('[<64;12;20M')).toBe('up')
    expect(parseWheel('[<65;12;20m')).toBe('down')
    expect(parseWheel('\u001B[<64;1;1M')).toBe('up')
    expect(parseWheel('[<0;12;20M')).toBe('other')
    expect(parseWheel('hello')).toBeUndefined()
  })

  it('decodes SGR clicks, releases, and drag motion, ignoring wheel codes', () => {
    expect(parseMouseBurst('[<0;7;27M')).toEqual([{ kind: 'press', button: 0, x: 7, y: 27 }])
    expect(parseMouseBurst('\u001B[<2;9;21m')).toEqual([{ kind: 'release', button: 2, x: 9, y: 21 }])
    expect(parseMouseBurst('[<32;10;27M')).toEqual([{ kind: 'motion', button: 0, x: 10, y: 27 }])
    // Modifier bits ride along with motion; the button hides in the low two bits.
    expect(parseMouseBurst('[<35;10;27M')).toEqual([{ kind: 'motion', button: 3, x: 10, y: 27 }])
    expect(parseMouseBurst('[<0;1;1M[<64;2;2M[<32;3;3M')).toEqual([
      { kind: 'press', button: 0, x: 1, y: 1 },
      { kind: 'motion', button: 0, x: 3, y: 3 },
    ])
    expect(parseMouseBurst('')).toEqual([])
    expect(parseMouseBurst('hello')).toEqual([])
  })

  it('redacts provider keys without touching ordinary status text', () => {
    expect(redactSecrets('model deepseek/chat · sk-tui-fake-key-0123456789')).toBe('model deepseek/chat · sk-…')
    expect(redactSecrets('apiKey=sk-or-v1-tui-fake-key-123456')).toContain('apiKey=…')
    expect(redactSecrets('ctx 14% · ~18k/128k')).toBe('ctx 14% · ~18k/128k')
  })
})
