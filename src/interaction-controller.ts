import type { Context } from '@deepseek-ai/cordis'
import {
  installModelSelection, type Agent, type AgentHandle, type CreateAgentOptions, type ModelSelection, type ModelSelectionRef,
} from '@deepseek-ai/dsh-agent'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { SessionId, SessionLogOffset, type SessionEvent, type SessionHeader, type UserMessage } from '@deepseek-ai/dsh-session'
import {
  attachProjections, type AttachedProjections, type ProjectionRegistryLike, type ProjectionSnapshotView,
} from './projection-store.js'
import type { ThemeName } from './startup.js'
import { redactSecrets } from './ui/secrets.js'
import { parseRawSessionEvents, repairedSeed } from './session-repair.js'
import { foldSessionSummary, type SessionSummaryFacts } from './session-summary.js'
import { EMPTY_TRANSCRIPT, foldEvents, type EventLike } from './transcript-fold.js'
import { attachTranscript, TranscriptStore, type AttachedTranscript } from './transcript-store.js'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { loadClipboardImage, loadImageFile, unquotePath, type LoadedImage } from './image-input.js'
import { VISION_MODEL_ID } from './vision-models.js'
import { eventLikes, sessionEventLikes, sessionEvents } from './harness-compat.js'
import {
  foldTeamActivity, TEAMMATE_NAME, teammatePrompt, teamTaskId,
  type TeamActivityItem, type TeamMemberView, type TeamServiceLike, type TeamTaskView, type TeamViewSnapshot,
  type UpdateTeamTaskRequest,
} from './team.js'

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

export interface ApprovalRequestView {
  readonly id: number
  readonly toolName: string
  readonly callId: string | undefined
  readonly reason: string | undefined
  readonly source?: InteractionSourceView
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
  readonly source?: InteractionSourceView
}

export interface InteractionSourceView {
  readonly member: string
  readonly role: 'lead' | 'teammate'
  readonly sessionId: string
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
  readonly interactionCount?: number
  readonly interactionIndex?: number
  readonly teamSummary?: TeamSummaryView | undefined
  /** Images staged for the next prompt; not yet in the session log. */
  readonly pendingImages: readonly PendingImageView[]
  /** Whether the live model advertises image input. */
  readonly imageInput: boolean
}

export interface TeamSummaryView {
  readonly teammates: number
  readonly running: number
  readonly pendingTasks: number
}

