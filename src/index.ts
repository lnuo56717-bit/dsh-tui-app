import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { installModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { SessionId } from '@deepseek-ai/dsh-session'
import { render } from 'ink'
import React from 'react'
import type { ColorMode, ThemeName } from './startup.js'
import { attachTranscript } from './transcript-store.js'
import { Shell } from './ui/app.js'
import { enterFullscreen } from './ui/terminal.js'

export const name = 'tui-runner'
export const inject = ['tuiStartup', 'agentDefaultModel', 'agents', 'sessions']

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
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  if (agents === undefined || defaultModel === undefined) return
  const selection = defaultModel.currentSelection()
  const handle = await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: (agentCtx) => {
      const selected: ModelSelectionRef = { current: selection, assembled: undefined }
      installModelSelection(agentCtx, selected)
    },
  })
  await handle.agent.whenIdle()
  const attached = attachTranscript(handle.agent.ctx, handle.agent.session)
  const terminal = enterFullscreen()
  try {
    const instance = render(React.createElement(Shell, {
      ...config,
      store: attached.store,
      sessionId: String(handle.agent.session.id),
      model: `${selection.provider}/${selection.model}`,
    }), {
      exitOnCtrlC: false,
      patchConsole: true,
    })
    await instance.waitUntilExit()
    instance.unmount()
  } finally {
    terminal.release()
    attached.dispose()
    await handle.dispose()
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
