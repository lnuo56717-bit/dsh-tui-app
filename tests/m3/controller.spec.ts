import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, CreateAgentOptions, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionEvent, type UserMessage } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { InteractionController } from '../../src/interaction-controller.js'

type Handler = (...args: any[]) => any

function fixture() {
  const handlers = new Map<string, Handler[]>()
  const followups: UserMessage[] = []
  const steers: UserMessage[] = []
  const resumed: string[] = []
  let questionProvider: { ask(request: any): Promise<any> } | undefined

  const ctx = {
    on(name: string, handler: Handler) {
      const list = handlers.get(name) ?? []
      list.push(handler); handlers.set(name, list)
      return () => { handlers.set(name, (handlers.get(name) ?? []).filter(item => item !== handler)) }
    },
    get(name: string) { return services[name] },
  } as unknown as Context

  const makeHandle = async (id: string, setup?: (ctx: Context) => unknown): Promise<AgentHandle> => {
    const events: SessionEvent[] = []
    const session = {
      id: SessionId(id), header: { version: 0, id: SessionId(id), createdAt: 1, cwd: 'C:\\work' },
      get events() { return events }, get seq() { return events.length },
    }
    const agent = {
      id: SessionId(id), session, ctx, status: 'idle', options: { provider: 'mock', model: 'whale' }, inbox: {},
      followup(message: UserMessage) { followups.push(message) },
      steer(message: UserMessage) { steers.push(message) },
      send() {}, inject() {}, cancel() {}, async whenIdle() {}, runMaintenance: async <T>(task: (signal: AbortSignal) => Promise<T>) => task(new AbortController().signal),
    } as unknown as Agent
    await setup?.(ctx)
    return { agent, async dispose() {} }
  }

  const services: Record<string, any> = {
    agentDefaultModel: { currentSelection: () => ({ provider: 'mock', model: 'whale' }), async saveSelection() {} },
    agents: {
      create: (options: CreateAgentOptions) => makeHandle(String(options.sessionId), options.setup),
      resume: (options: ResumeAgentOptions) => { resumed.push(String(options.resumeSessionId)); return makeHandle(String(options.resumeSessionId), options.setup) },
    },
    userQuestions: { registerProvider(provider: any) { questionProvider = provider; return () => { questionProvider = undefined } } },
    commands: { list: () => [{ name: 'plan', description: 'Toggle plan' }, { name: 'resume', description: 'dsh resume command' }], async execute() { return { result: { kind: 'success', text: 'ok' } } } },
    permissionPresets: { names: ['workspace-write', 'danger-full-access'], current: () => 'workspace-write', set() {} },
    sessionPersistence: { async list() { return [] } },
    sessionTitle: { rename() {} },
  }

  return { ctx, handlers, followups, steers, resumed, get questionProvider() { return questionProvider } }
}

describe('M3 interaction controller', () => {
  it('submits real user messages, resolves approvals, and answers structured questions', async () => {
    const fx = fixture()
    const controller = new InteractionController(fx.ctx, 'deep-ocean')
    await controller.start()
    controller.submit('继续追问：中文 🐋')
    controller.submit('立即修正', true)
    expect(fx.followups[0]).toMatchObject({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '继续追问：中文 🐋' }] })
    expect(fx.steers).toHaveLength(1)

    const approval = fx.handlers.get('approval/request')!.at(-1)!
    const approvalResult = approval({ agent: (controller as any).handle.agent, toolName: 'bash', reason: 'write file' }, async () => 'unavailable')
    expect(controller.getSnapshot().approval).toMatchObject({ toolName: 'bash' })
    controller.answerApproval('allowed-once')
    await expect(approvalResult).resolves.toBe('allowed-once')

    const questionResult = fx.questionProvider!.ask({
      agent: (controller as any).handle.agent,
      questions: [{ id: 'review', question: 'Approve?', options: [{ label: 'Yes' }, { label: 'No' }], intent: { kind: 'plan-review', approve: 'Yes' } }],
    })
    expect(controller.getSnapshot().questions?.questions[0]).toMatchObject({ approve: 'Yes' })
    controller.answerQuestions([{ id: 'review', selected: ['Yes'] }])
    await expect(questionResult).resolves.toEqual({ answers: [{ id: 'review', selected: ['Yes'] }] })
    await controller.dispose()
  })

  it('uses agents.resume and keeps dsh/local command collisions explicit', async () => {
    const fx = fixture()
    const controller = new InteractionController(fx.ctx, 'deep-ocean')
    await controller.start('session-existing')
    expect(fx.resumed).toEqual(['session-existing'])
    expect(controller.commandChoices().filter(item => item.name === 'plan')).toEqual([
      { name: 'plan', description: 'Toggle plan', source: 'dsh' },
    ])
    expect(controller.commandChoices().some(item => item.name === 'resume' && item.source === 'tui')).toBe(true)
    expect(controller.commandChoices().filter(item => item.name === 'resume').map(item => item.source)).toEqual(['dsh', 'tui'])
    await controller.switchSession('session-next')
    expect(fx.resumed).toEqual(['session-existing', 'session-next'])
    await controller.dispose()
  })
})