export interface PendingImageView {
  readonly name: string
  readonly width: number
  readonly height: number
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

interface InteractionPendingBase {
  readonly id: number
  readonly source: InteractionSourceView
  readonly agent: Agent
  readonly removeAbort: () => void
}

interface ApprovalPending extends InteractionPendingBase {
  readonly kind: 'approval'
  readonly request: ApprovalRequestLike
  readonly resolve: (outcome: ApprovalOutcome) => void
}

interface QuestionsPending extends InteractionPendingBase {
  readonly kind: 'questions'
  readonly id: number
  readonly request: QuestionRequestLike
  readonly resolve: (answer: { answers: QuestionAnswerItem[] }) => void
  readonly reject: (error: Error) => void
}

type InteractionPending = ApprovalPending | QuestionsPending

interface ApprovalContext {
  on(name: 'approval/request', listener: (request: ApprovalRequestLike, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>): () => void
  on(name: 'agent/status', listener: (payload: { agent: Agent; status: 'idle' | 'running' }) => void): () => void
  on(name: 'user-questions/request', listener: (
    request: QuestionRequestLike,
    next: () => Promise<{ answers: QuestionAnswerItem[] }>,
  ) => Promise<{ answers: QuestionAnswerItem[] }>): () => void
}

interface AgentRegistryService {
  list(): readonly Agent[]
}

interface CommandService {
  list(agent: Agent): readonly { name: string; description: string; input?: { hint: string } }[]
  execute(
    agent: Agent,
    line: string,
    attachmentsOrSignal: readonly unknown[] | AbortSignal,
    signal?: AbortSignal,
  ): Promise<{ result: { kind: 'success' | 'error'; text?: string } } | undefined>
}

interface StoredLog {
  readonly meta: SessionHeader
  readonly events: readonly EventLike[]
}
interface PersistenceService {
  list(options?: AbortSignal | { readonly signal?: AbortSignal }): Promise<readonly (SessionHeader | { readonly header: SessionHeader })[]>
  /** Session V3 read API. The returned handle must always be closed. */
  open?(id: ReturnType<typeof SessionId>, access: 'read', options?: { readonly signal?: AbortSignal }): Promise<{
    readonly header: SessionHeader
    read(offset?: number, length?: number, options?: { readonly signal?: AbortSignal }): Promise<{ readonly events: readonly SessionEvent[] }>
    close(): Promise<void>
  }>
  /** Detached non-mutating suffix read; preferred for read-only picker facts. */
  readFrom?(id: ReturnType<typeof SessionId>, fromSeq: number, signal?: AbortSignal): Promise<StoredLog>
  /** Immutable logical view; used when a backend predates `readFrom`. */
  inspect?(id: ReturnType<typeof SessionId>, signal?: AbortSignal): Promise<StoredLog>
  /** The backend's own raw artifact text; the rescue read when `readFrom` rejects a torn log. */
  readRaw?(id: ReturnType<typeof SessionId>, signal?: AbortSignal): Promise<{ meta: SessionHeader; content: string } | undefined>
  /** Side-effect-free artifact location; used to remove an abandoned empty session. */
  locate?(meta: SessionHeader): { readonly kind: string; readonly path: string } | undefined
}
interface PermissionService {
  readonly names: readonly string[]
  current(subject: Agent['session'] | readonly SessionEvent[]): string
  set(session: Agent['session'], name: string): void
}
interface QuestionService {
  /** Pre-v3 provider seam retained for staged host upgrades. */
  registerProvider?(provider: { ask(request: QuestionRequestLike): Promise<{ answers: QuestionAnswerItem[] }> }): () => void
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

export interface SpawnTeammateInput {
  readonly name: string
  readonly description: string
  readonly prompt: string
  readonly context?: 'fresh' | 'fork'
}

export interface CreateTeamTaskInput {
  readonly subject: string
  readonly description: string
  readonly blockedBy?: readonly string[]
  readonly writeScopes?: readonly string[]
}

export interface MemberTranscriptLease {
  readonly store: TranscriptStore
  readonly live: boolean
  dispose(): void | Promise<void>
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
  { name: 'team', description: 'Open the Agent Teams control center', source: 'tui' },
  { name: 'mouse', description: 'Toggle wheel scrolling so the terminal can drag-select text', source: 'tui' },
  { name: 'image', description: 'Attach a clipboard or file image for the vision model', source: 'tui', inputHint: '[path | clear]' },
] as const

export type LocalCommandAction = 'none' | 'quit' | 'help' | 'keys' | 'sessions' | 'models' | 'efforts' | 'session-info' | 'workflows' | 'team' | 'confirm-danger' | 'confirm-new' | 'mouse'

interface PendingImage {
  readonly attachment: ImageAttachmentRef
}

interface DraftMessage {
  readonly text: string
  readonly images: readonly PendingImage[]
}

interface AttachmentService {
  readonly imageLimits: { readonly maxImagesPerMessage: number }
  saveImage(input: { data: Uint8Array; mediaType: ImageAttachmentRef['mediaType']; name?: string }): Promise<ImageAttachmentRef>
}

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
  private readonly eventDisposers: Array<() => void> = []
  private interactions: InteractionPending[] = []
  private interactionIndex = 0
  private readonly summaries = new Map<string, SessionSummary>()
  private requestSeq = 0
  private modelOperation = 0
  private takeOverSeq = 0
  private defaultSaveChain: Promise<void> = Promise.resolve()
  private accepting = false
  private pendingImages: PendingImage[] = []
  private runningDrafts: DraftMessage[] = []
  private imageInput = false

  constructor(ctx: Context, theme: ThemeName) {
    this.ctx = ctx
    const selection = this.modelService().currentSelection()
    this.snapshot = {
      sessionId: undefined, cwd: process.cwd(), model: `${selection.provider}/${selection.model}`, agentStatus: 'starting',
      reasoningEffort: selection.reasoningEffort === undefined ? undefined : String(selection.reasoningEffort),
      permission: undefined, projection: undefined, theme, notice: undefined, error: undefined, approval: undefined, questions: undefined,
      interactionCount: 0, interactionIndex: 0, teamSummary: undefined,
      pendingImages: [], imageInput: false,
    }
  }

