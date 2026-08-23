import React from 'react'
import { renderToString } from 'ink'
import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import { InteractionController, type RuntimeSnapshot } from '../../src/interaction-controller.js'
import { TranscriptStore } from '../../src/transcript-store.js'
import { Shell } from '../../src/ui/app.js'

const ansi = /\u001B\[[0-?]*[ -/]*[@-~]/g

function controller(snapshot: RuntimeSnapshot): InteractionController {
  return {
    transcript: new TranscriptStore(), subscribe: () => () => {}, getSnapshot: () => snapshot,
  } as unknown as InteractionController
}

const base: RuntimeSnapshot = {
  sessionId: 'session-m3', cwd: 'C:\\work', model: 'mock/whale', agentStatus: 'running', permission: 'workspace-write',
  projection: undefined, theme: 'abyss', notice: undefined, error: undefined, approval: undefined, questions: undefined,
  pendingImages: [], imageInput: false,
}

describe('M3 blocking-card presentation', () => {
  it('renders an approval card with fail-closed choices inside 120 columns', () => {
    const frame = renderToString(<Shell theme="abyss" color="mono" controller={controller({
      ...base, approval: { id: 1, toolName: 'bash', callId: 'call-1', reason: '写入 文件.txt' },
    })} />, { columns: 120 }).replace(ansi, '')
    expect(frame).toContain('PERMISSION REQUIRED · bash')
    expect(frame).toContain('y / 1 allow once')
    expect(frame).toContain('n / 2 reject')
    for (const line of frame.split('\n')) expect(stringWidth(line)).toBeLessThanOrEqual(120)
  })

  it('renders plan-review intent without inferring approval from option order', () => {
    const frame = renderToString(<Shell theme="abyss" color="mono" controller={controller({
      ...base,
      questions: { id: 2, questions: [{
        id: 'plan', header: 'PLAN REVIEW', question: '采用这个计划吗？', detail: '两步执行', multiSelect: false,
        approve: '采用', options: [{ label: '拒绝' }, { label: '采用', description: '继续执行' }],
      }] },
    })} />, { columns: 120 }).replace(ansi, '')
    expect(frame).toContain('PLAN REVIEW · 1/1')
    expect(frame).toContain('采用 · approve')
    expect(frame).toContain('z. Other')
  })
})
