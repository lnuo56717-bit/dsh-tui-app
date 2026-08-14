import type { Context } from '@deepseek-ai/cordis'
import {
  installModelSelection, type Agent, type AgentHandle, type ModelSelection, type ModelSelectionRef,
} from '@deepseek-ai/dsh-agent'
import { randomUUID } from 'node:crypto'
import { SessionId, type SessionHeader, type UserMessage } from '@deepseek-ai/dsh-session'
import {
  attachProjections, type AttachedProjections, type ProjectionRegistryLike, type ProjectionSnapshotView,
} from './projection-store.js'
import type { ThemeName } from './startup.js'
import { redactSecrets } from './ui/secrets.js'
import { foldSessionSummary, type SessionSummaryFacts } from './session-summary.js'
import { EMPTY_TRANSCRIPT, type EventLike } from './transcript-fold.js'
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
  /** True for the session this TUI already has open. */
  readonly current: boolean
}

/** Picker-facing description of one persisted conversation. */
export interface SessionSummary extends SessionSummaryFacts {
  readonly id: string
  /** Set when the durable log could not be read; the picker then shows the id. */
  readonly unreadable?: string
}

export interface SubagentChoice {
  readonly kind: 'child' | 'diagnostic'
  readonly id: string
  readonly parentId: string
  readonly depth: number
  readonly activity?: 'running' | 'inactive'
  readonly mode?: 'one-shot' | 'continuable'
  readonly label?: string
  readonly reason?: 'corrupt' | 'unsupported' | 'unavailable'
  readonly hasChildren?: boolean
}

export interface RuntimeSnapshot {
  readonly sessionId: string | undefined
  readonly cwd: string
  readonly model: string
  /** Explicit adapter-owned effort, or provider/model default behavior when absent. */
  readonly reasoningEffort?: string | undefined
  /** Exact-model context capacity when the adapter publishes it. */
  readonly contextWindow?: number | undefined
  readonly agentStatus: 'idle' | 'running' | 'starting' | 'switching'
  readonly permission: string | undefined
  readonly projection: ProjectionSnapshotView | undefined
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

interface StoredLog {
  readonly meta: SessionHeader
  readonly events: readonly EventLike[]
}
interface PersistenceService {
  list(signal?: AbortSignal): Promise<SessionHeader[]>
  /** Detached non-mutating suffix read; preferred for read-only picker facts. */
  readFrom?(id: ReturnType<typeof SessionId>, fromSeq: number, signal?: AbortSignal): Promise<StoredLog>
  /** Immutable logical view; used when a backend predates `readFrom`. */
  inspect?(id: ReturnType<typeof SessionId>, signal?: AbortSignal): Promise<StoredLog>
}
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

interface LlmProviderView { readonly id: string; readonly name: string }
interface LlmModelView {
  readonly provider: string
  readonly id: string
  readonly name: string
  readonly description?: string
}
interface LlmResolvedModelView extends LlmModelView {
  readonly inputModalities?: readonly string[]
  readonly context?: { readonly contextWindow: number }
  readonly reasoning?: {
    readonly efforts: readonly { readonly id: string; readonly name: string; readonly description?: string }[]
    readonly defaultEffort?: string
  }
}
interface LlmService {
  listProviders(): readonly LlmProviderView[]
  listModels(provider: string): Promise<readonly LlmModelView[]>
  resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelView>
  resolveCallConfig(config: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }, signal?: AbortSignal): Promise<{
    readonly provider: string
    readonly model: string
    readonly reasoningEffort?: string
  }>
}

export interface ModelChoice {
  readonly provider: string
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly current: boolean
}

