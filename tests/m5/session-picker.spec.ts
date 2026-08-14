import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { InteractionController, type SessionChoice } from '../../src/interaction-controller.js'
import { foldSessionSummary } from '../../src/session-summary.js'
import type { EventLike } from '../../src/transcript-fold.js'
import { sessionDetail, sessionLabel, sessionMeta } from '../../src/ui/session-picker.js'
import { padCells, relativeTime } from '../../src/ui/status.js'

const log: EventLike[] = [
  { seq: 0, time: 1_000, type: 'session/created', data: {} },
  { seq: 1, time: 2_000, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '  帮我修复\n滚轮回填历史的问题  ' }] } },
  { seq: 2, time: 2_100, type: 'session/title', data: { title: '临时标题', messageSeqs: [1], source: { kind: 'fallback' } } },
  { seq: 3, time: 3_000, type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '好的' }] } } },
  { seq: 4, time: 4_000, type: 'user/message', data: { source: { kind: 'hook' }, content: [{ type: 'text', text: '不是人类输入' }] } },
  { seq: 5, time: 5_000, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '继续' }] } },
  { seq: 6, time: 6_000, type: 'session/title', data: { title: '修复滚轮回填历史', messageSeqs: [1, 5], source: { kind: 'user' } } },
]

function fixture(events: readonly EventLike[] | Error, perId?: Record<string, readonly EventLike[]>, raw?: Record<string, string>) {
  const reads: string[] = []
  const ctx = {
    on: () => () => {},
    get: (name: string) => name !== 'sessionPersistence' ? services[name] : services.sessionPersistence,
  } as unknown as Context
  const services: Record<string, any> = {
    agentDefaultModel: { currentSelection: () => ({ provider: 'mock', model: 'whale' }), async saveSelection() {} },
    sessionPersistence: {
      async list() {
        return [
          { version: 0, id: 'session-b', createdAt: 2_000, cwd: 'C:\\work\\b' },
          { version: 0, id: 'session-a', createdAt: 9_000, cwd: 'C:\\work\\a' },
        ]
      },
      async readFrom(id: string, fromSeq: number) {
        reads.push(`${String(id)}@${fromSeq}`)
        if (events instanceof Error) throw events
        return { meta: { version: 0, id, createdAt: 1_000 }, events: perId?.[String(id)] ?? events }
      },
      async readRaw(id: string) {
        const content = raw?.[String(id)]
        if (content === undefined) return undefined
        return { meta: { version: 0, id, createdAt: 1_000 }, filename: 'session.jsonl', content }
      },
    },
  }
  return { ctx, reads }
}

