import { describe, expect, it } from 'vitest'
import { tuiCommand } from '../../src/startup.js'

describe('M1 command grammar', () => {
  it('advertises every TUI flag', () => {
    const help = tuiCommand().helpInformation()
    expect(help).toContain('--resume <session-id>')
    expect(help).toContain('--theme <name>')
    expect(help).toContain('--color <mode>')
  })

  it('accepts the locked theme and color choices', () => {
    const program = tuiCommand().exitOverride()
    let parsed: unknown
    program.action(options => { parsed = options })
    program.parse(['--theme', 'mono', '--color', 'none', '--resume', 'session-1'], { from: 'user' })
    expect(parsed).toMatchObject({ theme: 'mono', color: 'none', resume: 'session-1' })
  })
})
