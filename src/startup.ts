import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import { Command, Option } from 'commander'

export const name = 'tui-startup'
export const inject = ['cmdlineArgs']
export const TUI_STARTUP_SERVICE = 'tuiStartup'

export type ThemeName = 'deep-ocean' | 'mono'
export type ColorMode = 'auto' | 'truecolor' | '256' | '16' | 'none'

export interface TuiStartupValues {
  resume?: string
  theme: ThemeName
  color: ColorMode
}

interface ParsedOptions {
  resume?: string
  theme: ThemeName
  color: ColorMode
}

export function tuiCommand(): Command {
  return new Command()
    .name('dsh --profile tui')
    .description('Launch the DeepSeek Harness full-screen terminal interface.')
    .helpOption('-h, --help', 'show TUI help')
    .option('--resume <session-id>', 'resume a durable session')
    .addOption(new Option('--theme <name>', 'select a TUI theme').choices(['deep-ocean', 'mono']).default('deep-ocean'))
    .addOption(new Option('--color <mode>', 'force terminal color capability').choices(['auto', 'truecolor', '256', '16', 'none']).default('auto'))
    .addHelpText('after', `
M3 controls:
  Enter             send prompt
  Ctrl+P, Ctrl+S    commands, sessions
  Ctrl+M, Alt+Enter multiline, send multiline
  Ctrl+C            cancel, clear, then confirm quit

Examples:
  dsh --profile tui
  dsh --profile tui --resume <session-id>
  dsh --profile tui --theme mono --color none
`)
}

export function apply(ctx: Context): void {
  const program = tuiCommand()
  program.action((options: ParsedOptions) => {
    ctx.provide(TUI_STARTUP_SERVICE, {
      ...(options.resume === undefined ? {} : { resume: options.resume }),
      theme: options.theme,
      color: options.color,
    } satisfies TuiStartupValues)
  })
  parseCmdline(ctx, program)
}