export interface EffortChoice {
  /** Undefined means the adapter/provider default behavior. */
  readonly id: string | undefined
  readonly name: string
  readonly description?: string
  readonly current: boolean
}
interface SubagentService {
  listDescendants(rootSessionId: ReturnType<typeof SessionId>, signal?: AbortSignal): Promise<Array<{
    kind: 'child' | 'diagnostic'; id: ReturnType<typeof SessionId>; parentId: ReturnType<typeof SessionId>; depth: number
    activity?: 'running' | 'inactive'; mode?: 'one-shot' | 'continuable'; label?: string
    reason?: 'corrupt' | 'unsupported' | 'unavailable'; hasChildren?: boolean
  }>>
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
  { name: 'theme', description: 'Switch Abyss, Pearl, or automatic theme', source: 'tui', inputHint: 'abyss | pearl | auto' },
  { name: 'switch', description: 'Switch the live agent model on its next step', source: 'tui', inputHint: '[provider/model]' },
  { name: 'effort', description: 'Switch reasoning effort on the next model step', source: 'tui', inputHint: '[default | level]' },
  { name: 'model', description: 'Alias for /switch', source: 'tui', inputHint: '[provider/model]' },
  { name: 'always-approve', description: 'Select danger-full-access after explicit confirmation', source: 'tui' },
  { name: 'workflows', description: 'Summarize durable workflow runs', source: 'tui' },
  { name: 'mouse', description: 'Toggle wheel scrolling so the terminal can drag-select text', source: 'tui' },
] as const

export type LocalCommandAction = 'none' | 'quit' | 'help' | 'keys' | 'sessions' | 'models' | 'efforts' | 'session-info' | 'workflows' | 'confirm-danger' | 'confirm-new' | 'mouse'

export class InteractionController {
  readonly transcript = new TranscriptStore()
  private readonly listeners = new Set<() => void>()
  private readonly ctx: Context
  private snapshot: RuntimeSnapshot
  private handle: AgentHandle | undefined
  private selection: ModelSelectionRef | undefined
  private attached: AttachedTranscript | undefined
  private projections: AttachedProjections | undefined
  private questionProviderDispose: (() => void) | undefined
  private approval: ApprovalPending | undefined
  private questions: QuestionsPending | undefined
  private readonly summaries = new Map<string, SessionSummary>()
  private requestSeq = 0
  private modelOperation = 0
  private defaultSaveChain: Promise<void> = Promise.resolve()
  private accepting = false

