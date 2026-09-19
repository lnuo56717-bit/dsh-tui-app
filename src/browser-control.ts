import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  PreToolDecision, ToolDispatchExecution, ToolExecution, ToolExecutionResult,
} from '@deepseek-ai/dsh-tools'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { existsSync, realpathSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, delimiter, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { redactSecrets } from './ui/secrets.js'

export const name = 'tui-browser-control'
export const inject = ['browserUse', 'agents', 'tools']

export const BROWSER_TOOL_PREFIX = 'mcp__playwright-mcp__'

export const BROWSER_READ_TOOLS = Object.freeze([
  'browser_console_messages',
  'browser_find',
  'browser_network_requests',
  'browser_snapshot',
  'browser_take_screenshot',
] as const)

export const BROWSER_APPROVAL_TOOLS = Object.freeze([
  'browser_click',
  'browser_close',
  'browser_drag',
  'browser_drop',
  'browser_evaluate',
  'browser_file_upload',
  'browser_fill_form',
  'browser_handle_dialog',
  'browser_hover',
  'browser_navigate',
  'browser_navigate_back',
  'browser_network_request',
  'browser_press_key',
  'browser_resize',
  'browser_select_option',
  'browser_type',
  'browser_wait_for',
  'browser_tabs',
] as const)

export const BROWSER_BLOCKED_TOOLS = Object.freeze(['browser_run_code_unsafe'] as const)

const READ_TOOLS = new Set<string>(BROWSER_READ_TOOLS)
const APPROVAL_TOOLS = new Set<string>(BROWSER_APPROVAL_TOOLS)
const BLOCKED_TOOLS = new Set<string>(BROWSER_BLOCKED_TOOLS)
const SENSITIVE_TARGET = /(?:pass(?:word|code|wd)?|credential|secret|token|api[-_ ]?key|otp|one[-_ ]?time|verification|2fa|mfa|cvv|cvc|security[-_ ]?code|payment[-_ ]?pin|密码|口令|验证码|令牌|密钥|安全码|支付密码)/iu
const MAX_ACTIVITY = 64

export type BrowserToolPolicy = 'read' | 'ask' | 'blocked' | 'unknown'
export type BrowserActivityStatus = 'waiting' | 'running' | 'succeeded' | 'failed' | 'denied'

export interface BrowserActivityView {
  readonly callId: string
  readonly tool: string
  readonly summary: string
  readonly status: BrowserActivityStatus
  readonly time: number
}

export interface BrowserAgentStateView {
  readonly paused: boolean
  readonly activeCalls: number
  readonly activity: readonly BrowserActivityView[]
}

export interface BrowserRuntimeView {
  readonly configured: boolean
  readonly available: boolean
  readonly provider: string | undefined
  readonly mode: 'launch'
  readonly visible: boolean
  readonly executablePath: string | undefined
  readonly unavailableReason: string | undefined
}

export interface BrowserControlConfig {
  readonly headless?: boolean
  readonly toolCallTimeoutMs?: number
}

interface MutableActivity {
  callId: string
  tool: string
  summary: string
  status: BrowserActivityStatus
  time: number
  started: boolean
}

interface MutableAgentState {
  paused: boolean
  activeCalls: number
  activity: MutableActivity[]
}

interface BrowserAvailability {
  configured: boolean
  executablePath?: string
  unavailableReason?: string
}

type PlaywrightBrowserModule = typeof import('@deepseek-ai/dsh-experimental-browser-use-playwright-mcp')

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiBrowserControl: BrowserControlService
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function browserToolName(publicName: string): string | undefined {
  return publicName.startsWith(BROWSER_TOOL_PREFIX) ? publicName.slice(BROWSER_TOOL_PREFIX.length) : undefined
}

export function browserToolPolicy(publicName: string): BrowserToolPolicy | undefined {
  const tool = browserToolName(publicName)
  if (tool === undefined) return undefined
  if (READ_TOOLS.has(tool)) return 'read'
  if (APPROVAL_TOOLS.has(tool)) return 'ask'
  if (BLOCKED_TOOLS.has(tool)) return 'blocked'
  return 'unknown'
}

function compact(value: string, limit = 96): string {
  const normalized = redactSecrets(value.replace(/\s+/gu, ' ').trim())
  return normalized.length <= limit ? normalized : `${normalized.slice(0, Math.max(0, limit - 1))}…`
}

function safeUrl(value: unknown): string {
  const raw = text(value)
  if (raw === '') return 'the requested URL'
  try {
    const url = new URL(raw)
    url.username = ''
    url.password = ''
    url.hash = ''
    const hadSearch = url.search !== ''
    url.search = ''
    return compact(`${url.origin}${url.pathname}${hadSearch ? '?…' : ''}`, 140)
  } catch {
    return compact(raw.replace(/\?.*$/u, '?…'), 140)
  }
}

function safeTarget(args: Record<string, unknown>): string {
  return compact(text(args.element) || text(args.target) || 'the selected element')
}

function fieldLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => {
    const field = record(item)
    return text(field.name) || text(field.element) || text(field.label) || text(field.target) || text(field.type)
  }).filter(Boolean)
}

