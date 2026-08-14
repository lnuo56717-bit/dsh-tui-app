import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, CreateAgentOptions, ModelSelection, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { InteractionController } from '../../src/interaction-controller.js'

type Handler = (...args: any[]) => any

interface ResolvedModelInfo {
  provider: string
  id: string
  name: string
  reasoning?: {
    efforts: Array<{ id: string; name: string; description?: string }>
    defaultEffort?: string
  }
}

function fixture(persistedHeader?: {
  config: { provider: string; model: string; reasoningEffort?: ModelSelection['reasoningEffort'] }
  adapterDefaults?: { reasoningEffort?: boolean }
}) {
  const handlers = new Map<string, Handler[]>()
  const resolved: string[] = []
  const saved: ModelSelection[] = []
  let defaultSelection: ModelSelection = { provider: 'alpha', model: 'whale' }

  const modelInfo = (provider: string, model: string): ResolvedModelInfo => {
    const key = `${provider}/${model}`
    if (key === 'alpha/whale') {
      return {
        provider, id: model, name: 'Whale',
        reasoning: {
          efforts: [{ id: 'brief', name: 'Brief' }, { id: 'deep', name: 'Deep' }],
          defaultEffort: 'brief',
        },
      }
    }
    if (key === 'beta/orca') {
      return {
        provider, id: model, name: 'Orca',
        reasoning: {
          efforts: [{ id: 'balanced', name: 'Balanced' }, { id: 'deep', name: 'Deep' }],
          defaultEffort: 'balanced',
        },
      }
    }
    throw new Error(`unknown model route ${key}`)
  }

  const ctx = {
    on(name: string, handler: Handler) {
      const current = handlers.get(name) ?? []
      current.push(handler)
      handlers.set(name, current)
      return () => { handlers.set(name, (handlers.get(name) ?? []).filter(item => item !== handler)) }
    },
    get(name: string) { return services[name] },
  } as unknown as Context

  const makeHandle = async (id: string, setup?: (agentCtx: Context) => unknown): Promise<AgentHandle> => {
    const events: SessionEvent[] = []
    const session = {
      id: SessionId(id),
      header: { version: 0, id: SessionId(id), createdAt: 1, cwd: 'C:\\work' },
      get events() { return events },
      get seq() { return events.length },
      requestHeader: () => persistedHeader,
    }
    const agent = {
      id: SessionId(id), session, ctx, status: 'idle', options: { provider: 'alpha', model: 'whale' }, inbox: {},
      followup() {}, steer() {}, send() {}, inject() {}, cancel() {}, async whenIdle() {},
      runMaintenance: async <T>(task: (signal: AbortSignal) => Promise<T>) => task(new AbortController().signal),
    } as unknown as Agent
    await setup?.(ctx)
    return { agent, async dispose() {} }
  }

  // Keep this as the public, structured LLM seam. The controller must ask the
  // selected adapter for exact-route capabilities instead of hard-coding model
  // names or a universal effort vocabulary.
  const llm = {
    listProviders: () => [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }],
    listModels: async (provider: string) => provider === 'alpha'
      ? [{ provider, id: 'whale', name: 'Whale' }]
      : [{ provider, id: 'orca', name: 'Orca' }],
    async resolveModelInfo(provider: string, model: string) {
      resolved.push(`${provider}/${model}`)
      return modelInfo(provider, model)
    },
    async resolveCallConfig(config: Record<string, unknown>) {
      const info = modelInfo(String(config.provider), String(config.model))
      const requested = typeof config.reasoningEffort === 'string' ? config.reasoningEffort : undefined
      if (requested !== undefined && !info.reasoning?.efforts.some(item => item.id === requested)) {
        throw new Error(`unsupported reasoning effort ${requested}`)
      }
      return requested === undefined && info.reasoning?.defaultEffort !== undefined
        ? { ...config, reasoningEffort: info.reasoning.defaultEffort }
        : { ...config }
    },
  }

  const services: Record<string, any> = {
    llm,
    agentDefaultModel: {
      currentSelection: () => ({ ...defaultSelection }),
      async saveSelection(next: ModelSelection) {
        defaultSelection = { ...next }
        saved.push({ ...next })
      },
    },
    agents: {
      create: (options: CreateAgentOptions) => makeHandle(String(options.sessionId), options.setup),
      resume: (options: ResumeAgentOptions) => makeHandle(String(options.resumeSessionId), options.setup),
    },
    permissionPresets: { names: [], current: () => undefined, set() {} },
  }

  const latest = (name: string): Handler => {
    const handler = handlers.get(name)?.at(-1)
    if (handler === undefined) throw new Error(`missing ${name} handler`)
    return handler
  }

  const assemble = async (): Promise<void> => {
    await latest('system-prompt/assemble')({}, {}, async () => ({ variables: {} }))
  }

  const request = async (seed: Record<string, unknown> = { provider: 'inherited', model: 'inherited' }): Promise<Record<string, unknown>> => {
    return latest('agent/request')(
      { turn: 1, step: 1, signal: new AbortController().signal },
      async () => seed,
    ) as Promise<Record<string, unknown>>
  }

  return { ctx, resolved, saved, assemble, request, llm, services }
}

