import { describe, expect, it } from 'vitest'
import { parseWheel } from '../../src/ui/mouse.js'
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

  it('redacts provider keys without touching ordinary status text', () => {
    expect(redactSecrets('model deepseek/chat · sk-tui-fake-key-0123456789')).toBe('model deepseek/chat · sk-…')
    expect(redactSecrets('apiKey=sk-or-v1-tui-fake-key-123456')).toContain('apiKey=…')
    expect(redactSecrets('ctx 14% · ~18k/128k')).toBe('ctx 14% · ~18k/128k')
  })
})