  readonly getSnapshot = (): RuntimeSnapshot => this.snapshot
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async start(resume?: string): Promise<void> {
    if (resume !== undefined && resume.trim() === '') throw new Error('resume session id must be non-empty')
    const scoped = this.ctx as unknown as ApprovalContext
    this.eventDisposers.push(
      scoped.on('approval/request', (request, next) => this.askApproval(request, next)),
      scoped.on('user-questions/request', (request, next) => this.routeQuestions(request, next)),
      scoped.on('agent/status', ({ agent, status }) => this.handleAgentStatus(agent, status)),
    )
    const questions = this.ctx.get('userQuestions') as QuestionService | undefined
    if (questions?.registerProvider !== undefined) {
      this.questionProviderDispose = questions.registerProvider({ ask: request => this.askQuestions(request) })
    }
    try {
      await this.open(resume)
      this.accepting = true
    } catch (error) {
      for (const dispose of this.eventDisposers.splice(0)) dispose()
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
    const setup = (agentCtx: Context, agent?: Agent): void => {
      scopedAgent = agent ?? (agentCtx as Context & { agent?: Agent }).agent
      installModelSelection(agentCtx, selected)
    }
    let handle: AgentHandle
    let notice = resume === undefined ? 'New session ready' : `Resumed ${resume}`
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
      if (resume === undefined) throw error
      const recovered = await this.repairedSeed(resume)
      if (recovered === undefined) throw error
      const persistence = this.ctx.get('sessionPersistence') as PersistenceService | undefined
      const legacyRecovery = persistence?.readRaw !== undefined && persistence.open === undefined
      const recoveryOptions = {
        sessionId: SessionId(`session-${randomUUID()}`),
        seed: recovered,
        meta: legacyRecovery
          ? { cwd: process.cwd(), parentSession: SessionId(resume), seedLength: recovered.length }
          : { cwd: process.cwd(), parentSession: SessionId(resume), isSeeded: true },
        ...(legacyRecovery ? {} : { inheritedEventCount: SessionLogOffset(recovered.length) }),
        agentOptions: { provider: seed.provider, model: seed.model }, setup,
      } as unknown as CreateAgentOptions
      handle = await agents.create(recoveryOptions)
      notice = 'Opened a repaired copy — the stored log has a seq gap'
    }
    await handle.agent.whenIdle()
    scopedAgent ??= handle.agent
    this.selection = selected
    const selection = selected.current ?? seed
    const info = await this.modelInfo(selection)
    this.pendingImages = []
    this.runningDrafts = []
    this.imageInput = info?.inputModalities?.includes('image') === true
    this.handle = handle
    this.attached = attachTranscript(handle.agent.ctx, handle.agent.session, this.transcript, handle.agent)
    const projectionRegistry = this.ctx.get('sessionProjections') as ProjectionRegistryLike<Agent['session']> | undefined
    if (projectionRegistry !== undefined) {
      this.projections = attachProjections(projectionRegistry, handle.agent.session, projection => this.patch({ projection }))
    }
    this.patch({
      sessionId: String(handle.agent.session.id), cwd: handle.agent.session.header.cwd ?? process.cwd(),
      model: `${selection.provider}/${selection.model}`, agentStatus: handle.agent.status,
      reasoningEffort: selection.reasoningEffort === undefined ? undefined : String(selection.reasoningEffort),
      contextWindow: info?.context?.contextWindow,
      permission: this.currentPermission(), notice, error: undefined,
      pendingImages: [], imageInput: this.imageInput,
    })
    void this.refreshTeamSummary()
  }

  async switchSession(id?: string): Promise<void> {
    if (!this.accepting) return
    this.accepting = false
    this.modelOperation += 1
    this.patch({ agentStatus: 'switching', notice: id === undefined ? 'Creating a new session…' : `Resuming ${id}…`, error: undefined })
    this.settleBlocking('unavailable')
    await this.releaseHandle()
    try {
      await this.open(id)
    } catch (error) {
      try {
        await this.open()
        this.patch({ error: error instanceof Error ? error.message : String(error) })
      } catch {
        this.patch({
          agentStatus: 'idle', error: error instanceof Error ? error.message : String(error),
          notice: undefined, sessionId: undefined,
        })
      }
    } finally {
      this.accepting = true
    }
  }

  submit(text: string, steer = false): void {
    const agent = this.handle?.agent
    const images = this.pendingImages
    const normalized = text.trim()
    if (!this.accepting || agent === undefined || (normalized === '' && images.length === 0)) return
    if (images.length > 0 && !this.imageInput) {
      this.fail(`Current model does not accept images. /switch to deepseek-official/${VISION_MODEL_ID}`)
      return
    }
    const content: UserMessage['content'] = [
      ...images.map(image => ({ type: 'image' as const, attachment: image.attachment })),
      ...normalized === '' ? [] : [{ type: 'text' as const, text }],
    ]
    const message: UserMessage = {
      id: `tui-${randomUUID()}` as UserMessage['id'], role: 'user', source: { kind: 'user' },
      content,
    }
    this.pendingImages = []
    if (agent.status === 'running') this.runningDrafts.push({ text, images })
    else this.runningDrafts = []
    if (steer) agent.steer(message)
    else agent.followup(message)
    this.patch({
      agentStatus: agent.status,
      notice: steer ? 'Steering current/next step' : agent.status === 'running' ? 'Follow-up queued' : 'Prompt sent',
      error: undefined,
      pendingImages: [],
    })
  }

  /** Publish a transient status line from the view layer, redacted like any other notice. */
  notify(message: string): void {
    this.patch({ notice: redactSecrets(message), error: undefined })
  }

  async attachClipboardImage(): Promise<boolean> {
    const loaded = await loadClipboardImage()
    if (loaded === undefined) return this.failBoolean('Clipboard has no image')
    return this.attachLoaded(loaded)
  }

  async attachImagePath(path: string): Promise<boolean> {
    try {
      return await this.attachLoaded(await loadImageFile(unquotePath(path)))
    } catch (error) {
      return this.failBoolean(errorMessage(error))
    }
  }

  removeLastImage(): boolean {
    if (this.pendingImages.length === 0) return false
    this.pendingImages = this.pendingImages.slice(0, -1)
    this.patch({ pendingImages: this.pendingViews(), error: undefined, notice: this.pendingImages.length === 0 ? 'Removed last image' : `Images ${this.pendingImages.length}` })
    return true
  }

