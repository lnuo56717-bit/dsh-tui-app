import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, CreateAgentOptions, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { InteractionController } from '../../src/interaction-controller.js'

function lifecycle(options?: {
  resumeError?: Error
  raw?: string
  locatePath?: string
  extraHeaders?: Array<{ id: string; createdAt: number; cwd?: string }>
}) {
  const created: CreateAgentOptions[] = []
  const resumed: string[] = []
  const ctx = {
    on: () => () => {},
    get: (name: string) => services[name],
  } as unknown as Context

  const makeHandle = async (id: string, setup?: (agentCtx: Context) => unknown): Promise<AgentHandle> => {
    const events: SessionEvent[] = []
    const session = {
      id: SessionId(id),
      header: { version: 0, id: SessionId(id), createdAt: 1, cwd: 'C:\\work' },
      get events() { return events },
      get seq() { return events.length },
    }
    const agent = {
      id: SessionId(id), session, ctx, status: 'idle',
      options: { provider: 'mock', model: 'whale' }, inbox: { nextTurn: [] },
      followup() {}, steer() {}, send() {}, inject() {}, cancel() {}, async whenIdle() {},
      runMaintenance: async <T>(task: (signal: AbortSignal) => Promise<T>) => task(new AbortController().signal),
    } as unknown as Agent
    await setup?.(ctx)
    return { agent, async dispose() {} }
  }

  const services: Record<string, any> = {
    agentDefaultModel: { currentSelection: () => ({ provider: 'mock', model: 'whale' }), async saveSelection() {} },
    agents: {
      create: (opts: CreateAgentOptions) => {
        created.push(opts)
        return makeHandle(String(opts.sessionId), opts.setup)
      },
      resume: async (opts: ResumeAgentOptions) => {
        resumed.push(String(opts.resumeSessionId))
        if (options?.resumeError !== undefined) throw options.resumeError
        return makeHandle(String(opts.resumeSessionId), opts.setup)
      },
    },
    sessionPersistence: {
      async list() {
        return [
          ...created.map(item => ({ version: 0, id: item.sessionId, createdAt: 1, cwd: 'C:\\work' })),
          ...(options?.extraHeaders ?? []),
        ]
      },
      async readFrom(id: string) {
        const events = String(id) === 'session-real'
          ? [{ seq: 0, time: 2, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '真实对话' }] } }]
          : []
        return { meta: { version: 0, id, createdAt: 1 }, events }
      },
      async readRaw() {
        if (options?.raw === undefined) return undefined
        return { meta: { version: 0, id: 'old', createdAt: 1 }, content: options.raw }
      },
      locate() {
        return options?.locatePath === undefined ? undefined : { kind: 'jsonl', path: options.locatePath }
      },
    },
  }

  return { ctx, created, resumed }
}

describe('welcome sessions and torn-log resume', () => {
  it('removes an unused welcome session artifact on dispose', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-tui-empty-'))
    const file = join(dir, 'session.jsonl')
    await writeFile(file, '{}\n')
    const fx = lifecycle({ locatePath: file })
    const controller = new InteractionController(fx.ctx, 'abyss')
    await controller.start()
    await controller.dispose()
    expect(existsSync(dir)).toBe(false)
  }, 5_000)

  it('keeps a session that already has a human prompt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-tui-used-'))
    const file = join(dir, 'session.jsonl')
    await mkdir(dir, { recursive: true })
    await writeFile(file, '{}\n')
    const fx = lifecycle({ locatePath: file })
    const controller = new InteractionController(fx.ctx, 'abyss')
    await controller.start()
    const agent = (controller as unknown as { handle: { agent: { session: { events: SessionEvent[] } } } }).handle.agent
    ;(agent.session.events as SessionEvent[]).push({
      seq: 0, type: 'user/message', time: 1,
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] },
    } as SessionEvent)
    await controller.dispose()
    expect(existsSync(file)).toBe(true)
  }, 5_000)

  it('opens a repaired copy when resume rejects a seq-gap log', async () => {
    const raw = [
      JSON.stringify({ seq: 0, type: 'session/created', data: {} }),
      JSON.stringify({ seq: 1, time: 2, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '继续' }] } }),
      JSON.stringify({ seq: 1, time: 3, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '重复' }] } }),
      JSON.stringify({ seq: 2, time: 4, type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', content: [] } } }),
    ].join('\n')
    const fx = lifecycle({
      resumeError: new Error('corrupt session log: seq gap in committed region at line 5381'),
      raw,
    })
    const controller = new InteractionController(fx.ctx, 'abyss')
    await controller.start('session-torn')
    expect(fx.resumed).toEqual(['session-torn'])
    expect(fx.created).toHaveLength(1)
    expect(fx.created[0]?.seed?.map(item => item.seq)).toEqual([0, 1, 2])
    expect(controller.getSnapshot().notice).toMatch(/repaired copy/i)
    expect(controller.getSnapshot().error).toBeUndefined()
    await controller.dispose()
  }, 5_000)

  it('does not list the open untitled welcome session in /resume', async () => {
    const fx = lifecycle({
      extraHeaders: [{ id: 'session-real', createdAt: 2, cwd: 'C:\\work' }],
    })
    const controller = new InteractionController(fx.ctx, 'abyss')
    await controller.start()
    const items = await controller.listSessions()
    expect(items.map(item => item.id)).toEqual(['session-real'])
    expect(items.some(item => item.current || item.id === controller.getSnapshot().sessionId)).toBe(false)
    await controller.dispose()
  }, 5_000)
})
