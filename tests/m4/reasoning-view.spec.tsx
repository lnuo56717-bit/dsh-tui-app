import React from 'react'
import { renderToString } from 'ink'
import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import { foldEvents, type EventLike } from '../../src/transcript-fold.js'
import { TranscriptStore } from '../../src/transcript-store.js'
import { Shell } from '../../src/ui/app.js'
import { presentReasoning } from '../../src/ui/reasoning-view.js'

const ansi = /\u001B\[[0-?]*[ -/]*[@-~]/gu

function frame(events: readonly EventLike[]): string {
  return renderToString(
    <Shell theme="abyss" color="mono" store={new TranscriptStore(foldEvents(events))} sessionId="reasoning-session" />,
    { columns: 120 },
  ).replace(ansi, '')
}

describe('Grok-style reasoning disclosure backed by dsh reasoning blocks', () => {
  it('shows a live truncated tail while running and keeps earlier reasoning off-screen', () => {
    const output = frame([
      { seq: 0, type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } } },
      { seq: 1, type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: '先检查中文路径\n核对会话投影\n读取压缩上下文\n\n' } } },
      { seq: 2, type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: '正在核对最新证据 🐋' } } },
    ])
    const row = output.split('\n').find(line => line.includes('Thinking'))
    expect(row).toBeDefined()
    expect(row).toContain('正在核对最新证据 🐋')
    expect(row).not.toContain('先检查中文路径')
    expect(output).toContain('正在核对最新证据 🐋')
    expect(output).toContain('读取压缩上下文')
    expect(output).not.toMatch(/^\s*先检查中文路径\s*$/mu)
  })

  it('returns to the first non-empty line when settled and does not expose the full body until expanded', () => {
    const output = frame([{
      seq: 0,
      type: 'assistant/message',
      surfaceOp: 'append',
      data: {
        turn: 1,
        step: 1,
        message: {
          role: 'assistant',
          source: { kind: 'model' },
          content: [{ type: 'reasoning', text: '\n先检查会话投影\n然后验证压缩后的上下文\n最后核对中文宽度' }],
        },
      },
    }])
    const row = output.split('\n').find(line => line.includes('Thought'))
    expect(row).toBeDefined()
    expect(row).toContain('先检查会话投影')
    expect(row).not.toContain('然后验证压缩后的上下文')
    expect(output).not.toMatch(/^\s*然后验证压缩后的上下文\s*$/mu)
  })

  it('stops saying Thinking as soon as the Harness closes the reasoning block', () => {
    const output = frame([
      { seq: 0, type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } } },
      { seq: 1, type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: '已经形成判断' } } },
      { seq: 2, type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'block-end', index: 0, block: { type: 'reasoning', text: '已经形成判断' } } } },
      { seq: 3, type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 1, text: '正在输出回答' } } },
    ])
    expect(output).toContain('Thought · 已经形成判断')
    expect(output).not.toContain('Thinking · 已经形成判断')
  })

  it('models collapsed, bounded expanded, and independently scrollable detail windows without changing the text', () => {
    const text = '第一行：检查模型\n第二行：读取上下文\n第三行：验证工具结果\n第四行：形成结论'

    expect(presentReasoning(text, {
      running: false, width: 28, mode: 'collapsed', offset: 0, rows: 2,
    })).toEqual({
      summary: '第一行：检查模型', body: [], totalRows: 4, hasBefore: false, hasAfter: true,
    })

    expect(presentReasoning(text, {
      running: true, width: 28, mode: 'expanded', offset: 0, rows: 2,
    })).toEqual({
      summary: '第四行：形成结论',
      body: ['第一行：检查模型', '第二行：读取上下文'],
      totalRows: 4,
      hasBefore: false,
      hasAfter: true,
    })

    expect(presentReasoning(text, {
      running: false, width: 28, mode: 'detail', offset: 1, rows: 2,
    })).toEqual({
      summary: '第一行：检查模型',
      body: ['第二行：读取上下文', '第三行：验证工具结果'],
      totalRows: 4,
      hasBefore: true,
      hasAfter: true,
    })
  })

  it('wraps CJK, emoji, and combining marks by display cells in the detail view', () => {
    const view = presentReasoning('中文推理路径🐋与Cafe\u0301证据需要安全换行', {
      running: false, width: 12, mode: 'detail', offset: 0, rows: 20,
    })
    expect(view.body.length).toBeGreaterThan(1)
    for (const line of view.body) {
      expect(stringWidth(line)).toBeLessThanOrEqual(12)
      expect(line).not.toContain('\uFFFD')
    }
  })
})