  clearImages(): void {
    this.pendingImages = []
    this.patch({ pendingImages: [], notice: 'Cleared attached images', error: undefined })
  }

  private async attachLoaded(loaded: LoadedImage): Promise<boolean> {
    const attachments = this.ctx.get('attachments') as AttachmentService | undefined
    if (attachments === undefined) return this.failBoolean('Attachment service is unavailable')
    if (this.pendingImages.length >= attachments.imageLimits.maxImagesPerMessage) {
      return this.failBoolean(`At most ${attachments.imageLimits.maxImagesPerMessage} images per prompt`)
    }
    try {
      const input = loaded.name === undefined
        ? { data: loaded.data, mediaType: loaded.mediaType }
        : { data: loaded.data, mediaType: loaded.mediaType, name: loaded.name }
      const attachment = await attachments.saveImage(input)
      this.pendingImages = [...this.pendingImages, { attachment }]
      const hint = this.imageInput ? '' : ` · switch to ${VISION_MODEL_ID} before sending`
      this.patch({
        pendingImages: this.pendingViews(),
        notice: `Attached ${attachment.name ?? loaded.name} (${attachment.width}×${attachment.height})${hint}`,
        error: undefined,
      })
      return true
    } catch (error) {
      return this.failBoolean(errorMessage(error))
    }
  }

  private pendingViews(): PendingImageView[] {
    return this.pendingImages.map(image => ({
      name: image.attachment.name ?? 'image',
      width: image.attachment.width,
      height: image.attachment.height,
    }))
  }

  /**
   * Abort the active turn. With `keepInbox` the just-sent draft survives in
   * the inbox: the aborted activity converges and the agent immediately starts
   * the next turn with it — the double-Enter "take over" gesture.
   */
  cancel(keepInbox = false): boolean {
    const agent = this.handle?.agent
    if (agent?.status !== 'running') return false
    this.takeOverSeq += 1
    if (!keepInbox) this.runningDrafts = []
    agent.cancel({ kind: 'user' }, keepInbox ? { keepInbox: true } : {})
    this.patch({ notice: keepInbox ? 'Taking over with your message…' : 'Cancelling active turn…' })
    return true
  }