export function browserInputTargetsSensitive(publicName: string, argsValue: unknown): boolean {
  const tool = browserToolName(publicName)
  const args = record(argsValue)
  if (tool === 'browser_type') return SENSITIVE_TARGET.test(`${text(args.element)} ${text(args.target)}`)
  if (tool !== 'browser_fill_form') return false
  if (!Array.isArray(args.fields)) return false
  return args.fields.some(item => {
    const field = record(item)
    const descriptor = [field.name, field.element, field.label, field.target, field.type]
      .map(text)
      .join(' ')
    return SENSITIVE_TARGET.test(descriptor)
  })
}

/** Human-readable, deliberately lossy approval copy. Never echo typed or dropped data. */
export function browserApprovalSummary(publicName: string, argsValue: unknown): string {
  const tool = browserToolName(publicName) ?? 'browser_unknown'
  const args = record(argsValue)
  switch (tool) {
    case 'browser_navigate': return `Navigate to ${safeUrl(args.url)}`
    case 'browser_navigate_back': return 'Navigate back in browser history'
    case 'browser_click': return `Click ${safeTarget(args)}`
    case 'browser_drag': return `Drag ${compact(text(args.startElement) || 'an element')} to ${compact(text(args.endElement) || 'another element')}`
    case 'browser_drop': {
      const paths = Array.isArray(args.paths) ? args.paths.map(text).filter(Boolean) : []
      const types = Object.keys(record(args.data))
      return `Drop ${paths.length} file${paths.length === 1 ? '' : 's'}${paths.length > 0 ? ` (${paths.map(path => compact(basename(path), 32)).join(', ')})` : ''}${types.length > 0 ? ` and ${types.length} data type${types.length === 1 ? '' : 's'}` : ''} onto ${safeTarget(args)}`
    }
    case 'browser_evaluate': return `Evaluate page JavaScript (${text(args.function).length} characters)`
    case 'browser_file_upload': {
      const paths = Array.isArray(args.paths) ? args.paths.map(text).filter(Boolean) : []
      return paths.length === 0
        ? 'Cancel the browser file chooser'
        : `Upload ${paths.length} file${paths.length === 1 ? '' : 's'} (${paths.map(path => compact(basename(path), 32)).join(', ')})`
    }
    case 'browser_fill_form': {
      const labels = fieldLabels(args.fields)
      return `Fill ${Array.isArray(args.fields) ? args.fields.length : 0} form field${Array.isArray(args.fields) && args.fields.length === 1 ? '' : 's'}${labels.length > 0 ? ` (${compact(labels.join(', '), 90)})` : ''}; values hidden`
    }
    case 'browser_handle_dialog': return `${args.accept === true ? 'Accept' : 'Dismiss'} the browser dialog${text(args.promptText) === '' ? '' : '; prompt text hidden'}`
    case 'browser_hover': return `Hover over ${safeTarget(args)}`
    case 'browser_network_request': return `Read full network request ${String(args.index ?? '?')}${text(args.part) === '' ? ' including headers/body' : ` part ${compact(text(args.part), 32)}`}`
    case 'browser_press_key': return `Press browser key ${compact(text(args.key), 32)}`
    case 'browser_resize': return `Resize browser window to ${String(args.width ?? '?')}×${String(args.height ?? '?')}`
    case 'browser_select_option': return `Select option on ${safeTarget(args)}; value hidden`
    case 'browser_type': return `Type ${text(args.text).length} characters into ${safeTarget(args)}${args.submit === true ? ' and submit' : ''}; text hidden`
    case 'browser_wait_for': return `Wait for browser condition${typeof args.time === 'number' ? ` (${args.time}s)` : ''}`
    case 'browser_tabs': return `${compact(text(args.action) || 'Manage', 24)} browser tab${text(args.url) === '' ? '' : ` at ${safeUrl(args.url)}`}`
    case 'browser_close': return 'Close the current browser page'
    case 'browser_console_messages': return 'Read browser console messages'
    case 'browser_find': return `Search the page snapshot${text(args.text) === '' && text(args.regex) === '' ? '' : ' using a hidden query'}`
    case 'browser_network_requests': return 'List browser network requests'
    case 'browser_snapshot': return `Read accessibility snapshot${text(args.target) === '' ? '' : ` for ${safeTarget(args)}`}`
    case 'browser_take_screenshot': return `Capture ${args.fullPage === true ? 'full-page ' : ''}browser screenshot${text(args.element) === '' ? '' : ` of ${safeTarget(args)}`}`
    default: return `Run ${tool.replace(/^browser_/u, 'browser/').replaceAll('_', '-')}`
  }
}

