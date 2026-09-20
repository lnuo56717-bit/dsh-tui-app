import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import {
  CUA_DRIVER_VERSION,
  CUA_PENDING_TTL_MS,
  CUA_TOOL_PREFIX,
  CUA_TOOLS,
  ComputerControlService,
  computerResultValue,
  computerToolDisplay,
  computerToolKnown,
  computerToolSummary,
  discoverCuaExecutable,
  validateCuaCatalog,
} from '../../src/computer-control.js'
import { standardCuaEnvironment } from '../../src/cua-mcp-launcher.js'
import { foldEvents, type EventLike } from '../../src/transcript-fold.js'
import { transcriptRows } from '../../src/ui/transcript-rows.js'

function tool(name: string): string { return `${CUA_TOOL_PREFIX}${name}` }

function agent(id: string): Agent {
  return {
    session: { id, seq: 0, eventAt() { return undefined } },
    status: 'idle',
  } as unknown as Agent
}

function execution(owner: Agent, name = tool('click'), callId = 'call-1'): ToolExecution {
  return {
    name, callId, rootCallId: callId, arguments: {}, signal: new AbortController().signal,
    token: Symbol('cua-call') as ToolExecution['token'], agent: owner,
  }
}

describe('pinned Cua Driver 0.28.2 contract', () => {
  it('locks the exact 57-tool MCP catalog and fails closed on additions or omissions', () => {
    expect(CUA_DRIVER_VERSION).toBe('0.28.2')
    expect(CUA_TOOLS).toHaveLength(57)
    expect(new Set(CUA_TOOLS).size).toBe(57)
    expect(validateCuaCatalog(CUA_TOOLS)).toEqual({ ok: true, missing: [], extra: [] })
    expect(validateCuaCatalog(CUA_TOOLS.slice(1))).toMatchObject({ ok: false, missing: ['list_apps'] })
    expect(validateCuaCatalog([...CUA_TOOLS, 'future_power'])).toMatchObject({ ok: false, extra: ['future_power'] })
    for (const name of CUA_TOOLS) expect(computerToolKnown(tool(name))).toBe(true)
    expect(computerToolKnown(tool('future_power'))).toBe(false)
    expect(computerToolKnown('bash')).toBeUndefined()
  })

  it('forces standard mode and removes all inherited capability grants', () => {
    const env = standardCuaEnvironment({
      CUA_DRIVER_PERMISSION_MODE: 'unrestricted',
      CUA_DRIVER_CAPABILITY_MANIFEST_FILE: 'grant.json',
      CUA_DRIVER_CAPABILITY_MANIFEST_APPROVED: '1',
      CUA_DRIVER_SESSION_POLICY_FILE: 'policy.json',
      CUA_DRIVER_SESSION_POLICY: 'unsafe',
      CUA_DRIVER_SESSION_POLICY_APPROVED: '1',
      KEEP_ME: 'yes',
    })
    expect(env.CUA_DRIVER_PERMISSION_MODE).toBe('standard')
    expect(env.CUA_DRIVER_CAPABILITY_MANIFEST_FILE).toBeUndefined()
    expect(env.CUA_DRIVER_CAPABILITY_MANIFEST_APPROVED).toBeUndefined()
    expect(env.CUA_DRIVER_SESSION_POLICY_FILE).toBeUndefined()
    expect(env.CUA_DRIVER_SESSION_POLICY).toBeUndefined()
    expect(env.CUA_DRIVER_SESSION_POLICY_APPROVED).toBeUndefined()
    expect(env.KEEP_ME).toBe('yes')
  })

  it('supports the recovery switch and validates an explicit executable path', () => {
    expect(discoverCuaExecutable({ DSH_TUI_COMPUTER: 'off' })).toMatchObject({ configured: false })
    expect(discoverCuaExecutable({ DSH_TUI_CUA_EXECUTABLE: process.execPath })).toEqual({
      configured: true, executablePath: process.execPath,
    })
    expect(discoverCuaExecutable({ DSH_TUI_CUA_EXECUTABLE: 'Z:\\missing-cua.exe' })).toEqual({
      configured: true,
      unavailableReason: 'DSH_TUI_CUA_EXECUTABLE is not a file: Z:\\missing-cua.exe',
    })
    expect(CUA_PENDING_TTL_MS).toBe(5 * 60 * 1_000)
  })
})

