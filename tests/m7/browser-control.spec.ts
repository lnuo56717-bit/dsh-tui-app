import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type ToolRuntime from '@deepseek-ai/dsh-tools'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import {
  BROWSER_APPROVAL_TOOLS,
  BROWSER_BLOCKED_TOOLS,
  BROWSER_READ_TOOLS,
  BROWSER_TOOL_PREFIX,
  browserApprovalSummary,
  browserApprovalWasGranted,
  browserInputTargetsSensitive,
  browserToolDisplay,
  browserToolPolicy,
  BrowserControlService,
  discoverBrowserExecutable,
} from '../../src/browser-control.js'
import { foldEvents, type EventLike } from '../../src/transcript-fold.js'
import { transcriptRows } from '../../src/ui/transcript-rows.js'

function tool(name: string): string { return `${BROWSER_TOOL_PREFIX}${name}` }

function execution(events: readonly { type: string; data: unknown }[], name = tool('browser_click'), callId = 'call-1'): ToolExecution {
  const session = {
    seq: events.length,
    eventAt(index: number) { return events[index] },
  }
  return {
    name, callId, rootCallId: callId, arguments: {}, signal: new AbortController().signal,
    token: Symbol('browser-call') as ToolExecution['token'],
    agent: { session } as unknown as Agent,
  }
}

describe('pinned Playwright browser safety catalog', () => {
  it('classifies all 24 default tools fail-closed', () => {
    expect(BROWSER_READ_TOOLS).toHaveLength(5)
    expect(BROWSER_APPROVAL_TOOLS).toHaveLength(18)
    expect(BROWSER_BLOCKED_TOOLS).toEqual(['browser_run_code_unsafe'])
    for (const name of BROWSER_READ_TOOLS) expect(browserToolPolicy(tool(name))).toBe('read')
    for (const name of BROWSER_APPROVAL_TOOLS) expect(browserToolPolicy(tool(name))).toBe('ask')
    expect(browserToolPolicy(tool('browser_run_code_unsafe'))).toBe('blocked')
    expect(browserToolPolicy(tool('browser_future_power'))).toBe('unknown')
    expect(browserToolPolicy('bash')).toBeUndefined()
  })

  it('never repeats typed values, URL secrets, or full upload paths in approval copy', () => {
    const typed = browserApprovalSummary(tool('browser_type'), {
      element: 'Search box', target: 'ref-7', text: 'never-print-this-secret', submit: true,
    })
    expect(typed).toContain('23 characters')
    expect(typed).not.toContain('never-print')

    const navigation = browserApprovalSummary(tool('browser_navigate'), {
      url: 'https://user:pass@example.com/account?token=never-print#fragment',
    })
    expect(navigation).toContain('https://example.com/account?…')
    expect(navigation).not.toMatch(/user|pass|token|never-print|fragment/u)

    const upload = browserApprovalSummary(tool('browser_file_upload'), {
      paths: ['C:\\private\\customer-secret\\photo.png'],
    })
    expect(upload).toContain('photo.png')
    expect(upload).not.toContain('customer-secret')
  })

  it('blocks credential-like targets in English and CJK without inspecting values', () => {
    expect(browserInputTargetsSensitive(tool('browser_type'), { element: 'Password', text: 'x' })).toBe(true)
    expect(browserInputTargetsSensitive(tool('browser_type'), { element: '搜索', text: 'password is only a search term' })).toBe(false)
    expect(browserInputTargetsSensitive(tool('browser_fill_form'), {
      fields: [{ name: '邮箱', value: 'a@example.com' }, { name: '验证码', value: '123456' }],
    })).toBe(true)
  })

  it('renders browser calls with short names and redacted summaries', () => {
    const display = browserToolDisplay(tool('browser_type'), JSON.stringify({ element: 'Comment', text: 'private draft' }))
    expect(display).toEqual({ name: 'browser/type', summary: 'Type 13 characters into Comment; text hidden' })
    expect(browserToolDisplay('bash', '{}')).toBeUndefined()
  })

  it('redacts model arguments in both pending and completed transcript rows', () => {
    const secret = 'private-browser-value'
    const events: EventLike[] = [
      { seq: 0, type: 'tool/call', data: { callId: 'call-1', name: tool('browser_type'), arguments: JSON.stringify({ element: 'Comment', text: secret }) } },
      { seq: 1, type: 'tool/result', data: { message: { source: { kind: 'tool', callId: 'call-1' }, content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'done' }] }] } } },
    ]
    const rows = transcriptRows(foldEvents(events), {
      width: 100, compact: false, expandedBlocks: new Set(), thinkingGlyph: '·',
    })
    const rendered = rows.flatMap(row => row.segments.map(segment => segment.text)).join('\n')
    expect(rendered).toContain('browser/type')
    expect(rendered).toContain('21 characters')
    expect(rendered).not.toContain(secret)
  })
})

