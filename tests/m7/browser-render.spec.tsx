import React from 'react'
import { renderToString } from 'ink'
import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import type { InteractionController, BrowserViewSnapshot } from '../../src/interaction-controller.js'
import { BrowserCenter } from '../../src/ui/browser-center.js'
import { resolveTheme } from '../../src/ui/theme.js'

const ansi = /\u001B\[[0-?]*[ -/]*[@-~]/gu
const theme = resolveTheme('abyss', 'mono')

const VIEW: BrowserViewSnapshot = {
  configured: true,
  available: true,
  provider: 'experimental-browser-use-playwright-mcp',
  mode: 'launch',
  visible: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  unavailableReason: undefined,
  actors: [
    {
      sessionId: 'session-lead-very-long', name: 'lead', role: 'lead', memberStatus: 'idle',
      control: 'enabled', activeCalls: 0,
      activity: [{
        callId: 'call-1', tool: 'browser_snapshot', status: 'succeeded', time: 1,
        summary: '读取包含很长中文标题和宽字符的可访问性快照，但不能越过右侧边界',
      }],
    },
    {
      sessionId: 'session-browser-builder-long', name: '浏览器-builder-长名称', role: 'teammate', memberStatus: 'running',
      control: 'paused', activeCalls: 1,
      activity: [{
        callId: 'call-2', tool: 'browser_navigate', status: 'running', time: 2,
        summary: 'Navigate to https://example.test/安全页面?…',
      }],
    },
  ],
}

function controller(view: BrowserViewSnapshot = VIEW): InteractionController {
  return {
    browserView: () => view,
    subscribeBrowser: () => () => {},
    setBrowserPaused: () => true,
  } as unknown as InteractionController
}

function frame(columns: number, rows: number, view: BrowserViewSnapshot = VIEW): string {
  return renderToString(
    <BrowserCenter controller={controller(view)} width={columns} height={rows} theme={theme}
      plain={columns < 60} onClose={() => {}} initialView={view} />,
    { columns },
  ).replace(ansi, '')
}

function expectFits(value: string, columns: number, rows: number): void {
  const lines = value.split('\n')
  expect(lines.length).toBeLessThanOrEqual(rows)
  for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(columns)
}

describe('Browser Center full-screen layout', () => {
  it.each([[80, 24], [120, 40]] as const)('fits at %ix%i with long CJK and active calls', (columns, rows) => {
    const output = frame(columns, rows)
    expect(output).toContain('BROWSER / SAFE PLAYWRIGHT CONTROL')
    expect(output).toContain('each live Agent owns a separate browser')
    expect(output).toContain('browser/snapshot')
    expectFits(output, columns, rows)
  })

  it('reports unavailable discovery without hiding the recovery reason', () => {
    const output = frame(80, 24, {
      configured: true, available: false, provider: undefined, mode: 'launch', visible: true,
      executablePath: undefined, unavailableReason: 'No compatible system Chrome or Edge executable was found',
      actors: [],
    })
    expect(output).toContain('unavailable')
    expect(output).toContain('No compatible system Chrome or Edge executable was found')
    expectFits(output, 80, 24)
  })
})
