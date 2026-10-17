import React from 'react'
import { renderToString } from 'ink'
import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import { foldEvents, foldTranscript, type EventLike } from '../../src/transcript-fold.js'
import { TranscriptStore } from '../../src/transcript-store.js'
import { Shell } from '../../src/ui/app.js'
import { transcriptRows } from '../../src/ui/transcript-rows.js'
import { focusableBlocks } from '../../src/ui/transcript-view.js'

const failure = { message: 'DeepSeek Messages transport failed', code: 'TRANSPORT' }
function event(seq: number, type: string, data: unknown): EventLike { return { seq, type, data } }
function retry(seq: number, attempt = 1): EventLike {
  return event(seq, 'llm/retry', { retryId: 'chain', turn: 1, step: 1, provider: 'deepseek-official', mode: 'normal', retry: attempt, maxRetries: 5, delayMs: 500, failure })
}
function lines(events: readonly EventLike[], width = 76, expandedBlocks = new Set<string>()): string[] {
  return transcriptRows(foldEvents(events), { width, compact: false, expandedBlocks, thinkingGlyph: '◌' })
    .map(row => row.segments.map(segment => segment.text).join(''))
}

describe('request failures stay visible after retries', () => {
  it('shows attempt, backoff and cause, then merges retry-started without losing failure details', () => {
    const scheduled = [retry(0)]
    expect(lines(scheduled).join('\n')).toContain('Retry 1/5 · backoff 0.5s')
    expect(lines(scheduled).join('\n')).toContain('[TRANSPORT] DeepSeek Messages transport failed')
    const started = [...scheduled, event(1, 'llm/retry-started', { retryId: 'chain', turn: 1, step: 1, retry: 1 })]
    const state = foldEvents(started)
    expect(state.nodes).toHaveLength(1)
    expect(lines(started).join('\n')).toContain('Retry 1/5 · requesting')
    expect(lines(started).join('\n')).toContain('[TRANSPORT]')
    expect(lines(started).join('\n')).not.toContain('backoff')
    const repeated = foldTranscript(state, retry(2, 2))
    expect(repeated.nodes).toHaveLength(1)
    expect(repeated.nodes[0]).toMatchObject({ status: 'waiting', retry: { attempt: 2 } })
  })

  it('displays terminal errors even without timing or a preceding retry, and never leaves a closed turn waiting', () => {
    const end = event(2, 'turn/end', { turn: 1, reason: { kind: 'error', error: failure } })
    const events = [retry(0, 5), event(1, 'step/end', { turn: 1, step: 1 }), end]
    const state = foldEvents(events)
    expect(state.nodes).toMatchObject([{ activity: 'retry', status: 'error' }, { activity: 'error', status: 'error', failure }])
    const output = lines(events).join('\n')
    expect(output).toContain('Retry 5/5 · failed')
    expect(output).toContain('Turn failed')
    expect(output).toContain('Check the network/proxy')
    expect(output).not.toContain('waiting')
    expect(lines([event(0, end.type, end.data)]).join('\n')).toContain('[TRANSPORT]')
  })

  it('settles recovered retries and cancellation independently across steps and turns', () => {
    const recovered = [retry(0), event(1, 'assistant/message', {
      turn: 1, step: 1, message: { source: { kind: 'model' }, content: [{ type: 'text', text: 'OK' }] },
    }), event(2, 'turn/end', { turn: 1, reason: { kind: 'error', error: { message: 'A later step failed', code: 'SERVER' } } })]
    expect(foldEvents(recovered).nodes[0]).toMatchObject({ status: 'success' })
    expect(lines(recovered).join('\n')).toContain('recovered')
    const cancelled = [retry(0), event(1, 'turn/end', { turn: 1, reason: { kind: 'aborted' } })]
    expect(lines(cancelled).join('\n')).toContain('Retry 1/5 · cancelled')
    expect(foldEvents(cancelled).nodes).toHaveLength(1)
  })

  it('redacts credentials and URL secrets from failure display and respects CJK terminal widths', () => {
    const events = [event(0, 'turn/end', { turn: 1, reason: { kind: 'error', error: {
      code: 'TRANSPORT', status: 502,
      message: `连接失败 中文🐋 ${'长文本'.repeat(40)} https://alice:private@example.test/api?token=hidden Authorization: Bearer abcdefghijklmnop sk-privatevalue12345`,
    } } })]
    for (const width of [36, 76, 116]) {
      const rendered = lines(events, width)
      for (const line of rendered) expect(stringWidth(line)).toBeLessThanOrEqual(width)
      const text = rendered.join('\n')
      expect(text).not.toContain('private')
      expect(text).not.toContain('abcdefghijklmnop')
      expect(text).not.toContain('hidden')
      expect(text).toContain('HTTP 502')
    }
  })
})

describe('producer-declared internal context', () => {
  const prompt = '请修改我的材料与化工报告。'
  const body = '<system-reminder>\nINTERNAL_SKILL_BODY\n' + '技能说明 '.repeat(400) + '\n</system-reminder>'
  const events = [
    event(0, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: prompt }] }),
    event(1, 'user/message', { source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', form: 'snapshot', sections: [] }, content: [{ type: 'text', text: 'RUNTIME_CONTEXT_BODY' }] }),
    event(2, 'user/message', { source: { kind: 'skill-catalog', form: 'catalog', entries: [{ name: 'writer' }] }, content: [{ type: 'text', text: body }] }),
    retry(3, 5),
    event(4, 'turn/end', { turn: 1, reason: { kind: 'error', error: failure } }),
  ]

  it('folds internal content by metadata and exposes unchanged text through the existing keyboard/copy block', () => {
    const state = foldEvents(events)
    const collapsed = lines(events).join('\n')
    expect(collapsed).toContain(prompt)
    expect(collapsed).toContain('Runtime context · 0 sections')
    expect(collapsed).toContain('Skill catalog · 1 skills')
    expect(collapsed).not.toContain('INTERNAL_SKILL_BODY')
    expect(collapsed).not.toContain('RUNTIME_CONTEXT_BODY')
    const block = focusableBlocks(state).find(item => item.label.startsWith('Skill catalog'))!
    expect(block.text).toBe(body)
    expect(lines(events, 76, new Set([block.key])).join('\n')).toContain('INTERNAL_SKILL_BODY')
    const quoted = event(0, 'user/message', { source: { kind: 'user', form: 'catalog' }, content: [{ type: 'text', text: '<system-reminder>human quote</system-reminder>' }] })
    expect(foldEvents([quoted]).nodes[0]).not.toHaveProperty('contextLabel')
    expect(lines([quoted]).join('\n')).toContain('human quote')
  })

  it.each([80, 120])('keeps the human prompt and final error visible at %i columns', columns => {
    const frame = renderToString(<Shell theme="abyss" color="mono" store={new TranscriptStore(foldEvents(events))} />, { columns })
      .replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
    expect(frame).toContain(prompt)
    expect(frame).toContain('Turn failed')
    expect(frame).not.toContain('INTERNAL_SKILL_BODY')
    for (const line of frame.split('\n')) expect(stringWidth(line)).toBeLessThanOrEqual(columns)
  })
})
