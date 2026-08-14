import { describe, expect, it } from 'vitest'
import type { RuntimeSnapshot } from '../../src/interaction-controller.js'
import { sessionInfoLines, statusSegments } from '../../src/ui/status.js'

const base: RuntimeSnapshot = {
  sessionId: 'session-actual', cwd: 'C:\\项目\\鲸鱼', model: 'deepseek/chat', agentStatus: 'idle', permission: undefined,
  projection: undefined, theme: 'abyss', notice: undefined, error: undefined, approval: undefined, questions: undefined,
}

describe('M4 real-fact status formatting', () => {
  it('hides absent projection capabilities instead of inventing zero values', () => {
    const text = statusSegments(base).join(' · ')
    expect(text).toContain('deepseek/chat')
    expect(text).toContain('session-actual')
    expect(text).not.toMatch(/tokens|context|turns|steps|plan|todos|permission/iu)
  })

  it('renders one consistent projection cut without billing fields', () => {
    const runtime: RuntimeSnapshot = { ...base, projection: { asOfSeq: 42, values: {
      title: '深海修复', permissions: { currentValue: 'workspace-write', options: [] },
      tokenUsage: { uncachedInputTokens: 1200, outputTokens: 400, cacheReadTokens: 800, cacheWriteTokens: 0 },
      contextPressure: { projectedTokens: 18000, contextWindow: 128000 },
      contextBreakdown: { systemTokens: 100, toolsTokens: 200, messageTokens: 300 },
      sessionStats: { turns: 3, steps: 7, llmMs: 1200, toolMs: 80 },
      plan: { active: false, pending: true }, todos: [{ content: 'x', status: 'in_progress' }],
    } } }
    const status = statusSegments(runtime).join(' · ')
    expect(status).toContain('18k/128k 14%')
    expect(status).toContain('3 turns/7 steps')
    expect(status).toContain('plan off pending')
    expect(status).toContain('todos 1')
    const detail = sessionInfoLines(runtime).join('\n')
    expect(detail).toContain('projection   seq 42')
    expect(detail).toContain('cache read 800')
    expect(detail).not.toMatch(/\$|cost|price|billing/iu)
  })
})
