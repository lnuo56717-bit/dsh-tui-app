import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { render } from 'ink'
import React from 'react'
import { InteractionController } from './interaction-controller.js'
import type { ColorMode, ThemeName } from './startup.js'
import { Shell } from './ui/app.js'
import { enterFullscreen } from './ui/terminal.js'

export const name = 'tui-runner'
export const inject = [
  'tuiStartup', 'agentDefaultModel', 'agents', 'sessions', 'approval', 'userQuestions', 'commands',
  'permissionPresets', 'sessionPersistence', 'sessionTitle',
]

export interface Config {
  resume?: string
  theme: ThemeName
  color: ColorMode
}

async function run(ctx: Context, config: Config): Promise<void> {
  await ctx.get('loader')?.await()
  if (ctx.get('tuiStartup') === undefined) return
  const appExit = ctx.get('appExit')
  if (appExit === undefined) throw new Error('tui-runner: the launcher must provide ctx.appExit')
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('dsh-tui: an interactive TTY is required\n')
    appExit(1)
    return
  }
  const controller = new InteractionController(ctx, config.theme)
  await controller.start(config.resume)
  let terminal: ReturnType<typeof enterFullscreen> | undefined
  try {
    terminal = enterFullscreen()
    const instance = render(React.createElement(Shell, {
      ...config,
      controller,
    }), {
      exitOnCtrlC: false,
      patchConsole: true,
    })
    await instance.waitUntilExit()
    instance.unmount()
  } finally {
    terminal?.release()
    await controller.dispose()
  }
  appExit(0)
}

export function apply(ctx: Context, config: Config): void {
  void run(ctx, config).catch((error: unknown) => {
    process.stderr.write(`dsh-tui: ${error instanceof Error ? error.message : String(error)}\n`)
    ctx.get('appExit')?.(1)
  })
}

export { foldEvents, foldTranscript } from './transcript-fold.js'
export { TranscriptStore, attachTranscript } from './transcript-store.js'
export { InteractionController } from './interaction-controller.js'
