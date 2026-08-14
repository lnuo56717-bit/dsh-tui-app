import type { Context } from '@deepseek-ai/cordis'
import {
  installModelSelection, type Agent, type AgentHandle, type ModelSelection, type ModelSelectionRef,
} from '@deepseek-ai/dsh-agent'
import { randomUUID } from 'node:crypto'
import { SessionId, type SessionHeader, type UserMessage } from '@deepseek-ai/dsh-session'
import type { ThemeName } from './startup.js'
import { EMPTY_TRANSCRIPT } from './transcript-fold.js'
import { attachTranscript, TranscriptStore, type AttachedTranscript } from './transcript-store.js'

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

export interface ApprovalRequestView {
  readonly id: number
  readonly toolName: string
  readonly callId: string | undefined
  readonly reason: string | undefined
}

export interface QuestionOptionView {
  readonly label: string
  readonly description?: string
}

export interface QuestionItemView {
  readonly id: string
  readonly question: string
  readonly detail: string | undefined
  readonly header: string | undefined
  readonly options: readonly QuestionOptionView[]
  readonly multiSelect: boolean
  readonly approve: string | undefined
}

export interface QuestionRequestView {
  readonly id: number
  readonly questions: readonly QuestionItemView[]
}

export interface QuestionAnswerItem {
  readonly id: string
  readonly selected: string[]
  readonly custom?: string
}

export interface CommandChoice {
  readonly name: string
  readonly description: string
  readonly source: 'dsh' | 'tui'
  readonly inputHint?: string
}

export interface SessionChoice {
  readonly id: string
  readonly cwd: string | undefined
  readonly createdAt: number
}

export interface RuntimeSnapshot {
  readonly sessionId: string | undefined
  readonly cwd: string
  readonly model: string
  readonly agentStatus: 'idle' | 'running' | 'starting' | 'switching'
  readonly permission: string | undefined
  readonly theme: ThemeName
  readonly notice: string | undefined
  readonly error: string | undefined
  readonly approval: ApprovalRequestView | undefined
  readonly questions: QuestionRequestView | undefined
}

interface ApprovalRequestLike {
  readonly agent: Agent
  readonly toolName: string
  readonly callId?: unknown
  readonly reason?: string
  readonly signal?: AbortSignal
}

interface QuestionRequestLike {
  readonly questions: Array<{
    id: string
    question: string
    detail?: string
    header?: string
    options?: QuestionOptionView[]
    multiSelect?: boolean
    intent?: { kind: 'plan-review'; approve: string }
  }>
  readonly agent?: Agent
  readonly signal?: AbortSignal
}

interface ApprovalPending {
  readonly id: number
  readonly request: ApprovalRequestLike
  readonly resolve: (outcome: ApprovalOutcome) => void
  readonly removeAbort: () => void
}

interface QuestionsPending {
  readonly id: number
  readonly request: QuestionRequestLike
  readonly resolve: (answer: { answers: QuestionAnswerItem[] }) => void
  readonly reject: (error: Error) => void
  readonly removeAbort: () => void
}

