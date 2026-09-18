import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, CreateAgentOptions, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { InteractionController } from '../../src/interaction-controller.js'
import type { TeamMemberView, TeamServiceLike, TeamTaskView } from '../../src/team.js'

type Handler = (...args: any[]) => any

function teamFixture() {
  const handlers = new Map<string, Handler[]>()
  const calls: Array<{ readonly name: string; readonly args: any[] }> = []
  const permissionSets: Array<{ readonly id: string; readonly preset: string }> = []
  let lead: Agent | undefined
  let teammate: Agent | undefined
  let closeCount = 0
  let readAccess: string | undefined
  let questionProvider: { ask(request: any): Promise<any> } | undefined

  const ctx = {
    on(name: string, handler: Handler) {
      const current = handlers.get(name) ?? []
      current.push(handler); handlers.set(name, current)
      return () => handlers.set(name, (handlers.get(name) ?? []).filter(item => item !== handler))
    },
    get(name: string) { return services[name] },
  } as unknown as Context

  const makeAgent = (id: string): Agent => {
    const events: SessionEvent[] = []
    const session = {
      id: SessionId(id), header: { version: 3, id: SessionId(id), createdAt: 1, cwd: 'C:\team' },
      get events() { return events }, get seq() { return events.length },
    }
    return {
      id: SessionId(id), session, ctx, status: 'idle', options: { provider: 'mock', model: 'whale' }, inbox: {},
      followup() {}, steer() {}, send() {}, inject() {}, cancel() {}, async whenIdle() {},
      runMaintenance: async <T>(task: (signal: AbortSignal) => Promise<T>) => task(new AbortController().signal),
    } as unknown as Agent
  }

  const members = (): TeamMemberView[] => [
    { id: lead!.session.id, name: 'lead', role: 'lead', status: 'idle', model: 'mock/whale', diagnostics: [] },
    { id: teammate!.session.id, name: 'builder', role: 'teammate', status: 'idle', description: 'build', provider: 'spawn', context: 'fresh', model: 'mock/whale', diagnostics: [] },
  ]
  const task = (revision = 1): TeamTaskView => ({
    id: 'task-1' as TeamTaskView['id'], revision, subject: 'Build', description: 'Implement', status: 'pending',
    blockedBy: [], writeScopes: ['src'], ready: true, writeScopeWarnings: [],
  })

  const teamService: TeamServiceLike = {
    tryMembership(agent) {
      if (agent === lead) return { root: lead, id: lead.session.id, role: 'lead', name: 'lead' } as never
      if (agent === teammate) return { root: lead!, id: lead!.session.id, role: 'teammate', name: 'builder' } as never
      return undefined
    },
    listMembers(agent) { calls.push({ name: 'listMembers', args: [agent] }); return members() },
    listTasks(agent) { calls.push({ name: 'listTasks', args: [agent] }); return [task()] },
    async spawnTeammate(agent, request) { calls.push({ name: 'spawnTeammate', args: [agent, request] }); return { member: members()[1]! } },
    async sendMessage(agent, request) { calls.push({ name: 'sendMessage', args: [agent, request] }); return { messageId: 'message-1' as never, status: 'accepted' } },
    async createTask(agent, request) { calls.push({ name: 'createTask', args: [agent, request] }); return task() },
    async updateTask(agent, request) {
      calls.push({ name: 'updateTask', args: [agent, request] })
      if (request.expectedRevision === 99) throw new Error('stale team task revision 99; current revision is 2')
      return task(request.expectedRevision + 1)
    },
    interrupt(agent, target) { calls.push({ name: 'interrupt', args: [agent, target] }); return { previousStatus: 'running' } },
    async waitForChange(agent, timeout, signal) { calls.push({ name: 'waitForChange', args: [agent, timeout, signal] }); return { timedOut: true } },
  }

  const services: Record<string, any> = {
    agentDefaultModel: { currentSelection: () => ({ provider: 'mock', model: 'whale' }), async saveSelection() {} },
    agents: {
      async create(options: CreateAgentOptions): Promise<AgentHandle> {
        lead = makeAgent(String(options.sessionId)); teammate = makeAgent('session-builder')
        await (options.setup as any)?.(ctx, lead)
        return { agent: lead, async dispose() {} }
      },
      async resume(options: ResumeAgentOptions): Promise<AgentHandle> {
        lead = makeAgent(String(options.resumeSessionId)); teammate = makeAgent('session-builder')
        await (options.setup as any)?.(ctx, lead)
        return { agent: lead, async dispose() {} }
      },
      list: () => [lead, teammate].filter(Boolean),
    },
    agentTeams: teamService,
    userQuestions: { registerProvider(provider: { ask(request: any): Promise<any> }) { questionProvider = provider; return () => { questionProvider = undefined } } },
    commands: { list: () => [], async execute() { return undefined } },
    permissionPresets: {
      names: ['workspace-write', 'danger-full-access'], current: () => 'workspace-write',
      set(session: Agent['session'], preset: string) { permissionSets.push({ id: String(session.id), preset }) },
    },
    sessionPersistence: {
      async list() { return [] },
      async open(id: ReturnType<typeof SessionId>, access: string) {
        readAccess = access
        return {
          header: { version: 3, id, createdAt: 1, cwd: 'C:\team' },
          async read() {
            return { events: [{ seq: 0, time: 1, type: 'user/message', data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'persisted' }] } }] }
          },
          async close() { closeCount += 1 },
        }
      },
    },
    sessionTitle: { rename() {} },
  }

  return {
    ctx, handlers, calls, permissionSets,
    get lead() { return lead! }, get teammate() { return teammate! },
    get closeCount() { return closeCount }, get readAccess() { return readAccess },
    get questionProvider() { return questionProvider },
    inactiveMember: { id: SessionId('session-offline'), name: 'offline', role: 'teammate', status: 'inactive', diagnostics: [] } as TeamMemberView,
  }
}