describe('exclusive armed-Agent policy and privacy-safe presentation', () => {
  it('denies unarmed, wrong-Agent, paused, pending and unknown calls; active calls never ask', async () => {
    const ctx = new Context()
    ctx.provide('tools', { guard() { return () => undefined } } as unknown as ToolRuntime)
    const service = new ComputerControlService(ctx, { configured: false }, undefined)
    const owner = agent('owner')
    const other = agent('other')
    const internal = service as unknown as {
      lease?: { agent: Agent; fiber: undefined; paused: boolean; phase: 'pending' | 'active' | 'paused'; boundTurn: number | undefined; pendingExpiresAt: number | undefined; pendingTimer: undefined }
      guard(exec: Readonly<ToolExecution>): string | undefined
      preExecute(exec: ToolExecution, next: () => Promise<{ kind: 'allow' }>): Promise<{ kind: string }>
    }

    expect(internal.guard(execution(owner))).toMatch(/not armed/u)
    internal.lease = { agent: owner, fiber: undefined, paused: false, phase: 'active', boundTurn: 1, pendingExpiresAt: undefined, pendingTimer: undefined }
    expect(internal.guard(execution(other))).toMatch(/not armed/u)
    expect(internal.guard(execution(owner))).toBeUndefined()
    let downstreamCalls = 0
    expect(await internal.preExecute(execution(owner), async () => { downstreamCalls += 1; return { kind: 'allow' } })).toEqual({ kind: 'allow' })
    expect(downstreamCalls).toBe(0)
    internal.lease.phase = 'paused'
    expect(internal.guard(execution(owner))).toMatch(/paused/u)
    internal.lease.phase = 'pending'
    expect(internal.guard(execution(owner))).toMatch(/next turn/u)
    internal.lease.phase = 'active'
    expect(internal.guard(execution(owner, tool('future_power')))).toMatch(/outside the pinned/u)
    internal.lease = undefined
    await ctx.fiber.dispose()
  })

  it('emergency stop cancels only the lease owner, tears down the provider and releases the lease', async () => {
    const ctx = new Context()
    ctx.provide('tools', { guard() { return () => undefined } } as unknown as ToolRuntime)
    const cancel = vi.fn()
    const dispose = vi.fn(async () => undefined)
    const owner = {
      ...agent('owner'), status: 'running', cancel,
    } as unknown as Agent
    const service = new ComputerControlService(ctx, { configured: false }, undefined)
    const internal = service as unknown as {
      lease?: {
        agent: Agent
        fiber: { dispose(): Promise<void> }
        paused: boolean
        phase: 'active'
        boundTurn: number
        pendingExpiresAt: undefined
        pendingTimer: undefined
      }
    }
    internal.lease = {
      agent: owner, fiber: { dispose }, paused: false, phase: 'active', boundTurn: 7,
      pendingExpiresAt: undefined, pendingTimer: undefined,
    }

    await service.stop(owner, 'Operator emergency stop', true)
    expect(cancel).toHaveBeenCalledWith({ kind: 'hook', reason: 'Operator emergency stop' })
    expect(dispose).toHaveBeenCalledOnce()
    expect(service.owner()).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('never repeats typed text, clipboard data, URL secrets or full file paths', () => {
    expect(computerToolSummary(tool('type_text'), { text: 'private desktop text' }))
      .toBe('type text · 20 characters · content hidden')
    expect(computerToolSummary(tool('clipboard_write'), { text: 'clipboard-secret' }))
      .toBe('clipboard write · <16 chars hidden>')
    const navigation = computerToolSummary(tool('browser_navigate'), {
      url: 'https://user:pass@example.com/account?token=never-print#fragment',
    })
    expect(navigation).toContain('https://example.com/account?…')
    expect(navigation).not.toMatch(/user|pass|token|never-print|fragment/u)
    const upload = computerToolSummary(tool('browser_set_input_files'), {
      paths: ['C:\\private\\customer-secret\\photo.png'],
    })
    expect(upload).toContain('photo.png')
    expect(upload).not.toContain('customer-secret')
    expect(computerResultValue(tool('clipboard_read'), 'clipboard-secret')).not.toContain('clipboard-secret')
    expect(computerResultValue(tool('get_browser_state'), {
      url: 'https://example.com/path?token=never-print', outputPath: 'C:\\private\\report.txt',
    })).toEqual({ url: 'https://example.com/path?…', outputPath: 'report.txt' })
  })

  it('renders CUA calls with compact names and redacted transcript arguments', () => {
    const secret = 'private-desktop-value'
    expect(computerToolDisplay(tool('browser_type'), JSON.stringify({ text: secret })))
      .toEqual({ name: 'computer/browser-type', summary: 'browser type · 21 characters · content hidden' })
    expect(computerToolDisplay('bash', '{}')).toBeUndefined()
    const events: EventLike[] = [
      { seq: 0, type: 'tool/call', data: { callId: 'call-1', name: tool('browser_type'), arguments: JSON.stringify({ text: secret }) } },
      { seq: 1, type: 'tool/result', data: { message: { source: { kind: 'tool', callId: 'call-1' }, content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'done' }] }] } } },
    ]
    const rows = transcriptRows(foldEvents(events), {
      width: 100, compact: false, expandedBlocks: new Set(), thinkingGlyph: '·',
    })
    const rendered = rows.flatMap(row => row.segments.map(segment => segment.text)).join('\n')
    expect(rendered).toContain('computer/browser-type')
    expect(rendered).toContain('21 characters')
    expect(rendered).not.toContain(secret)

    const clipboardSecret = 'clipboard-result-must-not-render'
    const clipboardState = foldEvents([
      { seq: 0, type: 'tool/call', data: { callId: 'clip-1', name: tool('clipboard_read'), arguments: '{}' } },
      { seq: 1, type: 'tool/result', data: { message: { source: { kind: 'tool', callId: 'clip-1' }, content: [{ type: 'tool-result', toolCallId: 'clip-1', content: [{ type: 'text', text: clipboardSecret }] }] } } },
    ])
    const clipboardNode = clipboardState.nodes.find(node => node.kind === 'tool')
    const clipboardRows = transcriptRows(clipboardState, {
      width: 100, compact: false,
      expandedBlocks: new Set(clipboardNode === undefined ? [] : [`tool:${clipboardNode.id}`]), thinkingGlyph: '·',
    }).flatMap(row => row.segments.map(segment => segment.text)).join('\n')
    expect(clipboardRows).toContain('result hidden in TUI')
    expect(clipboardRows).not.toContain(clipboardSecret)
  })
})
