import React from 'react'
import { renderToString } from 'ink'
import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import { foldEvents, type EventLike } from '../../src/transcript-fold.js'
import { TranscriptStore } from '../../src/transcript-store.js'
import { Shell } from '../../src/ui/app.js'

const ansi = /\u001B\[[0-?]*[ -/]*[@-~]/g

describe('M2 transcript presentation', () => {
  it('renders Markdown and compact tool/workflow/raw summaries within terminal width', () => {
    const events: EventLike[] = [
      { seq: 0, type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, message: { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: '# 结果\n\n中文 **bold** 和 `code`' }] } } },
      { seq: 1, type: 'tool/call', data: { callId: 'write-1', name: 'write_file', arguments: '{"path":"鲸鱼.txt"}' } },
      { seq: 2, type: 'tool/result', surfaceOp: 'append', data: { message: { content: [{ type: 'tool-result', toolCallId: 'write-1', content: [{ type: 'text', text: 'done' }] }] }, meta: { diff: '@@ -0,0 +1 @@\n+深海 whale 🐋' } } },
      { seq: 3, type: 'tool-workflow/run-start', data: { runId: 'run-1', name: 'review' } },
      { seq: 4, type: 'tool-workflow/agent-start', data: { runId: 'run-1', seq: 0, label: '审查', childId: 'child-1' } },
      { seq: 5, type: 'future/event', data: { kept: true }, ignorable: true },
    ]
    const frame = renderToString(<Shell theme="abyss" color="mono" store={new TranscriptStore(foldEvents(events))} sessionId="session-render" />, { columns: 120 })
    const plain = frame.replace(ansi, '')
    expect(plain).toContain('# 结果')
    expect(plain).toContain('write_file')
    expect(plain).not.toContain('+深海 whale 🐋')
    expect(plain).toContain('workflow  review')
    expect(plain).toContain('raw event #5 · future/event')
    for (const line of plain.split('\n')) expect(stringWidth(line)).toBeLessThanOrEqual(120)
  })
})