interface ApprovalContext {
  on(name: 'approval/request', listener: (request: ApprovalRequestLike, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>): () => void
  on(name: 'agent/status', listener: (payload: { agent: Agent; status: 'idle' | 'running' }) => void): () => void
}

interface CommandService {
  list(agent: Agent): readonly { name: string; description: string; input?: { hint: string } }[]
  execute(agent: Agent, line: string, signal: AbortSignal): Promise<{ result: { kind: 'success' | 'error'; text?: string } } | undefined>
}

interface PersistenceService { list(signal?: AbortSignal): Promise<SessionHeader[]> }
interface PermissionService {
  readonly names: readonly string[]
  current(events: Agent['session']['events']): string
  set(session: Agent['session'], name: string): void
}
interface QuestionService {
  registerProvider(provider: { ask(request: QuestionRequestLike): Promise<{ answers: QuestionAnswerItem[] }> }): () => void
}
interface TitleService { rename(session: Agent['session'], title: string): unknown }
interface DefaultModelService {
  currentSelection(): ModelSelection
  saveSelection(next: ModelSelection): Promise<void>
}

const LOCAL_COMMANDS: readonly CommandChoice[] = [
  { name: 'quit', description: 'Exit and restore the terminal', source: 'tui' },
  { name: 'exit', description: 'Alias for /quit', source: 'tui' },
  { name: 'help', description: 'Show command help', source: 'tui' },
  { name: 'keys', description: 'Show keyboard reference', source: 'tui' },
  { name: 'new', description: 'Create a fresh root session', source: 'tui' },
  { name: 'resume', description: 'Open the persisted session picker', source: 'tui' },
  { name: 'session-info', description: 'Show facts about this session', source: 'tui' },
  { name: 'rename', description: 'Rename this session', source: 'tui', inputHint: 'title' },
  { name: 'theme', description: 'Switch deep-ocean or mono theme', source: 'tui', inputHint: 'deep-ocean | mono' },
  { name: 'model', description: 'Save the next-session default model', source: 'tui', inputHint: 'provider/model' },
  { name: 'always-approve', description: 'Select danger-full-access after explicit confirmation', source: 'tui' },
  { name: 'workflows', description: 'Summarize durable workflow runs', source: 'tui' },
] as const

export type LocalCommandAction = 'none' | 'quit' | 'help' | 'keys' | 'sessions' | 'confirm-danger' | 'confirm-new'

export class InteractionController {
  readonly transcript = new TranscriptStore()
  private readonly listeners = new Set<() => void>()
  private readonly ctx: Context
  private snapshot: RuntimeSnapshot
  private handle: AgentHandle | undefined
  private attached: AttachedTranscript | undefined
  private questionProviderDispose: (() => void) | undefined
  private approval: ApprovalPending | undefined
  private questions: QuestionsPending | undefined
  private requestSeq = 0
  private accepting = false

  constructor(ctx: Context, theme: ThemeName) {
    this.ctx = ctx
    const selection = this.modelService().currentSelection()
    this.snapshot = {
      sessionId: undefined, cwd: process.cwd(), model: `${selection.provider}/${selection.model}`, agentStatus: 'starting',
      permission: undefined, theme, notice: undefined, error: undefined, approval: undefined, questions: undefined,
    }
  }

  readonly getSnapshot = (): RuntimeSnapshot => this.snapshot
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async start(resume?: string): Promise<void> {
    if (resume !== undefined && resume.trim() === '') throw new Error('resume session id must be non-empty')
    const questions = this.ctx.get('userQuestions') as QuestionService | undefined
    if (questions !== undefined) this.questionProviderDispose = questions.registerProvider({ ask: request => this.askQuestions(request) })
    try {
      await this.open(resume)
      this.accepting = true
    } catch (error) {
      this.questionProviderDispose?.()
      this.questionProviderDispose = undefined
      throw error
    }
  }

  private modelService(): DefaultModelService {
    const service = this.ctx.get('agentDefaultModel') as DefaultModelService | undefined
    if (service === undefined) throw new Error('agentDefaultModel is unavailable')
    return service
  }