export function browserToolDisplay(publicName: string, argumentsText: string): { readonly name: string; readonly summary: string } | undefined {
  const tool = browserToolName(publicName)
  if (tool === undefined) return undefined
  let args: unknown = {}
  try { args = argumentsText.trim() === '' ? {} : JSON.parse(argumentsText) } catch { args = {} }
  return {
    name: `browser/${tool.replace(/^browser_/u, '').replaceAll('_', '-')}`,
    summary: browserApprovalSummary(publicName, args),
  }
}

function isFile(path: string): boolean {
  try { return existsSync(path) && statSync(path).isFile() } catch { return false }
}

function fromPath(env: NodeJS.ProcessEnv, names: readonly string[]): string | undefined {
  const entries = (env.PATH ?? '').split(delimiter).filter(Boolean)
  const extensions = process.platform === 'win32'
    ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)
    : ['']
  for (const entry of entries) {
    for (const name of names) {
      for (const extension of extensions) {
        const candidate = join(entry, process.platform === 'win32' && !name.toLowerCase().endsWith(extension.toLowerCase()) ? `${name}${extension.toLowerCase()}` : name)
        if (isFile(candidate)) return candidate
      }
    }
  }
  return undefined
}

export function discoverBrowserExecutable(env: NodeJS.ProcessEnv = process.env): BrowserAvailability {
  if (/^(?:0|false|off|disabled)$/iu.test(env.DSH_TUI_BROWSER?.trim() ?? '')) {
    return { configured: false, unavailableReason: 'Browser control disabled by DSH_TUI_BROWSER' }
  }
  const explicit = env.DSH_TUI_BROWSER_EXECUTABLE?.trim()
  if (explicit !== undefined && explicit !== '') {
    if (!isFile(explicit)) return {
      configured: true,
      unavailableReason: `DSH_TUI_BROWSER_EXECUTABLE is not a browser executable: ${explicit}`,
    }
    return { configured: true, executablePath: explicit }
  }
  const localAppData = env.LOCALAPPDATA
  const programFiles = env.ProgramFiles
  const programFilesX86 = env['ProgramFiles(x86)']
  const candidates = [
    ...(programFiles === undefined ? [] : [join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe')]),
    ...(programFilesX86 === undefined ? [] : [join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe')]),
    ...(localAppData === undefined ? [] : [join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')]),
    ...(programFilesX86 === undefined ? [] : [join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')]),
    ...(programFiles === undefined ? [] : [join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe')]),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
  ]
  const executablePath = candidates.find(isFile)
    ?? fromPath(env, process.platform === 'win32' ? ['chrome', 'msedge'] : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'])
  return executablePath === undefined
    ? { configured: true, unavailableReason: 'No compatible system Chrome or Edge executable was found' }
    : { configured: true, executablePath }
}

/**
 * Load the provider beside the active dsh executable, not from this linked
 * package's development node_modules. dsh-scope uses process-local symbols, so
 * a second physical copy would silently turn per-Agent registrations global.
 */
async function loadHostPlaywrightProvider(): Promise<PlaywrightBrowserModule> {
  const entry = process.argv[1]
  if (entry === undefined || entry.trim() === '') throw new Error('cannot locate the active dsh executable module')
  const hostEntry = isAbsolute(entry) ? entry : resolve(entry)
  const fromHost = createRequire(pathToFileURL(hostEntry))
  let providerEntry: string
  let packagePath: string
  try {
    providerEntry = fromHost.resolve('@deepseek-ai/dsh-experimental-browser-use-playwright-mcp')
    packagePath = fromHost.resolve('@deepseek-ai/dsh-experimental-browser-use-playwright-mcp/package.json')
  } catch (error) {
    throw new Error('the active dsh Host does not contain the pinned Playwright MCP provider; run the 0.2.1 installer', { cause: error })
  }
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: unknown }
  if (packageJson.version !== '0.1.6-alpha.2') {
    throw new Error(`the active dsh Host has Playwright provider ${String(packageJson.version)}; expected 0.1.6-alpha.2`)
  }
  const providerRequire = createRequire(pathToFileURL(providerEntry))
  for (const [dependency, expected] of [
    ['@deepseek-ai/dsh-browser-use', '0.1.6-alpha.2'],
    ['@deepseek-ai/dsh-experimental-browser-use-runtime', '0.1.6-alpha.2'],
    ['@playwright/mcp', '0.0.80'],
  ] as const) {
    const dependencyPackage = JSON.parse(readFileSync(providerRequire.resolve(`${dependency}/package.json`), 'utf8')) as { version?: unknown }
    if (dependencyPackage.version !== expected) {
      throw new Error(`the active dsh Host has ${dependency} ${String(dependencyPackage.version)}; expected ${expected}`)
    }
  }
  const hostScope = realpathSync(fromHost.resolve('@deepseek-ai/dsh-scope'))
  const providerScope = realpathSync(providerRequire.resolve('@deepseek-ai/dsh-scope'))
  if (hostScope.toLowerCase() !== providerScope.toLowerCase()) {
    throw new Error('the Playwright provider does not share the active Harness dsh-scope module; refusing unsafe cross-Session registration')
  }
  return await import(pathToFileURL(providerEntry).href) as PlaywrightBrowserModule
}

export function browserApprovalWasGranted(exec: Readonly<ToolExecution>): boolean {
  const session = exec.agent?.session
  if (session === undefined) return false
  const decisions = new Map<string, unknown>()
  for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
    const event = session.eventAt(SessionSeq(seq))
    if (event?.type === 'turn/end') return false
    if (event?.type === 'approval/decided') {
      const data = record(event.data)
      const id = text(data.id)
      if (id !== '' && !decisions.has(id)) decisions.set(id, data.outcome)
      continue
    }
    if (event?.type === 'approval/asked') {
      const data = record(event.data)
      if (text(data.callId) !== String(exec.callId) || text(data.toolName) !== exec.name) continue
      return decisions.get(text(data.id)) === 'allowed-once'
    }
    if (event?.type === 'turn/start') return false
  }
  return false
}

export class BrowserControlService extends Service {
  private readonly states = new Map<Agent, MutableAgentState>()
  private readonly listeners = new Set<() => void>()
  private readonly availability: BrowserAvailability
  private readonly visible: boolean

  constructor(ctx: Context, availability: BrowserAvailability, visible: boolean) {
    super(ctx, 'tuiBrowserControl')
    this.availability = availability
    this.visible = visible

    ctx.on('agent/created', ({ agent }) => {
      this.ensure(agent)
      this.notify()
      agent.ctx.effect(() => () => {
        this.states.delete(agent)
        this.notify()
      }, 'tui-browser-control.agent')
      return undefined
    })
    ctx.on('tools/pre-execute', (exec, next) => this.preExecute(exec, next), { prepend: true })
    ctx.tools.guard(exec => this.guard(exec))
    ctx.on('tools/execute', (exec, next) => this.execute(exec, next))
    ctx.on('tools/result', (exec, result) => {
      if (browserToolPolicy(exec.name) === undefined || exec.agent === undefined) return
      const activity = this.activity(exec.agent, String(exec.callId))
      if (activity !== undefined) activity.status = result.isError ? (activity.started ? 'failed' : 'denied') : 'succeeded'
      this.notify()
    })
  }

  runtime(): BrowserRuntimeView {
    const provider = this.ctx.get('browserUse')?.providerName
    return {
      configured: this.availability.configured,
      available: this.availability.configured && this.availability.executablePath !== undefined && provider !== undefined,
      provider: provider === undefined ? undefined : String(provider),
      mode: 'launch', visible: this.visible,
      executablePath: this.availability.executablePath,
      unavailableReason: this.availability.unavailableReason,
    }
  }

  state(agent: Agent): BrowserAgentStateView {
    const state = this.ensure(agent)
    return {
      paused: state.paused,
      activeCalls: state.activeCalls,
      activity: state.activity.map(({ started: _started, ...item }) => item),
    }
  }

  setPaused(agent: Agent, paused: boolean): void {
    const state = this.ensure(agent)
    if (state.paused === paused) return
    state.paused = paused
    this.notify()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private ensure(agent: Agent): MutableAgentState {
    let state = this.states.get(agent)
    if (state === undefined) {
      state = { paused: false, activeCalls: 0, activity: [] }
      this.states.set(agent, state)
    }
    return state
  }

  private record(exec: Readonly<ToolExecution>, status: BrowserActivityStatus): MutableActivity | undefined {
    if (exec.agent === undefined) return undefined
    const state = this.ensure(exec.agent)
    const callId = String(exec.callId)
    let item = state.activity.find(activity => activity.callId === callId)
    if (item === undefined) {
      item = {
        callId,
        tool: browserToolName(exec.name) ?? exec.name,
        summary: browserApprovalSummary(exec.name, exec.arguments),
        status,
        time: Date.now(),
        started: false,
      }
      state.activity.unshift(item)
      if (state.activity.length > MAX_ACTIVITY) state.activity.length = MAX_ACTIVITY
    } else {
      item.status = status
    }
    this.notify()
    return item
  }

  private activity(agent: Agent, callId: string): MutableActivity | undefined {
    return this.states.get(agent)?.activity.find(item => item.callId === callId)
  }

  private async preExecute(exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> {
    const policy = browserToolPolicy(exec.name)
    if (policy === undefined) return next()
    const state = exec.agent === undefined ? undefined : this.ensure(exec.agent)
    if (state?.paused === true) {
      this.record(exec, 'denied')
      return { kind: 'deny', reason: 'Browser control is paused for manual takeover; resume it in /browser before retrying.' }
    }
    if (policy === 'blocked') {
      this.record(exec, 'denied')
      return { kind: 'deny', reason: 'Unsafe Playwright code execution is permanently disabled by dsh-tui.' }
    }
    if (policy === 'unknown') {
      this.record(exec, 'denied')
      return { kind: 'deny', reason: 'This browser tool is not in the pinned dsh-tui safety catalog and is disabled until reviewed.' }
    }
    if (browserInputTargetsSensitive(exec.name, exec.arguments)) {
      this.record(exec, 'denied')
      return { kind: 'deny', reason: 'Sensitive browser fields must be completed through visible manual takeover; never send credentials as browser tool arguments.' }
    }
    if (policy === 'read') {
      this.record(exec, 'running')
      return next()
    }
    const summary = browserApprovalSummary(exec.name, exec.arguments)
    this.record(exec, 'waiting')
    return { kind: 'ask', reason: summary }
  }

  private guard(exec: Readonly<ToolExecution>): string | undefined {
    const policy = browserToolPolicy(exec.name)
    if (policy === undefined) return undefined
    if (exec.agent === undefined) return 'Browser tools require an owning live Agent Session.'
    if (this.ensure(exec.agent).paused) return 'Browser control was paused before this action dispatched.'
    if (policy === 'blocked' || policy === 'unknown') return 'Browser tool is blocked by the pinned dsh-tui safety catalog.'
    if (browserInputTargetsSensitive(exec.name, exec.arguments)) return 'Sensitive browser input requires visible manual takeover.'
    if (policy === 'ask' && !browserApprovalWasGranted(exec)) return 'Browser action did not carry a matching allowed-once approval audit event.'
    return undefined
  }

  private async execute(exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult> {
    const policy = browserToolPolicy(exec.name)
    if (policy === undefined || exec.agent === undefined) return next()
    const state = this.ensure(exec.agent)
    const activity = this.record(exec, 'running')
    if (activity !== undefined) activity.started = true
    state.activeCalls += 1
    this.notify()
    try {
      return await next()
    } finally {
      state.activeCalls = Math.max(0, state.activeCalls - 1)
      this.notify()
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

export async function apply(ctx: Context, config: BrowserControlConfig = {}): Promise<void> {
  let availability = discoverBrowserExecutable()
  const headless = config.headless ?? false
  let provider: PlaywrightBrowserModule | undefined
  if (availability.configured && availability.executablePath !== undefined) {
    try {
      provider = await loadHostPlaywrightProvider()
    } catch (error) {
      availability = {
        ...availability,
        unavailableReason: error instanceof Error ? error.message : String(error),
      }
    }
  }
  new BrowserControlService(ctx, availability, !headless)
  if (!availability.configured || availability.executablePath === undefined || provider === undefined) return
  await ctx.plugin(provider, {
    mode: 'launch',
    headless,
    executablePath: availability.executablePath,
    ...(config.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: config.toolCallTimeoutMs }),
  })
}