  /**
   * Double-Enter interject: abort the in-flight turn, then re-issue the
   * queued drafts once the driver is actually idle. Calling `followup`
   * on the same stack as `cancel` re-enters the harness mid-convergence
   * and can freeze the process. `keepInbox` is not used: cancel would
   * keep the parked messages but never wake the driver.
   */
  takeOver(texts: readonly string[]): boolean {
    const agent = this.handle?.agent
    const handle = this.handle
    const drafts = this.runningDrafts.splice(0)
    const pending = drafts.length > 0
      ? drafts
      : texts.map(text => ({ text, images: [] as PendingImage[] })).filter(item => item.text.trim() !== '')
    if (agent === undefined || handle === undefined || pending.length === 0) return false
    if (agent.status !== 'running') return false
    const seq = ++this.takeOverSeq
    agent.cancel({ kind: 'user' }, {})
    this.patch({ notice: 'Taking over with your message…', error: undefined })
    // Leave the cancel stack before waiting or waking. Same-stack followup
    // re-enters the harness and can freeze the process.
    queueMicrotask(() => {
      if (seq !== this.takeOverSeq || this.handle !== handle) return
      void agent.whenIdle().then(() => {
        if (seq !== this.takeOverSeq || this.handle !== handle || this.handle.agent !== agent) return
        if (agent.status === 'running') return
        for (const draft of pending) {
          const content: UserMessage['content'] = [
            ...draft.images.map(image => ({ type: 'image' as const, attachment: image.attachment })),
            ...draft.text.trim() === '' ? [] : [{ type: 'text' as const, text: draft.text }],
          ]
          if (content.length === 0) continue
          agent.followup({
            id: `tui-${randomUUID()}` as UserMessage['id'], role: 'user', source: { kind: 'user' },
            content,
          })
        }
        this.patch({ agentStatus: agent.status, notice: 'Taking over with your message…', error: undefined })
      })
    })
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
      const signal = new AbortController().signal
      const result = service.execute.length >= 4
        ? await service.execute(agent, line, [], signal)
        : await service.execute(agent, line, signal)
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
    if (name === 'image') {
      if (input === 'clear') { this.clearImages(); return 'none' }
      if (input === '') {
        await this.attachClipboardImage()
        return 'none'
      }
      await this.attachImagePath(input)
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
    if (name === 'team') return 'team'
    if (name === 'auto' || name === 'view-plan' || name === 'dashboard') return this.fail(`/${name} is not exposed by this TUI`)
    return this.fail(`Unknown local command: /${name}`)
  }

  async listSessions(): Promise<SessionChoice[]> {
    const persistence = this.ctx.get('sessionPersistence') as PersistenceService | undefined
    if (persistence === undefined) throw new Error('Session persistence is unavailable')
    const rows = await persistence.list()
    // The live log keeps growing, so its folded summary must not be reused.
    if (this.snapshot.sessionId !== undefined) this.summaries.delete(this.snapshot.sessionId)
    const items = rows.map(row => {
      const header = 'header' in row ? row.header : row
      return ({
        id: String(header.id), cwd: header.cwd, createdAt: header.createdAt, current: String(header.id) === this.snapshot.sessionId,
      })
    })
    // Order by last activity — the folded log's newest event — not by creation
    // time, so a long-idle conversation sinks below one touched moments ago.
    // Folding every persisted log costs one read per session, but the folded
    // summaries are cached and reused by the picker rows as they scroll in.
    const ordered = await Promise.all(items.map(async item => ({
      item,
      activity: (await this.describeSession(item.id).catch(() => undefined))?.updatedAt ?? item.createdAt,
    })))
    return ordered
      .sort((left, right) => right.activity - left.activity)
      .map(entry => entry.item)
      .filter(item => {
        const live = item.current && this.handle !== undefined ? sessionEventLikes(this.handle.agent.session) : undefined
        const summary = live !== undefined
          ? { id: item.id, ...foldSessionSummary(live) }
          : this.summaries.get(item.id)
        return summary !== undefined && (summary.prompts > 0 || summary.title !== undefined || summary.firstPrompt !== undefined)
      })
  }

  /** Rebuild a contiguous, turn-balanced seed from a stored log the strict loader rejected. */
  private async repairedSeed(id: string): Promise<SessionEvent[] | undefined> {
    const persistence = this.ctx.get('sessionPersistence') as PersistenceService | undefined
    if (persistence?.readRaw === undefined) return undefined
    try {
      const raw = await persistence.readRaw(SessionId(id))
      if (raw === undefined || raw.content === '') return undefined
      const seed = repairedSeed(parseRawSessionEvents(raw.content))
      return seed.length === 0 ? undefined : seed
    } catch {
      return undefined
    }
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
      if (persistence.open !== undefined) {
        const handle = await persistence.open(SessionId(id), 'read', signal === undefined ? undefined : { signal })
        try {
          const stored = await handle.read(0, undefined, signal === undefined ? undefined : { signal })
          summary = { id, ...foldSessionSummary(eventLikes(stored.events)) }
        } finally {
          await handle.close()
        }
      } else {
        const stored = persistence.readFrom !== undefined
          ? await persistence.readFrom(SessionId(id), 0, signal)
          : persistence.inspect !== undefined ? await persistence.inspect(SessionId(id), signal) : undefined
        if (stored === undefined) throw new Error('Session persistence exposes no readable log')
        summary = { id, ...foldSessionSummary(stored.events) }
      }
    } catch (error) {
      // The strict event read rejected the log (e.g. an interleaved seq run).
      // The backend's own raw artifact still carries the durable title and
      // opening prompt, so the picker can show them instead of the bare id.
      summary = (await this.rescueSummary(id, persistence, signal)) ?? { id, prompts: 0, unreadable: redactSecrets(errorMessage(error)) }
    }
    this.summaries.set(id, summary)
    return summary
  }