describe('browser approval audit and executable discovery', () => {
  it('accepts only the exact allowed-once audit pair in the current turn', () => {
    const allowed = execution([
      { type: 'turn/start', data: {} },
      { type: 'approval/asked', data: { id: 'approval-1', callId: 'call-1', toolName: tool('browser_click') } },
      { type: 'approval/decided', data: { id: 'approval-1', outcome: 'allowed-once' } },
    ])
    expect(browserApprovalWasGranted(allowed)).toBe(true)
    expect(browserApprovalWasGranted(execution([
      { type: 'turn/start', data: {} },
      { type: 'approval/asked', data: { id: 'approval-1', callId: 'another-call', toolName: tool('browser_click') } },
      { type: 'approval/decided', data: { id: 'approval-1', outcome: 'allowed-once' } },
    ]))).toBe(false)
    expect(browserApprovalWasGranted(execution([
      { type: 'turn/start', data: {} },
      { type: 'approval/asked', data: { id: 'approval-1', callId: 'call-1', toolName: tool('browser_click') } },
      { type: 'approval/asked', data: { id: 'approval-2', callId: 'call-2', toolName: tool('browser_click') } },
      { type: 'approval/decided', data: { id: 'approval-2', outcome: 'allowed-once' } },
      { type: 'approval/decided', data: { id: 'approval-1', outcome: 'allowed-once' } },
    ]))).toBe(true)
    expect(browserApprovalWasGranted(execution([
      { type: 'turn/start', data: {} },
      { type: 'approval/asked', data: { id: 'approval-1', callId: 'call-1', toolName: tool('browser_click') } },
      { type: 'approval/decided', data: { id: 'approval-1', outcome: 'rejected' } },
    ]))).toBe(false)
  })

  it('supports an off switch, a validated explicit executable, and actionable invalid config', () => {
    expect(discoverBrowserExecutable({ DSH_TUI_BROWSER: 'off' })).toMatchObject({ configured: false })
    expect(discoverBrowserExecutable({ DSH_TUI_BROWSER_EXECUTABLE: process.execPath })).toEqual({
      configured: true, executablePath: process.execPath,
    })
    expect(discoverBrowserExecutable({ DSH_TUI_BROWSER_EXECUTABLE: 'Z:\\missing-browser.exe' })).toEqual({
      configured: true,
      unavailableReason: 'DSH_TUI_BROWSER_EXECUTABLE is not a browser executable: Z:\\missing-browser.exe',
    })
  })

  it('isolates pause state per exact Agent and rechecks it after approval waiting', async () => {
    const ctx = new Context()
    ctx.provide('tools', { guard() { return () => undefined } } as unknown as ToolRuntime)
    const service = new BrowserControlService(ctx, { configured: true, executablePath: process.execPath }, true)
    const first = execution([], tool('browser_click'))
    const second = execution([], tool('browser_click'), 'call-2')
    const agentA = first.agent as Agent
    const agentB = second.agent as Agent
    const internal = service as unknown as {
      preExecute(exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision>
      guard(exec: Readonly<ToolExecution>): string | undefined
    }

    expect(await internal.preExecute(first, async () => ({ kind: 'allow' }))).toMatchObject({ kind: 'ask' })
    service.setPaused(agentA, true)
    expect(internal.guard(first)).toMatch(/paused/u)
    expect(service.state(agentA).paused).toBe(true)
    expect(service.state(agentB).paused).toBe(false)
    expect(await internal.preExecute(second, async () => ({ kind: 'allow' }))).toMatchObject({ kind: 'ask' })
    await ctx.fiber.dispose()
  })
})