  private async open(resume?: string): Promise<void> {
    const agents = this.ctx.get('agents')
    if (agents === undefined) throw new Error('agents service is unavailable')
    const selection = this.modelService().currentSelection()
    const setup = (agentCtx: Context): void => {
      const selected: ModelSelectionRef = { current: selection, assembled: undefined }
      installModelSelection(agentCtx, selected)
      const scoped = agentCtx as unknown as ApprovalContext
      scoped.on('approval/request', (request, next) => this.askApproval(request, next))
      scoped.on('agent/status', ({ agent, status }) => {
        if (agent === this.handle?.agent || String(agent.id) === this.snapshot.sessionId) this.patch({ agentStatus: status })
      })
    }
    const handle: AgentHandle = resume === undefined
      ? await agents.create({
          sessionId: SessionId(`session-${randomUUID()}`), meta: { cwd: process.cwd() },
          agentOptions: { provider: selection.provider, model: selection.model }, setup,
        })
      : await agents.resume({
          resumeSessionId: SessionId(resume), agentOptions: { provider: selection.provider, model: selection.model }, setup,
        })
    await handle.agent.whenIdle()
    this.handle = handle
    this.attached = attachTranscript(handle.agent.ctx, handle.agent.session, this.transcript)
    this.patch({
      sessionId: String(handle.agent.session.id), cwd: handle.agent.session.header.cwd ?? process.cwd(),
      model: `${selection.provider}/${selection.model}`, agentStatus: handle.agent.status,
      permission: this.currentPermission(), notice: resume === undefined ? 'New session ready' : `Resumed ${resume}`,
      error: undefined,
    })
  }

  async switchSession(id?: string): Promise<void> {
    if (!this.accepting) return
    this.accepting = false
    this.patch({ agentStatus: 'switching', notice: id === undefined ? 'Creating a new session…' : `Resuming ${id}…`, error: undefined })
    this.settleBlocking('unavailable')
    this.attached?.dispose()
    this.attached = undefined
    this.transcript.replace(EMPTY_TRANSCRIPT)
    await Promise.resolve()
    await this.handle?.dispose()
    this.handle = undefined
    try {
      await this.open(id)
    } catch (error) {
      this.patch({
        agentStatus: 'idle', error: error instanceof Error ? error.message : String(error),
        notice: undefined, sessionId: undefined,
      })
    } finally {
      this.accepting = true
    }
  }