describe('live model and reasoning-effort selection', () => {
  it('/switch mutates the retained ModelSelectionRef for the next assembled step, not the step already assembled', async () => {
    const fx = fixture()
    const controller = new InteractionController(fx.ctx, 'abyss')
    await controller.start()

    // The current step has already snapshotted alpha/whale.
    await fx.assemble()
    await expect(controller.executeCommand('/switch beta/orca', 'tui')).resolves.toBe('none')
    expect(controller.getSnapshot().model).toBe('beta/orca')
    expect(fx.resolved).toContain('beta/orca')

    // A mid-step switch must not split prompt assembly from request routing.
    await expect(fx.request()).resolves.toMatchObject({ provider: 'alpha', model: 'whale' })

    // The following step snapshots and routes through the newly selected model.
    await fx.assemble()
    await expect(fx.request()).resolves.toMatchObject({ provider: 'beta', model: 'orca' })
    await controller.dispose()
  })

  it('/effort accepts adapter-advertised ids, rejects unknown ids without mutation, and default clears the explicit override', async () => {
    const fx = fixture()
    const controller = new InteractionController(fx.ctx, 'abyss')
    await controller.start()
    await controller.executeCommand('/switch beta/orca', 'tui')

    await expect(controller.executeCommand('/effort deep', 'tui')).resolves.toBe('none')
    await fx.assemble()
    await expect(fx.request()).resolves.toMatchObject({ provider: 'beta', model: 'orca', reasoningEffort: 'deep' })

    await expect(controller.executeCommand('/effort ultra', 'tui')).resolves.toBe('none')
    expect(controller.getSnapshot().error).toMatch(/effort|ultra|balanced|deep/iu)
    await fx.assemble()
    await expect(fx.request()).resolves.toMatchObject({ provider: 'beta', model: 'orca', reasoningEffort: 'deep' })

    await expect(controller.executeCommand('/effort default', 'tui')).resolves.toBe('none')
    expect(controller.getSnapshot().error).toBeUndefined()
    await fx.assemble()
    const selected = await fx.request({ provider: 'inherited', model: 'inherited', reasoningEffort: 'inherited' })
    expect(selected).toMatchObject({ provider: 'beta', model: 'orca' })
    expect(selected).not.toHaveProperty('reasoningEffort')
    await controller.dispose()
  })

  it('resumes the session route while keeping an adapter-materialized effort as Default', async () => {
    const fx = fixture({
      config: { provider: 'beta', model: 'orca', reasoningEffort: 'balanced' as ModelSelection['reasoningEffort'] },
      adapterDefaults: { reasoningEffort: true },
    })
    const controller = new InteractionController(fx.ctx, 'abyss')
    await controller.start('session-resumed')
    expect(controller.getSnapshot()).toMatchObject({ model: 'beta/orca', reasoningEffort: undefined })
    expect((await controller.listEfforts()).find(item => item.id === undefined)?.current).toBe(true)
    await controller.dispose()
  })

  it('restores an explicit persisted effort and ignores a slower stale model resolution', async () => {
    const fx = fixture({ config: { provider: 'beta', model: 'orca', reasoningEffort: 'deep' as ModelSelection['reasoningEffort'] } })
    const controller = new InteractionController(fx.ctx, 'abyss')
    await controller.start('session-resumed')
    expect(controller.getSnapshot()).toMatchObject({ model: 'beta/orca', reasoningEffort: 'deep' })

    const resolveNormally = fx.llm.resolveCallConfig
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    fx.llm.resolveCallConfig = async (config: Record<string, unknown>) => {
      if (`${config.provider}/${config.model}` === 'alpha/whale') await gate
      return resolveNormally(config)
    }
    const stale = controller.switchModel('alpha', 'whale')
    await Promise.resolve()
    const latest = controller.switchModel('beta', 'orca')
    await expect(latest).resolves.toBe(true)
    release()
    await expect(stale).resolves.toBe(false)
    expect(controller.getSnapshot().model).toBe('beta/orca')
    expect(fx.saved.at(-1)).toMatchObject({ provider: 'beta', model: 'orca' })
    await controller.dispose()
  })
})
