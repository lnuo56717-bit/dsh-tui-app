import React from 'react'
import { renderToString } from 'ink'
import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import type { InteractionController, RuntimeSnapshot } from '../../src/interaction-controller.js'
import type { TeamViewSnapshot } from '../../src/team.js'
import { TranscriptStore } from '../../src/transcript-store.js'
import { TeamCenter, type TeamMode, type TeamTab } from '../../src/ui/team-center.js'
import { resolveTheme } from '../../src/ui/theme.js'

const ansi = /\u001B\[[0-?]*[ -/]*[@-~]/gu
const theme = resolveTheme('abyss', 'mono')

const VIEW: TeamViewSnapshot = {
  members: [
    { id: 'session-lead' as never, name: 'lead', role: 'lead', status: 'idle', model: 'deepseek/reasoner', diagnostics: [] },
    { id: 'session-builder-very-long' as never, name: 'builder', role: 'teammate', status: 'running', description: '实现非常长的中文界面并验证宽字符不会溢出边框', provider: 'spawn', context: 'fresh', model: 'deepseek/reasoner', diagnostics: ['shared cwd'] },
    { id: 'session-reviewer' as never, name: 'reviewer', role: 'teammate', status: 'idle', description: '复核', provider: 'fork', context: 'fork', model: 'deepseek/chat', diagnostics: [] },
  ],
  tasks: [{
    id: 'task-1' as never, revision: 7, subject: '检查中文宽字符和非常非常长的任务标题不会越过右侧边界', description: '验收', status: 'in_progress',
    blockedBy: [], writeScopes: ['src/界面', 'tests'], ownerName: 'builder', ready: true,
    writeScopeWarnings: ['write scope 与 reviewer 的任务发生重叠；所有成员仍共享同一个 cwd'],
  }],
  activity: [
    { id: 'team:1', seq: 1, kind: 'member', title: 'builder · active', detail: '实现界面' },
    { id: 'team:2', seq: 2, kind: 'message-queued', title: 'lead → builder · queued', detail: '继续完成任务并报告结果' },
    { id: 'team:3', seq: 3, kind: 'task', title: 'task-1 · in_progress · r7', detail: '检查中文宽字符' },
  ],
}

const RUNTIME: RuntimeSnapshot = {
  sessionId: 'session-lead', cwd: 'C:\共享工作区\deepseek-tui', model: 'deepseek/reasoner', agentStatus: 'idle',
  permission: 'workspace-write', projection: undefined, theme: 'abyss', notice: undefined, error: undefined,
  approval: undefined, questions: undefined, interactionCount: 0, interactionIndex: 0, teamSummary: { teammates: 2, running: 1, pendingTasks: 1 },
  pendingImages: [], imageInput: false,
}

function controller(): InteractionController {
  return {
    transcript: new TranscriptStore(), subscribe: () => () => {}, getSnapshot: () => RUNTIME,
    async teamView() { return VIEW }, async watchTeam() {},
  } as unknown as InteractionController
}

function frame(columns: number, rows: number, tab: TeamTab, mode?: TeamMode): string {
  return renderToString(<TeamCenter controller={controller()} width={columns} height={rows} theme={theme} plain={columns < 60}
    onClose={() => {}} initialView={VIEW} initialTab={tab} {...(mode === undefined ? {} : { initialMode: mode })} />, { columns }).replace(ansi, '')
}

function expectFits(value: string, columns: number, rows: number): void {
  const lines = value.split('\n')
  expect(lines.length).toBeLessThanOrEqual(rows)
  for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(columns)
}

describe('Agent Teams full-screen layout', () => {
  it.each([[80, 24], [120, 40]] as const)('fits all three pages at %ix%i with long CJK', (columns, rows) => {
    for (const tab of ['roster', 'tasks', 'activity'] as const) {
      const output = frame(columns, rows, tab)
      expect(output).toContain(`1 ROSTER`)
      expect(output).toContain(tab.toUpperCase())
      expectFits(output, columns, rows)
    }
  })

  it('fits teammate and task forms, action menu, and destructive confirmation at 80x24', () => {
    const modes: TeamMode[] = [
      { kind: 'member', title: 'CREATE TEAMMATE', labels: ['name', 'description', 'prompt'], values: ['中文-reviewer', '很长的中文说明'.repeat(8), '完整检查实现'.repeat(8)], field: 2, context: 'fresh' },
      { kind: 'task-create', title: 'CREATE TEAM TASK', labels: ['subject', 'description', 'write scopes (comma)'], values: ['检查中文'.repeat(8), '说明'.repeat(16), 'src, tests'], field: 2 },
      { kind: 'dependency-picker', purpose: 'create', selected: 0, chosen: ['task-1'], subject: '新任务', description: '依赖选择', writeScopes: ['src'] },
      { kind: 'task-actions', task: VIEW.tasks[0]!, selected: 7 },
      { kind: 'confirm-delete', task: VIEW.tasks[0]! },
    ]
    for (const mode of modes) expectFits(frame(80, 24, mode.kind === 'task-create' || mode.kind === 'task-actions' || mode.kind === 'confirm-delete' ? 'tasks' : 'roster', mode), 80, 24)
    expect(frame(80, 24, 'tasks', modes[2])).toContain('CREATE TASK · DEPENDENCIES')
    expect(frame(80, 24, 'tasks', modes[3])).toContain('Every update uses this displayed revision')
    expect(frame(80, 24, 'tasks', modes[4])).toContain('Delete task task-1')
  })

  it('renders an explicitly read-only member session view', () => {
    const store = new TranscriptStore()
    store.dispatch({ seq: 0, type: 'user/message', data: { role: 'user', source: { kind: 'team-message', senderName: 'lead' }, content: [{ type: 'text', text: '检查记录' }] } })
    const mode: TeamMode = { kind: 'transcript', member: VIEW.members[1]!, lease: { store, live: false, dispose() {} }, offset: 0 }
    const output = frame(80, 24, 'roster', mode)
    expect(output).toContain('READ-ONLY SESSION')
    expect(output).toContain('persisted SessionHandle')
    expectFits(output, 80, 24)
  })
})