  /**
   * Fold picker facts straight from the backend's raw artifact text when the
   * strict logical read fails. Packs chunk rows back into events first, then
   * reuses the same folding as the normal path; nothing is invented.
   */
  private async rescueSummary(id: string, persistence: PersistenceService | undefined, signal?: AbortSignal): Promise<SessionSummary | undefined> {
    if (persistence?.readRaw === undefined) return undefined
    try {
      const raw = await persistence.readRaw(SessionId(id), signal)
      if (raw === undefined || raw.content === '') return undefined
      const events = parseRawSessionEvents(raw.content)
      if (events.length === 0) return undefined
      return { id, ...foldSessionSummary(events) }
    } catch {
      return undefined
    }
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
      this.imageInput = info.inputModalities?.includes('image') === true
      this.patch({
        model: `${resolved.provider}/${resolved.model}`,
        reasoningEffort: undefined,
        contextWindow: info.context?.contextWindow,
        imageInput: this.imageInput,
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

  private teamService(): TeamServiceLike {
    const service = this.ctx.get('agentTeams') as TeamServiceLike | undefined
    if (service === undefined) throw new Error('Agent Teams service is unavailable')
    return service
  }

  private teamAgent(): Agent {
    const agent = this.handle?.agent
    if (agent === undefined) throw new Error('No active Team Lead session')
    return agent
  }

  async teamView(): Promise<TeamViewSnapshot> {
    const agent = this.teamAgent()
    const service = this.teamService()
    const members = service.listMembers(agent)
    const tasks = service.listTasks(agent)
    const activity = foldTeamActivity(sessionEventLikes(agent.session))
    this.patch({ teamSummary: this.teamSummary(members, tasks) })
    return { members, tasks, activity }
  }

  async spawnTeammate(input: SpawnTeammateInput, signal?: AbortSignal): Promise<TeamMemberView> {
    const name = input.name.trim()
    const description = input.description.trim()
    const prompt = input.prompt.trim()
    if (!TEAMMATE_NAME.test(name)) throw new Error('Teammate name must be unique lower-kebab-case')
    if (description === '') throw new Error('Teammate description is required')
    if (prompt === '') throw new Error('Teammate task is required')
    const context = input.context ?? 'fresh'
    const result = await this.teamService().spawnTeammate(this.teamAgent(), {
      name, description, prompt: teammatePrompt(name, prompt), context,
      provider: context === 'fork' ? 'fork' : 'spawn',
      signal: signal ?? new AbortController().signal,
    })
    await this.refreshTeamSummary()
    this.patch({ notice: `Teammate ${name} is ${result.member.status}`, error: undefined })
    return result.member
  }

  async sendTeamMessage(target: string, message: string, signal?: AbortSignal): Promise<'accepted' | 'queued'> {
    const normalized = message.trim()
    if (normalized === '') throw new Error('Team message must be non-empty')
    const result = await this.teamService().sendMessage(this.teamAgent(), {
      target, content: [{ type: 'text', text: normalized }], signal: signal ?? new AbortController().signal,
    })
    this.patch({ notice: `Message to ${target}: ${result.status} · sent via Lead`, error: undefined })
    return result.status
  }

  interruptTeammate(target: string): 'running' | 'idle' | 'inactive' {
    const result = this.teamService().interrupt(this.teamAgent(), target)
    this.patch({ notice: `Interrupted ${target} · was ${result.previousStatus}`, error: undefined })
    void this.refreshTeamSummary()
    return result.previousStatus
  }

  async createTeamTask(input: CreateTeamTaskInput): Promise<TeamTaskView> {
    const subject = input.subject.trim()
    const description = input.description.trim()
    if (subject === '') throw new Error('Task subject is required')
    if (description === '') throw new Error('Task description is required')
    const task = await this.teamService().createTask(this.teamAgent(), {
      subject,
      description,
      ...(input.blockedBy === undefined ? {} : { blockedBy: input.blockedBy.map(teamTaskId) }),
      ...(input.writeScopes === undefined ? {} : { writeScopes: input.writeScopes.map(value => value.trim()).filter(Boolean) }),
    })
    await this.refreshTeamSummary()
    this.patch({ notice: `Created ${String(task.id)} · revision ${task.revision}`, error: undefined })
    return task
  }

  async updateTeamTask(input: UpdateTeamTaskRequest): Promise<TeamTaskView> {
    const task = await this.teamService().updateTask(this.teamAgent(), input)
    await this.refreshTeamSummary()
    this.patch({ notice: `Updated ${String(task.id)} · revision ${task.revision}`, error: undefined })
    return task
  }

  async watchTeam(listener: (view: TeamViewSnapshot) => void, signal: AbortSignal): Promise<void> {
    const handle = this.handle
    if (handle === undefined) throw new Error('No active Team Lead session')
    const service = this.teamService()
    listener(await this.teamView())
    while (!signal.aborted && this.handle === handle) {
      try {
        await service.waitForChange(handle.agent, 30_000, signal)
      } catch (error) {
        if (signal.aborted || this.handle !== handle) return
        throw error
      }
      if (signal.aborted || this.handle !== handle) return
      listener(await this.teamView())
    }
  }

  async openMemberTranscript(member: TeamMemberView, signal?: AbortSignal): Promise<MemberTranscriptLease> {
    if (String(member.id) === this.snapshot.sessionId) {
      return { store: this.transcript, live: true, dispose() {} }
    }
    const registry = this.ctx.get('agents') as (AgentRegistryService & object) | undefined
    const live = registry?.list?.().find(agent => String(agent.session.id) === String(member.id))
    if (live !== undefined) {
      const attached = attachTranscript(live.ctx, live.session, new TranscriptStore(), live)
      return { store: attached.store, live: true, dispose: () => attached.dispose() }
    }

    const persistence = this.ctx.get('sessionPersistence') as PersistenceService | undefined
    if (persistence === undefined) throw new Error('Session persistence is unavailable')
    const store = new TranscriptStore()
    if (persistence.open !== undefined) {
      const handle = await persistence.open(member.id, 'read', signal === undefined ? undefined : { signal })
      try {
        const stored = await handle.read(0, undefined, signal === undefined ? undefined : { signal })
        store.replace(foldEvents(eventLikes(stored.events)))
      } finally {
        await handle.close()
      }
    } else {
      const stored = persistence.readFrom !== undefined
        ? await persistence.readFrom(member.id, 0, signal)
        : await persistence.inspect?.(member.id, signal)
      if (stored === undefined) throw new Error(`No persisted Session for ${member.name}`)
      store.replace(foldEvents(eventLikes(stored.events as readonly SessionEvent[])))
    }
    return { store, live: false, dispose() {} }
  }

  private teamSummary(members: readonly TeamMemberView[], tasks: readonly TeamTaskView[]): TeamSummaryView | undefined {
    const teammates = members.filter(member => member.role === 'teammate').length
    if (teammates === 0) return undefined
    return {
      teammates,
      running: members.filter(member => member.role === 'teammate' && (member.status === 'running' || member.status === 'provisioning')).length,
      pendingTasks: tasks.filter(task => task.status === 'pending' || task.status === 'in_progress').length,
    }
  }

  private async refreshTeamSummary(): Promise<void> {
    const handle = this.handle
    if (handle === undefined) return
    try {
      const service = this.teamService()
      const members = service.listMembers(handle.agent)
      const tasks = service.listTasks(handle.agent)
      if (this.handle === handle) this.patch({ teamSummary: this.teamSummary(members, tasks) })
    } catch {
      if (this.handle === handle) this.patch({ teamSummary: undefined })
    }
  }

  permissionNames(): readonly string[] {
    // `auto` is a current-session review integration with danger-full-access +
    // never semantics. This TUI has no review surface, so it must not offer a
    // control that enables that authority indirectly through the catalog.
    return ((this.ctx.get('permissionPresets') as PermissionService | undefined)?.names ?? [])
      .filter(name => name !== 'auto')
  }

  selectPermission(name: string): boolean {
    const permissions = this.ctx.get('permissionPresets') as PermissionService | undefined
    const session = this.handle?.agent.session
    if (permissions === undefined || session === undefined) { this.fail('Permission presets are unavailable'); return false }
    try {
      permissions.set(session, name)
      this.patch({ permission: this.permissionCurrent(permissions, session), notice: `Permission preset: ${name}`, error: undefined })
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
    const pending = this.activeInteraction()
    if (pending?.kind !== 'approval') return
    this.removeInteraction(pending.id)
    pending.resolve(outcome)
    this.patch({ notice: outcome === 'allowed-once' ? `Allowed once for ${pending.source.member}` : `Rejected for ${pending.source.member}` })
  }

  answerApprovalWithPreset(name: string): boolean {
    const pending = this.activeInteraction()
    if (pending?.kind !== 'approval' || !this.selectPermissionFor(pending.agent, name)) return false
    this.answerApproval('allowed-once')
    return true
  }

  answerQuestions(answers: QuestionAnswerItem[]): void {
    const pending = this.activeInteraction()
    if (pending?.kind !== 'questions') return
    this.removeInteraction(pending.id)
    pending.resolve({ answers })
    this.patch({ notice: `Answers submitted to ${pending.source.member}` })
  }

  selectInteraction(delta: number): void {
    if (this.interactions.length < 2 || delta === 0) return
    this.interactionIndex = (this.interactionIndex + delta + this.interactions.length) % this.interactions.length
    this.syncInteractionSnapshot()
  }

  private askApproval(request: ApprovalRequestLike, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome> {
    const source = this.interactionSource(request.agent)
    if (source === undefined) return next()
    if (request.signal?.aborted === true) return Promise.resolve('cancelled')
    if (this.interactions.length >= 32) return Promise.resolve('unavailable')
    const id = ++this.requestSeq
    return new Promise(resolve => {
      const abort = (): void => {
        const pending = this.removeInteraction(id)
        if (pending?.kind !== 'approval') return
        resolve('cancelled')
        this.patch({ notice: `Approval request cancelled for ${source.member}` })
      }
      request.signal?.addEventListener('abort', abort, { once: true })
      this.interactions = [...this.interactions, {
        kind: 'approval', id, source, agent: request.agent, request, resolve,
        removeAbort: () => request.signal?.removeEventListener('abort', abort),
      }]
      this.syncInteractionSnapshot()
    })
  }

  private askQuestions(request: QuestionRequestLike): Promise<{ answers: QuestionAnswerItem[] }> {
    const agent = request.agent ?? this.handle?.agent
    const source = agent === undefined ? undefined : this.interactionSource(agent)
    if (agent === undefined || source === undefined) return Promise.reject(new Error('Question caller is not in the active Team'))
    if (request.signal?.aborted === true) return Promise.reject(new Error('Question request cancelled'))
    if (this.interactions.length >= 32) return Promise.reject(new Error('TUI interaction queue is full'))
    const id = ++this.requestSeq
    return new Promise((resolve, reject) => {
      const abort = (): void => {
        const pending = this.removeInteraction(id)
        if (pending?.kind !== 'questions') return
        reject(new Error('Question request cancelled'))
        this.patch({ notice: `Question request cancelled for ${source.member}` })
      }
      request.signal?.addEventListener('abort', abort, { once: true })
      this.interactions = [...this.interactions, {
        kind: 'questions', id, source, agent, request, resolve, reject,
        removeAbort: () => request.signal?.removeEventListener('abort', abort),
      }]
      this.syncInteractionSnapshot()
    })
  }

  private routeQuestions(
    request: QuestionRequestLike,
    next: () => Promise<{ answers: QuestionAnswerItem[] }>,
  ): Promise<{ answers: QuestionAnswerItem[] }> {
    return request.agent !== undefined && this.interactionSource(request.agent) === undefined
      ? next()
      : this.askQuestions(request)
  }

  private interactionSource(agent: Agent): InteractionSourceView | undefined {
    const root = this.handle?.agent
    if (root === undefined) return undefined
    try {
      const membership = this.teamService().tryMembership(agent)
      if (membership === undefined || membership.root !== root) return undefined
      return { member: membership.name, role: membership.role, sessionId: String(agent.session.id) }
    } catch {
      return agent === root ? { member: 'lead', role: 'lead', sessionId: String(agent.session.id) } : undefined
    }
  }

  private handleAgentStatus(agent: Agent, status: 'idle' | 'running'): void {
    if (agent === this.handle?.agent || String(agent.id) === this.snapshot.sessionId) this.patch({ agentStatus: status })
    if (this.interactionSource(agent) !== undefined) void this.refreshTeamSummary()
  }

  private activeInteraction(): InteractionPending | undefined {
    return this.interactions[this.interactionIndex]
  }

  private removeInteraction(id: number): InteractionPending | undefined {
    const index = this.interactions.findIndex(item => item.id === id)
    if (index < 0) return undefined
    const pending = this.interactions[index]!
    pending.removeAbort()
    this.interactions = this.interactions.filter(item => item.id !== id)
    if (index < this.interactionIndex) this.interactionIndex -= 1
    this.interactionIndex = Math.max(0, Math.min(this.interactionIndex, this.interactions.length - 1))
    this.syncInteractionSnapshot()
    return pending
  }

  private syncInteractionSnapshot(): void {
    const active = this.activeInteraction()
    this.patch({
      interactionCount: this.interactions.length,
      interactionIndex: this.interactions.length === 0 ? 0 : this.interactionIndex,
      approval: active?.kind === 'approval' ? {
        id: active.id,
        toolName: active.request.toolName,
        callId: active.request.callId === undefined ? undefined : String(active.request.callId),
        reason: active.request.reason,
        source: active.source,
      } : undefined,
      questions: active?.kind === 'questions' ? {
        id: active.id,
        source: active.source,
        questions: active.request.questions.map(question => ({
          id: question.id, question: question.question, options: question.options ?? [], multiSelect: question.multiSelect ?? false,
          detail: question.detail,
          header: question.header,
          approve: question.intent?.kind === 'plan-review' ? question.intent.approve : undefined,
        })),
      } : undefined,
    })
  }

  private selectPermissionFor(agent: Agent, name: string): boolean {
    const permissions = this.ctx.get('permissionPresets') as PermissionService | undefined
    if (permissions === undefined) { this.fail('Permission presets are unavailable'); return false }
    try {
      permissions.set(agent.session, name)
      this.patch({
        ...(agent === this.handle?.agent ? { permission: this.permissionCurrent(permissions, agent.session) } : {}),
        notice: `Permission preset for ${this.interactionSource(agent)?.member ?? String(agent.id)}: ${name}`,
        error: undefined,
      })
      return true
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  private currentPermission(): string | undefined {
    const permissions = this.ctx.get('permissionPresets') as PermissionService | undefined
    return permissions === undefined || this.handle === undefined
      ? undefined
      : this.permissionCurrent(permissions, this.handle.agent.session)
  }

  /** v3 derives permission from a Session projection; older hosts folded an event array. */
  private permissionCurrent(permissions: PermissionService, session: Agent['session']): string {
    return Number(session.header.version) >= 3
      ? permissions.current(session)
      : permissions.current(sessionEvents(session))
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
    const pendingItems = this.interactions
    this.interactions = []
    this.interactionIndex = 0
    for (const pending of pendingItems) {
      pending.removeAbort()
      if (pending.kind === 'approval') pending.resolve(outcome)
      else pending.reject(new Error('TUI question request cancelled: session switched or TUI closed'))
    }
    this.patch({ approval: undefined, questions: undefined, interactionCount: 0, interactionIndex: 0 })
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
    this.takeOverSeq += 1
    this.settleBlocking('unavailable')
    await Promise.resolve()
    this.questionProviderDispose?.()
    this.questionProviderDispose = undefined
    for (const dispose of this.eventDisposers.splice(0)) dispose()
    await this.releaseHandle()
  }

  /** Drop the live handle and delete a never-used welcome session so /resume stays clean. */
  private async releaseHandle(): Promise<void> {
    const handle = this.handle
    const abandoned = handle !== undefined && foldSessionSummary(sessionEventLikes(handle.agent.session)).prompts === 0
    const location = abandoned
      ? (this.ctx.get('sessionPersistence') as PersistenceService | undefined)?.locate?.(handle.agent.session.header)
      : undefined
    this.attached?.dispose()
    this.attached = undefined
    this.projections?.dispose()
    this.projections = undefined
    this.transcript.replace(EMPTY_TRANSCRIPT)
    this.patch({ projection: undefined, teamSummary: undefined })
    await Promise.resolve()
    await handle?.dispose()
    this.handle = undefined
    this.selection = undefined
    if (location?.path) {
      await rm(dirname(location.path), { recursive: true, force: true }).catch(() => undefined)
    }
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