  submit(text: string, steer = false): void {
    const agent = this.handle?.agent
    const normalized = text.trim()
    if (!this.accepting || agent === undefined || normalized === '') return
    const message: UserMessage = {
      id: `tui-${randomUUID()}` as UserMessage['id'], role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text }],
    }
    if (steer) agent.steer(message)
    else agent.followup(message)
    this.patch({ agentStatus: agent.status, notice: steer ? 'Steering current/next step' : agent.status === 'running' ? 'Follow-up queued' : 'Prompt sent', error: undefined })
  }

  cancel(): boolean {
    const agent = this.handle?.agent
    if (agent?.status !== 'running') return false
    agent.cancel({ kind: 'user' })
    this.patch({ notice: 'Cancelling active turn…' })
    return true
  }

  commandChoices(): CommandChoice[] {
    const agent = this.handle?.agent
    const commands = this.ctx.get('commands') as CommandService | undefined
    const dsh = agent === undefined || commands === undefined ? [] : commands.list(agent).map(item => ({
      name: item.name, description: item.description, source: 'dsh' as const,
      ...(item.input === undefined ? {} : { inputHint: item.input.hint }),
    }))
    return [...dsh, ...LOCAL_COMMANDS].sort((left, right) => left.name.localeCompare(right.name) || left.source.localeCompare(right.source))
  }

  async executeCommand(line: string, source: 'dsh' | 'tui'): Promise<LocalCommandAction> {
    const parsed = /^\/([^\s]+)([\s\S]*)$/.exec(line.trimEnd())
    if (parsed === null) return 'none'
    const name = parsed[1]!.toLowerCase()
    const input = parsed[2]!.trim()
    if (source === 'dsh') {
      const agent = this.handle?.agent
      const service = this.ctx.get('commands') as CommandService | undefined
      if (agent === undefined || service === undefined) return this.fail('Command service is unavailable')
      const result = await service.execute(agent, line, new AbortController().signal)
      if (result === undefined) return this.fail(`Unknown dsh command: /${name}`)
      this.patch(result.result.kind === 'error' ? { error: result.result.text ?? `/${name} failed` } : { notice: result.result.text ?? `/${name} completed`, error: undefined })
      return 'none'
    }
    if (name === 'quit' || name === 'exit') return 'quit'
    if (name === 'help') return 'help'
    if (name === 'keys') return 'keys'
    if (name === 'resume') return 'sessions'
    if (name === 'new') {
      if (this.handle?.agent.status === 'running') return 'confirm-new'
      await this.switchSession(); return 'none'
    }
    if (name === 'session-info') {
      const agent = this.handle?.agent
      this.patch({ notice: agent === undefined ? 'No active session' : `${agent.id} · ${agent.session.header.cwd ?? 'cwd unknown'} · ${this.snapshot.model} · ${this.currentPermission() ?? 'permission unavailable'}` })
      return 'none'
    }
    if (name === 'rename') {
      if (input === '') return this.fail('Usage: /rename <title>')
      const title = this.ctx.get('sessionTitle') as TitleService | undefined
      if (title === undefined || this.handle === undefined) return this.fail('Session title service is unavailable')
      title.rename(this.handle.agent.session, input)
      this.patch({ notice: `Renamed session to “${input}”`, error: undefined })
      return 'none'
    }
    if (name === 'theme') {
      if (input !== 'deep-ocean' && input !== 'mono') return this.fail('Usage: /theme deep-ocean|mono')
      this.patch({ theme: input, notice: `Theme changed to ${input}`, error: undefined })
      return 'none'
    }
    if (name === 'model') {
      const separator = input.indexOf('/')
      if (separator <= 0 || separator === input.length - 1) return this.fail('Usage: /model provider/model')
      const next: ModelSelection = { provider: input.slice(0, separator), model: input.slice(separator + 1) }
      await this.modelService().saveSelection(next)
      this.patch({ notice: `Saved ${input} for the next session; live agent unchanged`, error: undefined })
      return 'none'
    }
    if (name === 'always-approve') return 'confirm-danger'
    if (name === 'workflows') {
      const count = this.transcript.getSnapshot().nodes.filter(node => node.kind === 'workflow').length
      this.patch({ notice: `${count} durable workflow run${count === 1 ? '' : 's'} in this transcript` })
      return 'none'
    }
    if (name === 'auto' || name === 'view-plan' || name === 'dashboard') return this.fail(`/${name} is not available in dsh rc.6`)
    return this.fail(`Unknown local command: /${name}`)
  }

  async listSessions(): Promise<SessionChoice[]> {
    const persistence = this.ctx.get('sessionPersistence') as PersistenceService | undefined
    if (persistence === undefined) throw new Error('Session persistence is unavailable')
    const rows = await persistence.list()
    return rows.map(header => ({ id: String(header.id), cwd: header.cwd, createdAt: header.createdAt }))
      .sort((left, right) => right.createdAt - left.createdAt)
  }

  permissionNames(): readonly string[] {
    return (this.ctx.get('permissionPresets') as PermissionService | undefined)?.names ?? []
  }

  selectPermission(name: string): boolean {
    const permissions = this.ctx.get('permissionPresets') as PermissionService | undefined
    const session = this.handle?.agent.session
    if (permissions === undefined || session === undefined) { this.fail('Permission presets are unavailable'); return false }
    try {
      permissions.set(session, name)
      this.patch({ permission: permissions.current(session.events), notice: `Permission preset: ${name}`, error: undefined })
      return true
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  cyclePermission(): void {
    const names = this.permissionNames()
    if (names.length === 0) return
    const current = this.currentPermission()
    const index = Math.max(-1, names.indexOf(current ?? ''))
    this.selectPermission(names[(index + 1) % names.length]!)
  }

  answerApproval(outcome: 'allowed-once' | 'rejected'): void {
    const pending = this.approval
    if (pending === undefined) return
    this.approval = undefined
    pending.removeAbort()
    pending.resolve(outcome)
    this.patch({ approval: undefined, notice: outcome === 'allowed-once' ? 'Allowed once' : 'Rejected' })
  }

  answerApprovalWithPreset(name: string): boolean {
    if (this.approval === undefined || !this.selectPermission(name)) return false
    this.answerApproval('allowed-once')
    return true
  }

  answerQuestions(answers: QuestionAnswerItem[]): void {
    const pending = this.questions
    if (pending === undefined) return
    this.questions = undefined
    pending.removeAbort()
    pending.resolve({ answers })
    this.patch({ questions: undefined, notice: 'Answers submitted' })
  }

  private askApproval(request: ApprovalRequestLike, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome> {
    if (request.agent !== this.handle?.agent) return next()
    if (request.signal?.aborted === true) return Promise.resolve('cancelled')
    if (this.approval !== undefined) return Promise.resolve('unavailable')
    const id = ++this.requestSeq
    return new Promise(resolve => {
      const abort = (): void => {
        if (this.approval?.id !== id) return
        this.approval = undefined
        resolve('cancelled')
        this.patch({ approval: undefined, notice: 'Approval request cancelled' })
      }
      request.signal?.addEventListener('abort', abort, { once: true })
      this.approval = { id, request, resolve, removeAbort: () => request.signal?.removeEventListener('abort', abort) }
      this.patch({ approval: { id, toolName: request.toolName, callId: request.callId === undefined ? undefined : String(request.callId), reason: request.reason } })
    })
  }

  private askQuestions(request: QuestionRequestLike): Promise<{ answers: QuestionAnswerItem[] }> {
    if (request.agent !== undefined && request.agent !== this.handle?.agent) return Promise.reject(new Error('Question caller is not the active root agent'))
    if (request.signal?.aborted === true) return Promise.reject(new Error('Question request cancelled'))
    if (this.questions !== undefined) return Promise.reject(new Error('Another question request is already active'))
    const id = ++this.requestSeq
    return new Promise((resolve, reject) => {
      const abort = (): void => {
        if (this.questions?.id !== id) return
        this.questions = undefined
        reject(new Error('Question request cancelled'))
        this.patch({ questions: undefined, notice: 'Question request cancelled' })
      }
      request.signal?.addEventListener('abort', abort, { once: true })
      this.questions = { id, request, resolve, reject, removeAbort: () => request.signal?.removeEventListener('abort', abort) }
      this.patch({ questions: {
        id,
        questions: request.questions.map(question => ({
          id: question.id, question: question.question, options: question.options ?? [], multiSelect: question.multiSelect ?? false,
          detail: question.detail,
          header: question.header,
          approve: question.intent?.kind === 'plan-review' ? question.intent.approve : undefined,
        })),
      } })
    })
  }

  private currentPermission(): string | undefined {
    const permissions = this.ctx.get('permissionPresets') as PermissionService | undefined
    return permissions === undefined || this.handle === undefined ? undefined : permissions.current(this.handle.agent.session.events)
  }

  private fail(message: string): LocalCommandAction {
    this.patch({ error: message, notice: undefined })
    return 'none'
  }

  private settleBlocking(outcome: ApprovalOutcome): void {
    if (this.approval !== undefined) {
      const pending = this.approval
      this.approval = undefined
      pending.removeAbort()
      pending.resolve(outcome)
    }
    if (this.questions !== undefined) {
      const pending = this.questions
      this.questions = undefined
      pending.removeAbort()
      pending.reject(new Error('TUI interaction unavailable'))
    }
    this.patch({ approval: undefined, questions: undefined })
  }

  private patch(change: Partial<RuntimeSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...change }
    for (const listener of this.listeners) listener()
  }

  async dispose(): Promise<void> {
    this.accepting = false
    this.settleBlocking('unavailable')
    await Promise.resolve()
    this.questionProviderDispose?.()
    this.questionProviderDispose = undefined
    this.attached?.dispose()
    this.attached = undefined
    await this.handle?.dispose()
    this.handle = undefined
  }
}