describe('Agent Teams controller facade', () => {
  it('forwards roster, fresh/fork creation, mailbox, interruption and every task action', async () => {
    const fx = teamFixture()
    const controller = new InteractionController(fx.ctx, 'abyss')
    await controller.start()
    await controller.teamView()
    await controller.spawnTeammate({ name: 'reviewer', description: 'Review code', prompt: 'Check it', context: 'fresh' })
    await controller.spawnTeammate({ name: 'forked-reviewer', description: 'Review context', prompt: 'Continue', context: 'fork' })
    await controller.sendTeamMessage('builder', 'Please continue')
    expect(controller.interruptTeammate('builder')).toBe('running')
    await controller.createTeamTask({ subject: 'Audit', description: 'Check source', blockedBy: ['task-1'], writeScopes: ['src', ' tests '] })
    const actions = ['claim', 'release', 'edit', 'set_dependencies', 'complete', 'reopen', 'reassign', 'delete'] as const
    for (const action of actions) await controller.updateTeamTask({ taskId: 'task-1' as never, expectedRevision: 1, action })

    const spawns = fx.calls.filter(call => call.name === 'spawnTeammate').map(call => call.args[1])
    expect(spawns[0]).toMatchObject({ name: 'reviewer', context: 'fresh', provider: 'spawn' })
    expect(spawns[0].prompt[0].text).toContain('You are teammate "reviewer"')
    expect(spawns[1]).toMatchObject({ context: 'fork', provider: 'fork' })
    expect(fx.calls.find(call => call.name === 'sendMessage')?.args[1]).toMatchObject({ target: 'builder', content: [{ type: 'text', text: 'Please continue' }] })
    expect(fx.calls.filter(call => call.name === 'updateTask').map(call => call.args[1].action)).toEqual(actions)
    const created = fx.calls.find(call => call.name === 'createTask')?.args[1]
    expect(created).toMatchObject({ subject: 'Audit', blockedBy: ['task-1'], writeScopes: ['src', 'tests'] })
    await controller.dispose()
  })

  it('does not retry a stale CAS update and validates names before the service', async () => {
    const fx = teamFixture()
    const controller = new InteractionController(fx.ctx, 'abyss')
    await controller.start()
    await expect(controller.updateTeamTask({ taskId: 'task-1' as never, expectedRevision: 99, action: 'claim' })).rejects.toThrow(/stale/iu)
    expect(fx.calls.filter(call => call.name === 'updateTask')).toHaveLength(1)
    await expect(controller.spawnTeammate({ name: 'Bad Name', description: 'x', prompt: 'x' })).rejects.toThrow(/lower-kebab/iu)
    expect(fx.calls.filter(call => call.name === 'spawnTeammate')).toHaveLength(0)
    await controller.dispose()
  })

  it('queues Team requests FIFO, changes only the source session permission, and cancels on switch', async () => {
    const fx = teamFixture()
    const controller = new InteractionController(fx.ctx, 'abyss')
    await controller.start()
    const approval = fx.handlers.get('approval/request')!.at(-1)!
    const first = approval({ agent: fx.lead, toolName: 'lead-tool' }, async () => 'unavailable')
    const second = approval({ agent: fx.teammate, toolName: 'team-tool' }, async () => 'unavailable')
    expect(controller.getSnapshot()).toMatchObject({ interactionCount: 2, interactionIndex: 0, approval: { toolName: 'lead-tool', source: { member: 'lead' } } })
    controller.selectInteraction(1)
    expect(controller.getSnapshot().approval).toMatchObject({ toolName: 'team-tool', source: { member: 'builder', role: 'teammate' } })
    expect(controller.answerApprovalWithPreset('danger-full-access')).toBe(true)
    expect(fx.permissionSets).toEqual([{ id: 'session-builder', preset: 'danger-full-access' }])
    await expect(second).resolves.toBe('allowed-once')
    expect(controller.getSnapshot().approval?.toolName).toBe('lead-tool')
    const switched = controller.switchSession()
    await expect(first).resolves.toBe('unavailable')
    await switched
    expect(controller.getSnapshot().interactionCount).toBe(0)
    await controller.dispose()
  })

  it('opens offline transcripts through a closed read-only SessionHandle', async () => {
    const fx = teamFixture()
    const controller = new InteractionController(fx.ctx, 'abyss')
    await controller.start()
    const lease = await controller.openMemberTranscript(fx.inactiveMember)
    expect(lease.live).toBe(false)
    expect(fx.readAccess).toBe('read')
    expect(fx.closeCount).toBe(1)
    expect(lease.store.getSnapshot().nodes).toMatchObject([{ kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'persisted' }] }])
    await lease.dispose()
    await controller.dispose()
  })

  it('removes an Agent-cancelled question and fails closed when the 32-item queue is full', async () => {
    const fx = teamFixture()
    const controller = new InteractionController(fx.ctx, 'abyss')
    await controller.start()
    const cancel = new AbortController()
    const question = fx.questionProvider!.ask({
      agent: fx.teammate, signal: cancel.signal,
      questions: [{ id: 'q', question: 'Continue?', options: [{ label: 'Yes' }] }],
    })
    expect(controller.getSnapshot().questions?.source).toMatchObject({ member: 'builder' })
    cancel.abort()
    await expect(question).rejects.toThrow(/cancelled/iu)
    expect(controller.getSnapshot().interactionCount).toBe(0)

    const approval = fx.handlers.get('approval/request')!.at(-1)!
    const pending = Array.from({ length: 32 }, (_, index) => approval({ agent: fx.lead, toolName: `tool-${index}` }, async () => 'unavailable'))
    expect(controller.getSnapshot().interactionCount).toBe(32)
    await expect(approval({ agent: fx.lead, toolName: 'overflow' }, async () => 'rejected')).resolves.toBe('unavailable')
    await controller.dispose()
    await expect(Promise.all(pending)).resolves.toEqual(Array.from({ length: 32 }, () => 'unavailable'))
  })

  it('leaves ordinary workflow children and unrelated Sessions to downstream handlers', async () => {
    const fx = teamFixture()
    const controller = new InteractionController(fx.ctx, 'abyss')
    await controller.start()
    const outsider = { ...fx.teammate, id: SessionId('session-workflow-child') } as Agent
    const approval = fx.handlers.get('approval/request')!.at(-1)!
    await expect(approval({ agent: outsider, toolName: 'workflow-tool' }, async () => 'rejected')).resolves.toBe('rejected')
    const questions = fx.handlers.get('user-questions/request')!.at(-1)!
    await expect(questions({ agent: outsider, questions: [{ id: 'q', question: 'x' }] }, async () => ({ answers: [{ id: 'downstream', selected: [] }] })))
      .resolves.toEqual({ answers: [{ id: 'downstream', selected: [] }] })
    expect(controller.getSnapshot().interactionCount).toBe(0)
    await controller.dispose()
  })
})
