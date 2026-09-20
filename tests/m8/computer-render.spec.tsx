import React from 'react'
import { renderToString } from 'ink'
import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import type { ComputerViewSnapshot, InteractionController } from '../../src/interaction-controller.js'
import { ComputerCenter, confirmsComputerArm } from '../../src/ui/computer-center.js'
import { resolveTheme } from '../../src/ui/theme.js'

const ansi = /\u001B\[[0-?]*[ -/]*[@-~]/gu
const theme = resolveTheme('abyss', 'mono')

const VIEW: ComputerViewSnapshot = {
  configured: true,
  available: true,
  provider: 'cua-driver-mcp',
  executablePath: 'C:\\Users\\tester\\AppData\\Local\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe',
  driverVersion: '0.28.2',
  permissionMode: 'standard',
  catalogSize: 57,
  unavailableReason: undefined,
  lastError: undefined,
  ownerSessionId: 'session-computer-builder-long',
  actors: [
    {
      sessionId: 'session-lead-very-long', name: 'lead', role: 'lead', memberStatus: 'idle',
      phase: 'idle', leaseOwner: false, paused: false, activeCalls: 0,
      pendingExpiresAt: undefined, boundTurn: undefined,
      activity: [{
        callId: 'call-1', tool: 'get_accessibility_tree', status: 'succeeded', time: 1,
        summary: '读取包含很长中文标题和宽字符的无障碍树，但不能越过右侧边界',
      }],
    },
    {
      sessionId: 'session-computer-builder-long', name: '电脑-builder-长名称', role: 'teammate', memberStatus: 'running',
      phase: 'active', leaseOwner: true, paused: false, activeCalls: 1,
      pendingExpiresAt: undefined, boundTurn: 7,
      activity: [{
        callId: 'call-2', tool: 'get_accessibility_tree', status: 'running', time: 2,
        summary: '读取包含很长中文标题和宽字符的无障碍树，但不能越过右侧边界',
      }],
    },
  ],
}

function controller(view: ComputerViewSnapshot = VIEW): InteractionController {
  return {
    computerView: () => view,
    subscribeComputer: () => () => {},
    armComputer: async () => true,
    setComputerPaused: async () => true,
    stopComputer: async () => true,
  } as unknown as InteractionController
}

function frame(columns: number, rows: number, view: ComputerViewSnapshot = VIEW): string {
  return renderToString(
    <ComputerCenter controller={controller(view)} width={columns} height={rows} theme={theme}
      plain={columns < 60} onClose={() => {}} initialView={view} />,
    { columns },
  ).replace(ansi, '')
}

function expectFits(value: string, columns: number, rows: number): void {
  const lines = value.split('\n')
  expect(lines.length).toBeLessThanOrEqual(rows)
  for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(columns)
}

describe('Computer Center full-screen layout', () => {
  it('requires the exact case-sensitive AUTO phrase before arming', () => {
    expect(confirmsComputerArm('AUTO')).toBe(true)
    expect(confirmsComputerArm('auto')).toBe(false)
    expect(confirmsComputerArm('AUTO ')).toBe(false)
  })

  it.each([[80, 24], [120, 40]] as const)('fits at %ix%i with long CJK and active calls', (columns, rows) => {
    const output = frame(columns, rows)
    expect(output).toContain('COMPUTER / CUA FULL-DESKTOP CONTROL')
    expect(output).toContain('one global desktop lease')
    expect(output).toContain('computer/get-accessibility-tree')
    expect(output).toContain('CUA: 电脑-builder-长名称 armed')
    expectFits(output, columns, rows)
  })

  it('reports unavailable discovery without hiding the exact-version recovery reason', () => {
    const output = frame(80, 24, {
      configured: true, available: false, provider: undefined,
      executablePath: undefined, driverVersion: '0.17.0', permissionMode: 'standard', catalogSize: 57,
      unavailableReason: 'Cua Driver 0.17.0 is installed; expected exactly 0.28.2', lastError: undefined,
      ownerSessionId: undefined, actors: [],
    })
    expect(output).toContain('unavailable')
    expect(output).toContain('expected exactly 0.28.2')
    expectFits(output, 80, 24)
  })
})