describe('persisted sessions read as conversations, not ids', () => {
  it('folds the latest logged title, the opening human prompt, and real activity', () => {
    expect(foldSessionSummary(log)).toEqual({
      title: '修复滚轮回填历史',
      firstPrompt: '帮我修复 滚轮回填历史的问题',
      prompts: 2,
      updatedAt: 6_000,
    })
  })

  it('invents nothing for a log with no title and no human prompt', () => {
    expect(foldSessionSummary([{ seq: 0, time: 10, type: 'turn/start', data: {} }])).toEqual({ prompts: 0, updatedAt: 10 })
    expect(foldSessionSummary([])).toEqual({ prompts: 0 })
  })

  it('describes a stored session through the read-only persistence seam and caches it', async () => {
    const fx = fixture(log)
    const controller = new InteractionController(fx.ctx, 'abyss')
    expect(await controller.describeSession('session-a')).toEqual({
      id: 'session-a', title: '修复滚轮回填历史', firstPrompt: '帮我修复 滚轮回填历史的问题', prompts: 2, updatedAt: 6_000,
    })
    await controller.describeSession('session-a')
    expect(fx.reads).toEqual(['session-a@0'])
  })

  it('reports an unreadable log instead of failing the picker', async () => {
    const fx = fixture(new Error('unsupported session format version 9'))
    const controller = new InteractionController(fx.ctx, 'abyss')
    const summary = await controller.describeSession('session-b')
    expect(summary.unreadable).toContain('unsupported session format version 9')
    expect(summary.title).toBeUndefined()
  })

  it('rescues the title from the raw artifact when the strict read rejects the log', async () => {
    // The jsonl backend stores dense chunk runs as packed rows; the raw rescue
    // expands them and folds the same facts the strict read would have.
    const raw = [
      JSON.stringify({ type: 'session', version: 0, id: 'session-b' }),
      JSON.stringify({ seq: 0, time: 1_000, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '开头的问题' }] } }),
      JSON.stringify({ seq: 1, time: 2_000, type: 'session/title', data: { title: '损坏日志的标题' } }),
      JSON.stringify({ type: 'reasoning-chunks', seq0: 2, time0: 3_000, data: { turn: 1, step: 1, index: 0, dt: [5], texts: ['a', 'b'] } }),
      JSON.stringify({ seq: 4, time: 9_000, type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '好的' }] } } }),
    ].join('\n')
    const fx = fixture(new Error('corrupt session log: seq gap in committed region'), undefined, { 'session-b': raw })
    const controller = new InteractionController(fx.ctx, 'abyss')
    const summary = await controller.describeSession('session-b')
    expect(summary.title).toBe('损坏日志的标题')
    expect(summary.firstPrompt).toBe('开头的问题')
    expect(summary.prompts).toBe(1)
    expect(summary.updatedAt).toBe(9_000)
    expect(summary.unreadable).toBeUndefined()
  })

  it('keeps the id when both the strict read and the raw artifact are unusable', async () => {
    const fx = fixture(new Error('corrupt session log: seq gap in committed region'), undefined, { 'session-b': 'not json at all' })
    const controller = new InteractionController(fx.ctx, 'abyss')
    const summary = await controller.describeSession('session-b')
    expect(summary.unreadable).toContain('seq gap')
    expect(summary.title).toBeUndefined()
  })

  it('lists by last activity, not by creation time', async () => {
    // session-a: created 9_000, last activity 9_500; session-b: created 2_000, last activity 6_000.
    const fx = fixture(log, {
      'session-a': [...log, { seq: 99, time: 9_500, type: 'assistant/message', data: { turn: 9, step: 9, message: { role: 'assistant', content: [] } } }],
    })
    const controller = new InteractionController(fx.ctx, 'abyss')
    const items = await controller.listSessions()
    expect(items.map(item => item.id)).toEqual(['session-a', 'session-b'])
    expect(items.every(item => !item.current)).toBe(true)
  })

  it('puts a freshly used older session above a long-idle newer one', async () => {
    // session-a: created 9_000 but idle since 1_000; session-b: created 2_000, active until 6_000.
    const fx = fixture(log, {
      'session-a': [log[0]!],
    })
    const controller = new InteractionController(fx.ctx, 'abyss')
    const items = await controller.listSessions()
    expect(items.map(item => item.id)).toEqual(['session-b', 'session-a'])
  })

  it('labels a row by title, then opening prompt, then id — and keeps the id in the detail line', () => {
    const item: SessionChoice = { id: 'session-uuid-1', cwd: 'C:\\work', createdAt: 1_000, current: false }
    expect(sessionLabel(item, undefined)).toBe('reading conversation…')
    expect(sessionLabel(item, { id: item.id, title: '修复滚轮', firstPrompt: '第一句', prompts: 2 })).toBe('修复滚轮')
    expect(sessionLabel(item, { id: item.id, firstPrompt: '第一句', prompts: 1 })).toBe('第一句')
    expect(sessionLabel(item, { id: item.id, prompts: 0 })).toBe('untitled · session-uuid-1')
    expect(sessionLabel(item, { id: item.id, prompts: 0, unreadable: 'corrupt' })).toBe('unreadable log · session-uuid-1')
    expect(sessionLabel(item, { id: item.id, title: 'key sk-tui-fake-key-0123456789', prompts: 1 })).toBe('key sk-…')
    expect(sessionDetail(item)).toContain('session-uuid-1')
    expect(sessionDetail(undefined)).toBeUndefined()
  })

  it('states current, prompt count, and age without inventing timing', () => {
    const now = 10_000_000
    const item: SessionChoice = { id: 'session-1', cwd: undefined, createdAt: now - 120_000, current: true }
    expect(sessionMeta(item, { id: item.id, prompts: 1, updatedAt: now - 1_800_000 }, now)).toBe('current · 1 prompt · 30m ago')
    expect(sessionMeta(item, { id: item.id, prompts: 1, updatedAt: now - 7_200_000 }, now)).toBe('current · 1 prompt · 2h ago')
    expect(sessionMeta({ ...item, current: false }, { id: item.id, prompts: 4, updatedAt: now - 30_000 }, now)).toBe('4 prompts · just now')
    expect(sessionMeta({ ...item, current: false }, { id: item.id, prompts: 0, unreadable: 'corrupt' }, now)).toBe('2m ago')
    expect(relativeTime(undefined)).toBeUndefined()
    expect(relativeTime(0)).toBeUndefined()
  })

  it('fits a label column by display cells so the right column stays aligned', () => {
    expect(padCells('中文标题', 10)).toBe('中文标题  ')
    expect(padCells('中文标题很长很长', 9)).toBe('中文标题…')
    expect(padCells('abc', 0)).toBe('')
  })
})