  constructor(ctx: Context, theme: ThemeName) {
    this.ctx = ctx
    const selection = this.modelService().currentSelection()
    this.snapshot = {
      sessionId: undefined, cwd: process.cwd(), model: `${selection.provider}/${selection.model}`, agentStatus: 'starting',
      reasoningEffort: selection.reasoningEffort === undefined ? undefined : String(selection.reasoningEffort),
      permission: undefined, projection: undefined, theme, notice: undefined, error: undefined, approval: undefined, questions: undefined,
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

  private llmService(): LlmService {
    const service = this.ctx.get('llm') as LlmService | undefined
    if (service === undefined) throw new Error('LLM model catalog is unavailable')
    return service
  }

  private currentSelection(): ModelSelection {
    return this.selection?.current ?? this.modelService().currentSelection()
  }

  private async modelInfo(selection: ModelSelection): Promise<LlmResolvedModelView | undefined> {
    const service = this.ctx.get('llm') as LlmService | undefined
    if (service === undefined) return undefined
    try { return await service.resolveModelInfo(selection.provider, selection.model) } catch { return undefined }
  }

  private async open(resume?: string): Promise<void> {
    const agents = this.ctx.get('agents')
    if (agents === undefined) throw new Error('agents service is unavailable')
    const fallback = this.modelService()
    let picked: ModelSelection | undefined
    let scopedAgent: Agent | undefined
    const selected: ModelSelectionRef = {
      get current(): ModelSelection {
        if (picked !== undefined) return picked
        const header = (scopedAgent?.session as Agent['session'] & {
          requestHeader?: () => {
            config: { provider: string; model: string; reasoningEffort?: ModelSelection['reasoningEffort'] }
            adapterDefaults?: { reasoningEffort?: boolean }
          } | undefined
        } | undefined)?.requestHeader?.()
        if (header === undefined) return fallback.currentSelection()
        return {
          provider: header.config.provider,
          model: header.config.model,
          ...(header.config.reasoningEffort === undefined || header.adapterDefaults?.reasoningEffort === true
            ? {}
            : { reasoningEffort: header.config.reasoningEffort }),
        }
      },
      set current(next: ModelSelection | undefined) { picked = next },
      assembled: undefined,
    }
    const seed = selected.current ?? fallback.currentSelection()
    const setup = (agentCtx: Context): void => {
      scopedAgent = (agentCtx as Context & { agent?: Agent }).agent
      installModelSelection(agentCtx, selected)
      const scoped = agentCtx as unknown as ApprovalContext
      scoped.on('approval/request', (request, next) => this.askApproval(request, next))
      scoped.on('agent/status', ({ agent, status }) => {
        if (agent === this.handle?.agent || String(agent.id) === this.snapshot.sessionId) this.patch({ agentStatus: status })
      })
    }
    let handle: AgentHandle
    try {
      handle = resume === undefined
        ? await agents.create({
            sessionId: SessionId(`session-${randomUUID()}`), meta: { cwd: process.cwd() },
            agentOptions: { provider: seed.provider, model: seed.model }, setup,
          })
        : await agents.resume({
            resumeSessionId: SessionId(resume), agentOptions: { provider: seed.provider, model: seed.model }, setup,
          })
    } catch (error) {
      throw error
    }
    await handle.agent.whenIdle()
    scopedAgent ??= handle.agent
    this.selection = selected
    const selection = selected.current ?? seed
    const info = await this.modelInfo(selection)
    this.handle = handle
    this.attached = attachTranscript(handle.agent.ctx, handle.agent.session, this.transcript)
    const projectionRegistry = this.ctx.get('sessionProjections') as ProjectionRegistryLike<Agent['session']> | undefined
    if (projectionRegistry !== undefined) {
      this.projections = attachProjections(projectionRegistry, handle.agent.session, projection => this.patch({ projection }))
    }
    this.patch({
      sessionId: String(handle.agent.session.id), cwd: handle.agent.session.header.cwd ?? process.cwd(),
      model: `${selection.provider}/${selection.model}`, agentStatus: handle.agent.status,
      reasoningEffort: selection.reasoningEffort === undefined ? undefined : String(selection.reasoningEffort),
      contextWindow: info?.context?.contextWindow,
      permission: this.currentPermission(), notice: resume === undefined ? 'New session ready' : `Resumed ${resume}`,
      error: undefined,
    })
  }

  async switchSession(id?: string): Promise<void> {
    if (!this.accepting) return
    this.accepting = false
    this.modelOperation += 1
    this.patch({ agentStatus: 'switching', notice: id === undefined ? 'Creating a new session…' : `Resuming ${id}…`, error: undefined })
    this.settleBlocking('unavailable')
    this.attached?.dispose()
    this.attached = undefined
    this.projections?.dispose()
    this.projections = undefined
    this.transcript.replace(EMPTY_TRANSCRIPT)
    this.patch({ projection: undefined })
    await Promise.resolve()
    await this.handle?.dispose()
    this.handle = undefined
    this.selection = undefined
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

  /** Publish a transient status line from the view layer, redacted like any other notice. */
  notify(message: string): void {
    this.patch({ notice: redactSecrets(message), error: undefined })
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
      return this.handle === undefined ? this.fail('No active session') : 'session-info'
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
      if (input !== 'abyss' && input !== 'pearl' && input !== 'auto') return this.fail('Usage: /theme abyss|pearl|auto')
      this.patch({ theme: input, notice: `Theme changed to ${input}`, error: undefined })
      return 'none'
    }
    if (name === 'switch' || name === 'model') {
      if (input === '') return 'models'
      const route = parseModelRoute(input)
      if (route === undefined) return this.fail(`Usage: /${name} provider/model`)
      await this.switchModel(route.provider, route.model)
      return 'none'
    }
    if (name === 'effort') {
      if (input === '') return 'efforts'
      await this.switchEffort(input === 'default' || input === 'auto' ? undefined : input)
      return 'none'
    }
    if (name === 'mouse') return 'mouse'
    if (name === 'always-approve') return 'confirm-danger'
    if (name === 'workflows') {
      return 'workflows'
    }
    if (name === 'auto' || name === 'view-plan' || name === 'dashboard') return this.fail(`/${name} is not available in dsh rc.6`)
    return this.fail(`Unknown local command: /${name}`)
  }

  async listSessions(): Promise<SessionChoice[]> {
    const persistence = this.ctx.get('sessionPersistence') as PersistenceService | undefined
    if (persistence === undefined) throw new Error('Session persistence is unavailable')
    const rows = await persistence.list()
    // The live log keeps growing, so its folded summary must not be reused.
    if (this.snapshot.sessionId !== undefined) this.summaries.delete(this.snapshot.sessionId)
    const items = rows.map(header => ({
      id: String(header.id), cwd: header.cwd, createdAt: header.createdAt, current: String(header.id) === this.snapshot.sessionId,
    }))
    // Order by last activity — the folded log's newest event — not by creation
    // time, so a long-idle conversation sinks below one touched moments ago.
    // Folding every persisted log costs one read per session, but the folded
    // summaries are cached and reused by the picker rows as they scroll in.
    const ordered = await Promise.all(items.map(async item => ({
      item,
      activity: (await this.describeSession(item.id).catch(() => undefined))?.updatedAt ?? item.createdAt,
    })))
    return ordered.sort((left, right) => right.activity - left.activity).map(entry => entry.item)
  }

  /**
   * Fold one persisted log into the title, first prompt, prompt count, and last
   * activity the session picker shows instead of an opaque id. Read-only: it
   * never publishes, repairs, or resumes the session.
   */
  async describeSession(id: string, signal?: AbortSignal): Promise<SessionSummary> {
    const cached = this.summaries.get(id)
    if (cached !== undefined) return cached
    const persistence = this.ctx.get('sessionPersistence') as PersistenceService | undefined
    let summary: SessionSummary
    try {
      if (persistence === undefined) throw new Error('Session persistence is unavailable')
      const stored = persistence.readFrom !== undefined
        ? await persistence.readFrom(SessionId(id), 0, signal)
        : persistence.inspect !== undefined ? await persistence.inspect(SessionId(id), signal) : undefined
      if (stored === undefined) throw new Error('Session persistence exposes no readable log')
      summary = { id, ...foldSessionSummary(stored.events) }
    } catch (error) {
      summary = { id, prompts: 0, unreadable: redactSecrets(errorMessage(error)) }
    }
    this.summaries.set(id, summary)
    return summary
  }

  async listModels(): Promise<ModelChoice[]> {
    const llm = this.llmService()
    const current = this.currentSelection()
    const providers = llm.listProviders()
    const catalogs = await Promise.all(providers.map(async provider => {
      try { return await llm.listModels(provider.id) } catch { return [] }
    }))
    const choices: ModelChoice[] = catalogs.flatMap(models => models.map(model => ({
      provider: model.provider, id: model.id, name: model.name,
      ...(model.description === undefined ? {} : { description: model.description }),
      current: model.provider === current.provider && model.id === current.model,
    })))
    if (!choices.some(choice => choice.current)) {
      const resolved = await this.modelInfo(current)
      choices.unshift({
        provider: current.provider, id: current.model, name: resolved?.name ?? current.model,
        ...(resolved?.description === undefined ? {} : { description: resolved.description }), current: true,
      })
    }
    return choices
  }

  async listEfforts(): Promise<EffortChoice[]> {
    const selection = this.currentSelection()
    const info = await this.llmService().resolveModelInfo(selection.provider, selection.model)
    const selected = selection.reasoningEffort === undefined ? undefined : String(selection.reasoningEffort)
    const defaultName = info.reasoning?.defaultEffort === undefined
      ? 'Use provider/model default'
      : `Use model default (${info.reasoning.efforts.find(item => item.id === info.reasoning?.defaultEffort)?.name ?? info.reasoning.defaultEffort})`
    return [
      { id: undefined, name: 'Default', description: defaultName, current: selected === undefined },
      ...(info.reasoning?.efforts ?? []).map(effort => ({
        id: String(effort.id), name: effort.name,
        ...(effort.description === undefined ? {} : { description: effort.description }),
        current: selected === String(effort.id),
      })),
    ]
  }

  async switchModel(provider: string, model: string): Promise<boolean> {
    const selection = this.selection
    const handle = this.handle
    if (selection === undefined || handle === undefined) return this.failBoolean('No active session')
    const operation = ++this.modelOperation
    this.patch({ notice: `Resolving model ${provider}/${model}…`, error: undefined })
    try {
      const llm = this.llmService()
      const resolved = await llm.resolveCallConfig({ provider, model })
      const info = await llm.resolveModelInfo(resolved.provider, resolved.model)
      if (operation !== this.modelOperation || selection !== this.selection || handle !== this.handle) return false
      if (info.inputModalities !== undefined && !info.inputModalities.includes('image') && agentHasImage(handle.agent)) {
        throw new Error(`${resolved.provider}/${resolved.model} does not accept image input, but this session already contains images`)
      }
      const next: ModelSelection = {
        provider: resolved.provider, model: resolved.model,
      }
      selection.current = next
      this.patch({
        model: `${resolved.provider}/${resolved.model}`,
        reasoningEffort: undefined,
        contextWindow: info.context?.contextWindow,
        notice: this.snapshot.agentStatus === 'running'
          ? `Model applies to the next not-yet-assembled step: ${resolved.provider}/${resolved.model}`
          : `Model switched: ${resolved.provider}/${resolved.model}`,
        error: undefined,
      })
      await this.saveDefaultSelection(next, operation, selection, handle, 'Model switched for this session; saving it as the default failed')
      return true
    } catch (error) {
      if (operation !== this.modelOperation || selection !== this.selection || handle !== this.handle) return false
      this.fail(errorMessage(error))
      return false
    }
  }

  async switchEffort(effort: string | undefined): Promise<boolean> {
    const selection = this.selection
    const handle = this.handle
    if (selection === undefined || handle === undefined) return this.failBoolean('No active session')
    const operation = ++this.modelOperation
    this.patch({ notice: `Resolving reasoning effort ${effort ?? 'default'}…`, error: undefined })
    try {
      const current = this.currentSelection()
      const llm = this.llmService()
      const info = await llm.resolveModelInfo(current.provider, current.model)
      if (effort !== undefined && info.reasoning === undefined) throw new Error(`${current.provider}/${current.model} exposes no selectable reasoning efforts`)
      const resolved = await llm.resolveCallConfig({
        provider: current.provider, model: current.model,
        ...(effort === undefined ? {} : { reasoningEffort: effort }),
      })
      if (operation !== this.modelOperation || selection !== this.selection || handle !== this.handle) return false
      const next: ModelSelection = {
        provider: resolved.provider, model: resolved.model,
        ...(effort === undefined ? {} : { reasoningEffort: resolved.reasoningEffort as NonNullable<ModelSelection['reasoningEffort']> }),
      }
      selection.current = next
      this.patch({
        reasoningEffort: effort === undefined ? undefined : resolved.reasoningEffort,
        contextWindow: info.context?.contextWindow,
        notice: this.snapshot.agentStatus === 'running'
          ? `Reasoning effort applies to the next not-yet-assembled step: ${effort === undefined ? 'default' : resolved.reasoningEffort}`
          : `Reasoning effort: ${effort === undefined ? 'default' : resolved.reasoningEffort}`,
        error: undefined,
      })
      await this.saveDefaultSelection(next, operation, selection, handle, 'Reasoning effort changed for this session; saving it as the default failed')
      return true
    } catch (error) {
      if (operation !== this.modelOperation || selection !== this.selection || handle !== this.handle) return false
      this.fail(errorMessage(error))
      return false
    }
  }

  async listSubagents(): Promise<SubagentChoice[]> {
    const service = this.ctx.get('subagents') as SubagentService | undefined
    if (service === undefined || this.handle === undefined) return []
    const rows = await service.listDescendants(this.handle.agent.session.id)
    return rows.map(row => ({
      kind: row.kind, id: String(row.id), parentId: String(row.parentId), depth: row.depth,
      ...(row.activity === undefined ? {} : { activity: row.activity }),
      ...(row.mode === undefined ? {} : { mode: row.mode }),
      ...(row.label === undefined ? {} : { label: row.label }),
      ...(row.reason === undefined ? {} : { reason: row.reason }),
      ...(row.hasChildren === undefined ? {} : { hasChildren: row.hasChildren }),
    }))
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
    this.patch({ error: redactSecrets(message), notice: undefined })
    return 'none'
  }

  private failBoolean(message: string): false {
    this.fail(message)
    return false
  }

  private async saveDefaultSelection(next: ModelSelection, operation: number, selection: ModelSelectionRef, handle: AgentHandle, failureNotice: string): Promise<void> {
    const save = async (): Promise<void> => {
      if (operation !== this.modelOperation || selection !== this.selection || handle !== this.handle) return
      try {
        await this.modelService().saveSelection(next)
      } catch {
        if (operation === this.modelOperation && selection === this.selection && handle === this.handle) {
          this.patch({ notice: failureNotice, error: undefined })
        }
      }
    }
    const queued = this.defaultSaveChain.then(save, save)
    this.defaultSaveChain = queued
    await queued
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
    const next = { ...change }
    if (typeof next.error === 'string') next.error = redactSecrets(next.error)
    if (typeof next.notice === 'string') next.notice = redactSecrets(next.notice)
    this.snapshot = { ...this.snapshot, ...next }
    for (const listener of this.listeners) listener()
  }

  async dispose(): Promise<void> {
    this.accepting = false
    this.modelOperation += 1
    this.settleBlocking('unavailable')
    await Promise.resolve()
    this.questionProviderDispose?.()
    this.questionProviderDispose = undefined
    this.attached?.dispose()
    this.attached = undefined
    this.projections?.dispose()
    this.projections = undefined
    await this.handle?.dispose()
    this.handle = undefined
    this.selection = undefined
  }
}

function parseModelRoute(input: string): { provider: string; model: string } | undefined {
  const separator = input.indexOf('/')
  if (separator <= 0 || separator === input.length - 1) return undefined
  const provider = input.slice(0, separator).trim()
  const model = input.slice(separator + 1).trim()
  return provider === '' || model === '' ? undefined : { provider, model }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function contentHasImage(value: unknown, depth = 0): boolean {
  if (depth > 12 || value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(item => contentHasImage(item, depth + 1))
  const record = value as Record<string, unknown>
  if (record.type === 'image') return true
  return Object.values(record).some(item => contentHasImage(item, depth + 1))
}

function agentHasImage(agent: Agent): boolean {
  const session = agent.session as Agent['session'] & { deriveMessages?: () => readonly unknown[] }
  const inbox = agent.inbox as unknown as { nextTurn?: readonly unknown[]; nextStep?: readonly unknown[] }
  return contentHasImage(session.deriveMessages?.() ?? [])
    || contentHasImage(inbox.nextTurn ?? [])
    || contentHasImage(inbox.nextStep ?? [])
}
