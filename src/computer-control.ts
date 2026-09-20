import type { Context, Fiber } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { PreToolDecision, ToolDispatchExecution, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { existsSync, realpathSync, readFileSync, statSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { basename, delimiter, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { redactSecrets } from './ui/secrets.js'

export const name = 'tui-computer-control'
export const inject = ['computerUse', 'agents', 'tools']

export const CUA_DRIVER_VERSION = '0.28.2'
export const CUA_PROVIDER_VERSION = '0.1.6-alpha.2'
export const CUA_TOOL_PREFIX = 'mcp__cua-driver-mcp__'
export const CUA_PENDING_TTL_MS = 5 * 60 * 1_000

/** Exact MCP-exposed Cua Driver 0.28.2 catalog. A changed catalog fails closed. */
export const CUA_TOOLS = Object.freeze([
  'list_apps',
  'list_windows',
  'get_window_state',
  'get_accessibility_tree',
  'get_desktop_state',
  'get_screen_size',
  'get_cursor_position',
  'get_config',
  'get_recording_state',
  'get_agent_cursor_state',
  'launch_app',
  'kill_app',
  'bring_to_front',
  'set_window_frame',
  'click',
  'double_click',
  'right_click',
  'drag',
  'type_text',
  'press_key',
  'hotkey',
  'set_value',
  'scroll',
  'move_cursor',
  'zoom',
  'page',
  'clipboard_read',
  'clipboard_write',
  'debug_window_info',
  'start_recording',
  'stop_recording',
  'replay_trajectory',
  'set_config',
  'start_session',
  'end_session',
  'set_agent_cursor_enabled',
  'set_agent_cursor_motion',
  'check_permissions',
  'health_report',
  'check_for_update',
  'install_ffmpeg',
  'verify_state',
  'invoke_menu',
  'set_agent_cursor_theme',
  'get_browser_state',
  'browser_prepare',
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_dialog',
  'browser_set_input_files',
  'browser_download',
  'browser_pointer',
  'escalate_session',
  'get_session',
  'list_sessions',
  'get_session_state',
] as const)

const CUA_TOOL_SET = new Set<string>(CUA_TOOLS)
const MAX_ACTIVITY = 64
const HIDDEN_KEYS = /^(?:text|value|content|prompt|prompt_text|clipboard|data|payload|password|secret|token|api_?key)$/iu
const RESULT_HIDDEN_KEYS = /(?:password|secret|token|api_?key|authorization|credential|clipboard)/iu
const PATH_KEYS = /(?:^|_)(?:path|paths|file|files|dir|directory|output)(?:$|_)|(?:Path|Paths|File|Files|Dir|Directory)$/u
const URL_KEYS = /(?:^|_)url$/iu

type CuaProviderModule = typeof import('@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp')

export type ComputerActivityStatus = 'running' | 'succeeded' | 'failed' | 'denied'
export type ComputerLeasePhase = 'idle' | 'arming' | 'pending' | 'active' | 'paused' | 'stopping' | 'faulted'

export interface ComputerActivityView {
  readonly callId: string
  readonly tool: string
  readonly summary: string
  readonly status: ComputerActivityStatus
  readonly time: number
}

export interface ComputerAgentStateView {
  readonly phase: ComputerLeasePhase
  readonly leaseOwner: boolean
  readonly paused: boolean
  readonly activeCalls: number
  readonly pendingExpiresAt: number | undefined
  readonly boundTurn: number | undefined
  readonly activity: readonly ComputerActivityView[]
}

export interface ComputerRuntimeView {
  readonly configured: boolean
  readonly available: boolean
  readonly provider: 'cua-driver-mcp' | undefined
  readonly executablePath: string | undefined
  readonly driverVersion: string | undefined
  readonly permissionMode: 'standard'
  readonly catalogSize: number
  readonly unavailableReason: string | undefined
  readonly lastError: string | undefined
}

interface ComputerAvailability {
  configured: boolean
  executablePath?: string
  driverVersion?: string
  unavailableReason?: string
}

interface MutableActivity {
  callId: string
  tool: string
  summary: string
  status: ComputerActivityStatus
  time: number
  started: boolean
}

interface MutableAgentState {
  activeCalls: number
  activity: MutableActivity[]
}

interface ComputerLease {
  readonly agent: Agent
  fiber: Fiber | undefined
  paused: boolean
  phase: Exclude<ComputerLeasePhase, 'idle' | 'faulted'>
  boundTurn: number | undefined
  pendingExpiresAt: number | undefined
  pendingTimer: ReturnType<typeof setTimeout> | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiComputerControl: ComputerControlService
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function compact(value: string, limit = 120): string {
  const normalized = redactSecrets(value.replace(/\s+/gu, ' ').trim())
  return normalized.length <= limit ? normalized : `${normalized.slice(0, Math.max(0, limit - 1))}…`
}

function safeUrl(value: unknown): string {
  if (typeof value !== 'string' || value === '') return 'requested URL'
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.hash = ''
    const hadSearch = url.search !== ''
    url.search = ''
    return compact(`${url.origin}${url.pathname}${hadSearch ? '?…' : ''}`, 140)
  } catch {
    return compact(value.replace(/\?.*$/u, '?…'), 140)
  }
}

function hiddenLength(value: unknown): string {
  if (typeof value === 'string') return `<${value.length} chars hidden>`
  if (Array.isArray(value)) return `<${value.length} values hidden>`
  return '<hidden>'
}

function safeArguments(value: unknown, key = '', depth = 0): unknown {
  if (depth > 3) return '<nested value>'
  if (HIDDEN_KEYS.test(key)) return hiddenLength(value)
  if (URL_KEYS.test(key)) return safeUrl(value)
  if (PATH_KEYS.test(key)) {
    if (Array.isArray(value)) return value.map(item => typeof item === 'string' ? basename(item) : '<file>')
    return typeof value === 'string' ? basename(value) : '<path>'
  }
  if (Array.isArray(value)) return value.slice(0, 8).map(item => safeArguments(item, key, depth + 1))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(record(value)).slice(0, 16).map(([childKey, child]) => [childKey, safeArguments(child, childKey, depth + 1)]))
  }
  if (typeof value === 'string') return compact(value, 80)
  return value
}

export function computerToolName(publicName: string): string | undefined {
  return publicName.startsWith(CUA_TOOL_PREFIX) ? publicName.slice(CUA_TOOL_PREFIX.length) : undefined
}

export function computerToolKnown(publicName: string): boolean | undefined {
  const tool = computerToolName(publicName)
  return tool === undefined ? undefined : CUA_TOOL_SET.has(tool)
}

export function validateCuaCatalog(names: readonly string[]): { readonly ok: boolean; readonly missing: readonly string[]; readonly extra: readonly string[] } {
  const actual = new Set(names)
  return {
    ok: actual.size === CUA_TOOL_SET.size && CUA_TOOLS.every(name => actual.has(name)),
    missing: CUA_TOOLS.filter(name => !actual.has(name)),
    extra: [...actual].filter(name => !CUA_TOOL_SET.has(name)).sort(),
  }
}

export function computerToolSummary(publicName: string, argsValue: unknown): string {
  const tool = computerToolName(publicName) ?? 'unknown'
  const args = record(argsValue)
  if (tool === 'browser_navigate') return `Navigate isolated browser to ${safeUrl(args.url)}`
  if (tool === 'type_text' || tool === 'browser_type' || tool === 'set_value') {
    const value = typeof args.text === 'string' ? args.text : args.value
    return `${tool.replaceAll('_', ' ')} · ${typeof value === 'string' ? value.length : 0} characters · content hidden`
  }
  if (tool === 'clipboard_write') return `clipboard write · ${hiddenLength(args.text ?? args.value ?? args.data)}`
  if (tool === 'clipboard_read') return 'clipboard read · returned content may be private'
  if (tool === 'browser_set_input_files' || tool === 'browser_download') {
    return `${tool.replaceAll('_', ' ')} · ${compact(JSON.stringify(safeArguments(args)), 140)}`
  }
  const safe = safeArguments(args)
  const details = Object.keys(record(safe)).length === 0 ? '' : ` · ${compact(JSON.stringify(safe), 160)}`
  return `${tool.replaceAll('_', ' ')}${details}`
}

export function computerToolDisplay(publicName: string, argumentsText: string): { readonly name: string; readonly summary: string } | undefined {
  const tool = computerToolName(publicName)
  if (tool === undefined) return undefined
  let args: unknown = {}
  try { args = argumentsText.trim() === '' ? {} : JSON.parse(argumentsText) } catch { args = {} }
  return { name: `computer/${tool.replaceAll('_', '-')}`, summary: computerToolSummary(publicName, args) }
}

const RESULT_ECHO_TOOLS = new Set(['type_text', 'browser_type', 'set_value', 'clipboard_read', 'clipboard_write'])

function redactResultText(value: string): string {
  return redactSecrets(value)
    .replace(/https?:\/\/[^\s<>"']+/giu, match => safeUrl(match))
    .replace(/[A-Za-z]:\\(?:[^\\\r\n"'<>|]+\\)*[^\\\r\n"'<>|]+/gu, match => `<path>\\${basename(match.trim())}`)
}

/** TUI-only result projection. The canonical Session event remains untouched. */
export function computerResultValue(publicName: string, value: unknown, key = '', depth = 0): unknown {
  const tool = computerToolName(publicName)
  if (tool === undefined) return value
  if (depth === 0 && RESULT_ECHO_TOOLS.has(tool)) {
    const length = typeof value === 'string' ? value.length : JSON.stringify(value)?.length ?? 0
    return `<${tool.replaceAll('_', ' ')} result hidden in TUI · ${length} characters>`
  }
  if (depth > 5) return '<nested value>'
  if (RESULT_HIDDEN_KEYS.test(key)) return hiddenLength(value)
  if (URL_KEYS.test(key)) return safeUrl(value)
  if (PATH_KEYS.test(key)) {
    if (Array.isArray(value)) return value.map(item => typeof item === 'string' ? basename(item) : '<file>')
    return typeof value === 'string' ? basename(value) : '<path>'
  }
  if (Array.isArray(value)) return value.slice(0, 64).map(item => computerResultValue(publicName, item, key, depth + 1))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(record(value)).map(([childKey, child]) => [childKey, computerResultValue(publicName, child, childKey, depth + 1)]))
  }
  return typeof value === 'string' ? redactResultText(value) : value
}

function isFile(path: string): boolean {
  try { return existsSync(path) && statSync(path).isFile() } catch { return false }
}

function fromPath(env: NodeJS.ProcessEnv): string | undefined {
  const entries = (env.PATH ?? '').split(delimiter).filter(Boolean)
  const names = process.platform === 'win32' ? ['cua-driver.exe', 'cua-driver'] : ['cua-driver']
  for (const entry of entries) {
    for (const name of names) {
      const candidate = join(entry, name)
      if (isFile(candidate)) return candidate
    }
  }
  return undefined
}

export function discoverCuaExecutable(env: NodeJS.ProcessEnv = process.env): ComputerAvailability {
  if (/^(?:0|false|off|disabled)$/iu.test(env.DSH_TUI_COMPUTER?.trim() ?? '')) {
    return { configured: false, unavailableReason: 'Computer control disabled by DSH_TUI_COMPUTER' }
  }
  const explicit = env.DSH_TUI_CUA_EXECUTABLE?.trim()
  if (explicit !== undefined && explicit !== '') {
    return isFile(explicit)
      ? { configured: true, executablePath: explicit }
      : { configured: true, unavailableReason: `DSH_TUI_CUA_EXECUTABLE is not a file: ${explicit}` }
  }
  const localAppData = env.LOCALAPPDATA
  const standard = localAppData === undefined ? undefined : join(localAppData, 'Programs', 'Cua', 'cua-driver', 'bin', 'cua-driver.exe')
  const executablePath = standard !== undefined && isFile(standard) ? standard : fromPath(env)
  return executablePath === undefined
    ? { configured: true, unavailableReason: 'Cua Driver was not found; install the pinned 0.28.2 release' }
    : { configured: true, executablePath }
}

function execFileText(executable: string, args: readonly string[], timeoutMs = 15_000): Promise<string> {
  return new Promise((resolveText, reject) => {
    execFile(executable, [...args], { windowsHide: true, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(new Error(`${basename(executable)} ${args.join(' ')} failed: ${compact(String(stderr || error.message), 400)}`, { cause: error }))
        return
      }
      resolveText(String(stdout))
    })
  })
}

export async function probeCuaExecutable(availability: ComputerAvailability): Promise<ComputerAvailability> {
  if (!availability.configured || availability.executablePath === undefined) return availability
  try {
    const versionText = await execFileText(availability.executablePath, ['--version'])
    const version = /\bcua-driver\s+([0-9]+\.[0-9]+\.[0-9]+)\b/iu.exec(versionText)?.[1]
    if (version !== CUA_DRIVER_VERSION) return version === undefined
      ? { ...availability, unavailableReason: `Cua Driver version could not be read; expected exactly ${CUA_DRIVER_VERSION}` }
      : { ...availability, driverVersion: version, unavailableReason: `Cua Driver ${version} is installed; expected exactly ${CUA_DRIVER_VERSION}` }
    const catalogText = await execFileText(availability.executablePath, ['list-tools'])
    const names = catalogText.split(/\r?\n/gu).map(line => /^([a-z][a-z0-9_]+):\s/u.exec(line)?.[1]).filter((item): item is string => item !== undefined)
    const catalog = validateCuaCatalog(names)
    if (!catalog.ok) return {
      ...availability,
      driverVersion: version,
      unavailableReason: `Cua Driver catalog mismatch (missing: ${catalog.missing.join(', ') || 'none'}; extra: ${catalog.extra.join(', ') || 'none'})`,
    }
    return { ...availability, driverVersion: version }
  } catch (error) {
    return { ...availability, unavailableReason: error instanceof Error ? error.message : String(error) }
  }
}

async function loadHostCuaProvider(): Promise<CuaProviderModule> {
  const entry = process.argv[1]
  if (entry === undefined || entry.trim() === '') throw new Error('cannot locate the active dsh executable module')
  const hostEntry = isAbsolute(entry) ? entry : resolve(entry)
  const fromHost = createRequire(pathToFileURL(hostEntry))
  let providerEntry: string
  let packagePath: string
  try {
    providerEntry = fromHost.resolve('@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp')
    packagePath = fromHost.resolve('@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp/package.json')
  } catch (error) {
    throw new Error('the active dsh Host does not contain the pinned Cua Driver MCP provider; prepare the 0.2.2 Computer Host', { cause: error })
  }
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: unknown }
  if (packageJson.version !== CUA_PROVIDER_VERSION) {
    throw new Error(`the active dsh Host has CUA MCP provider ${String(packageJson.version)}; expected ${CUA_PROVIDER_VERSION}`)
  }
  const providerRequire = createRequire(pathToFileURL(providerEntry))
  for (const dependency of ['@deepseek-ai/dsh-computer-use', '@deepseek-ai/dsh-mcp-client'] as const) {
    const dependencyPackage = JSON.parse(readFileSync(providerRequire.resolve(`${dependency}/package.json`), 'utf8')) as { version?: unknown }
    if (dependencyPackage.version !== CUA_PROVIDER_VERSION) {
      throw new Error(`the active dsh Host has ${dependency} ${String(dependencyPackage.version)}; expected ${CUA_PROVIDER_VERSION}`)
    }
  }
  for (const dependency of ['@deepseek-ai/dsh-scope', '@deepseek-ai/dsh-tools'] as const) {
    const hostPath = realpathSync(fromHost.resolve(dependency))
    const providerPath = realpathSync(providerRequire.resolve(dependency))
    if (hostPath.toLowerCase() !== providerPath.toLowerCase()) {
      throw new Error(`the CUA provider does not share the active Harness ${dependency} module; refusing unsafe scoped registration`)
    }
  }
  return await import(pathToFileURL(providerEntry).href) as CuaProviderModule
}

function openTurn(agent: Agent): number | undefined {
  for (let seq = agent.session.seq - 1; seq >= 0; seq -= 1) {
    const event = agent.session.eventAt(SessionSeq(seq))
    if (event?.type === 'turn/end') return undefined
    if (event?.type === 'turn/start') return Number.isSafeInteger(event.data.turn) ? event.data.turn : undefined
  }
  return undefined
}

export class ComputerControlService extends Service {
  private readonly states = new Map<Agent, MutableAgentState>()
  private readonly listeners = new Set<() => void>()
  private lease: ComputerLease | undefined
  private transition: Promise<void> = Promise.resolve()
  private lastError: string | undefined

  constructor(
    ctx: Context,
    private readonly availability: ComputerAvailability,
    private readonly providerModule: CuaProviderModule | undefined,
  ) {
    super(ctx, 'tuiComputerControl')
    ctx.on('agent/created', ({ agent }) => {
      this.ensure(agent)
      this.notify()
      agent.ctx.effect(() => () => this.stop(agent, 'Agent Session released', false), 'tui-computer-control.agent')
      return undefined
    })
    ctx.on('agent/disposed', ({ agent }) => { void this.stop(agent, 'Agent disposed', false) })
    ctx.on('session/event', (session, event) => {
      const lease = this.lease
      if (lease === undefined || lease.agent.session !== session) return
      if (event.type === 'turn/start' && lease.boundTurn === undefined) {
        lease.boundTurn = event.data.turn
        lease.pendingExpiresAt = undefined
        if (lease.pendingTimer !== undefined) clearTimeout(lease.pendingTimer)
        lease.pendingTimer = undefined
        lease.phase = lease.paused ? 'paused' : 'active'
        this.notify()
      } else if (event.type === 'turn/end' && lease.boundTurn === event.data.turn) {
        void this.stop(lease.agent, 'Computer lease ended with the model turn', false)
      }
    })
    ctx.on('tools/pre-execute', (exec, next) => this.preExecute(exec, next), { prepend: true })
    ctx.tools.guard(exec => this.guard(exec))
    ctx.on('tools/execute', (exec, next) => this.execute(exec, next))
    ctx.on('tools/result', (exec, result) => {
      if (computerToolName(exec.name) === undefined || exec.agent === undefined) return
      const item = this.activity(exec.agent, String(exec.callId))
      if (item !== undefined) item.status = result.isError ? (item.started ? 'failed' : 'denied') : 'succeeded'
      this.notify()
    })
    ctx.effect(() => () => this.stop(undefined, 'TUI shutting down', false), 'tui-computer-control.root')
  }

  runtime(): ComputerRuntimeView {
    return {
      configured: this.availability.configured,
      available: this.availability.configured && this.availability.executablePath !== undefined
        && this.availability.driverVersion === CUA_DRIVER_VERSION && this.providerModule !== undefined
        && this.availability.unavailableReason === undefined,
      provider: this.lease?.fiber === undefined ? undefined : 'cua-driver-mcp',
      executablePath: this.availability.executablePath,
      driverVersion: this.availability.driverVersion,
      permissionMode: 'standard',
      catalogSize: CUA_TOOLS.length,
      unavailableReason: this.availability.unavailableReason,
      lastError: this.lastError,
    }
  }

  state(agent: Agent): ComputerAgentStateView {
    const state = this.ensure(agent)
    const lease = this.lease?.agent === agent ? this.lease : undefined
    return {
      phase: lease?.phase ?? 'idle',
      leaseOwner: lease !== undefined,
      paused: lease?.paused ?? false,
      activeCalls: state.activeCalls,
      pendingExpiresAt: lease?.pendingExpiresAt,
      boundTurn: lease?.boundTurn,
      activity: state.activity.map(({ started: _started, ...item }) => item),
    }
  }

  owner(): Agent | undefined {
    return this.lease?.agent
  }

  async arm(agent: Agent): Promise<void> {
    await this.exclusive(async () => {
      const runtime = this.runtime()
      if (!runtime.available || this.providerModule === undefined || this.availability.executablePath === undefined) {
        throw new Error(runtime.unavailableReason ?? runtime.lastError ?? 'Computer control is unavailable')
      }
      if (this.lease !== undefined) {
        if (this.lease.agent === agent) return
        throw new Error(`Computer control is already leased to ${String(this.lease.agent.session.id)}`)
      }
      const boundTurn = openTurn(agent)
      const lease: ComputerLease = {
        agent, fiber: undefined, paused: false, phase: 'arming', boundTurn,
        pendingExpiresAt: undefined, pendingTimer: undefined,
      }
      this.lease = lease
      this.lastError = undefined
      this.notify()
      try {
        const launcher = fileURLToPath(new URL('./cua-mcp-launcher.js', import.meta.url))
        const fiber = agent.ctx.plugin(this.providerModule, {
          command: process.execPath,
          args: [launcher, this.availability.executablePath],
          toolCallTimeoutMs: 60_000,
        })
        lease.fiber = fiber
        await fiber.await()
        const names = this.ctx.tools.schemas(agent).map(schema => schema.name).filter(name => name.startsWith(CUA_TOOL_PREFIX)).sort()
        const expected = CUA_TOOLS.map(name => `${CUA_TOOL_PREFIX}${name}`).sort()
        if (names.length !== expected.length || names.some((item, index) => item !== expected[index])) {
          throw new Error(`scoped CUA catalog mismatch after registration (${names.length}/${expected.length})`)
        }
        if (lease.boundTurn === undefined) {
          lease.phase = 'pending'
          lease.pendingExpiresAt = Date.now() + CUA_PENDING_TTL_MS
          lease.pendingTimer = setTimeout(() => { void this.stop(agent, 'Pending computer lease expired', false) }, CUA_PENDING_TTL_MS)
        } else {
          lease.phase = 'active'
        }
        this.notify()
      } catch (error) {
        lease.phase = 'stopping'
        this.lastError = error instanceof Error ? error.message : String(error)
        try { await lease.fiber?.dispose() } catch { /* preserve the activation error */ }
        if (this.lease === lease) this.lease = undefined
        this.notify()
        throw error
      }
    })
  }

  async setPaused(agent: Agent, paused: boolean): Promise<void> {
    await this.exclusive(async () => {
      const lease = this.lease
      if (lease === undefined || lease.agent !== agent) throw new Error('That Agent does not own the computer lease')
      if (lease.phase === 'arming' || lease.phase === 'stopping') throw new Error('Computer lease is transitioning')
      lease.paused = paused
      lease.phase = paused ? 'paused' : lease.boundTurn === undefined ? 'pending' : 'active'
      this.notify()
    })
  }

  async stop(agent: Agent | undefined, reason: string, cancel: boolean): Promise<void> {
    await this.exclusive(async () => {
      const lease = this.lease
      if (lease === undefined || agent !== undefined && lease.agent !== agent) return
      lease.phase = 'stopping'
      lease.paused = true
      if (lease.pendingTimer !== undefined) clearTimeout(lease.pendingTimer)
      lease.pendingTimer = undefined
      this.notify()
      if (cancel && lease.agent.status === 'running') lease.agent.cancel({ kind: 'hook', reason })
      try {
        await lease.fiber?.dispose()
      } catch (error) {
        this.lastError = `CUA shutdown failed; restart dsh before rearming: ${error instanceof Error ? error.message : String(error)}`
      } finally {
        if (this.lease === lease) this.lease = undefined
        this.notify()
      }
    })
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private exclusive(task: () => Promise<void>): Promise<void> {
    const next = this.transition.then(task, task)
    this.transition = next.catch(() => undefined)
    return next
  }

  private ensure(agent: Agent): MutableAgentState {
    let state = this.states.get(agent)
    if (state === undefined) {
      state = { activeCalls: 0, activity: [] }
      this.states.set(agent, state)
    }
    return state
  }

  private record(exec: Readonly<ToolExecution>, status: ComputerActivityStatus): MutableActivity | undefined {
    if (exec.agent === undefined) return undefined
    const state = this.ensure(exec.agent)
    const callId = String(exec.callId)
    let item = state.activity.find(activity => activity.callId === callId)
    if (item === undefined) {
      item = {
        callId,
        tool: computerToolName(exec.name) ?? exec.name,
        summary: computerToolSummary(exec.name, exec.arguments),
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
    const known = computerToolKnown(exec.name)
    if (known === undefined) return next()
    const denial = this.guard(exec)
    if (denial !== undefined) {
      this.record(exec, 'denied')
      return { kind: 'deny', reason: denial }
    }
    this.record(exec, 'running')
    return { kind: 'allow' }
  }

  private guard(exec: Readonly<ToolExecution>): string | undefined {
    const known = computerToolKnown(exec.name)
    if (known === undefined) return undefined
    if (!known) return 'This CUA tool is outside the pinned 0.28.2 catalog and is disabled.'
    if (exec.agent === undefined) return 'Computer tools require an owning live Agent Session.'
    const lease = this.lease
    if (lease === undefined || lease.agent !== exec.agent) return 'Computer control is not armed for this Agent.'
    if (lease.phase === 'arming') return 'Computer control is still starting.'
    if (lease.phase === 'pending') return 'The computer lease is armed for the next turn but no turn is open yet.'
    if (lease.phase === 'paused') return 'Computer control is paused for manual takeover.'
    if (lease.phase === 'stopping') return 'Computer control is stopping.'
    return undefined
  }

  private async execute(exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult> {
    if (computerToolKnown(exec.name) !== true || exec.agent === undefined) return next()
    const state = this.ensure(exec.agent)
    const item = this.record(exec, 'running')
    if (item !== undefined) item.started = true
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

export async function apply(ctx: Context): Promise<void> {
  let availability = await probeCuaExecutable(discoverCuaExecutable())
  let providerModule: CuaProviderModule | undefined
  if (availability.configured && availability.executablePath !== undefined && availability.unavailableReason === undefined) {
    try {
      providerModule = await loadHostCuaProvider()
    } catch (error) {
      availability = { ...availability, unavailableReason: error instanceof Error ? error.message : String(error) }
    }
  }
  new ComputerControlService(ctx, availability, providerModule)
}
