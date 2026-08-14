import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToString } from 'ink'
import stringWidth from 'string-width'
import { foldEvents } from '../lib/transcript-fold.js'
import { TranscriptStore } from '../lib/transcript-store.js'
import { Shell } from '../lib/ui/app.js'
import { cursorCell, displayWidth, middleEllipsis, takeCells } from '../lib/ui/display-width.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const results = join(root, '.m4-results')
mkdirSync(results, { recursive: true })
const events = [
  { seq: 0, type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, message: { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: '中文 CJK，ＡＢ。\nCafe\u0301 与鲸鱼 🐋 保持完整。' }] } } },
  { seq: 1, type: 'tool/call', data: { callId: 'write-1', name: 'write_file', arguments: '{"path":"中文目录/鲸鱼.txt"}' } },
  { seq: 2, type: 'tool/result', surfaceOp: 'append', data: { message: { content: [{ type: 'tool-result', toolCallId: 'write-1', content: [{ type: 'text', text: 'done' }] }] }, meta: { diff: '@@ -0,0 +1 @@\n+完整中文' } } },
]
const runtime = {
  sessionId: 'session-cjk-actual', cwd: 'C:\\项目\\深海工作区', model: 'deepseek/chat', agentStatus: 'idle', permission: 'workspace-write',
  theme: 'abyss', notice: undefined, error: undefined, approval: undefined, questions: undefined,
  projection: { asOfSeq: 2, values: { title: '中文鲸鱼修复会话', permissions: { currentValue: 'workspace-write', options: [] }, contextPressure: { projectedTokens: 18000, contextWindow: 128000 } } },
}
const controller = { transcript: new TranscriptStore(foldEvents(events)), subscribe: () => () => {}, getSnapshot: () => runtime }
const ansi = /\u001B\[[0-?]*[ -/]*[@-~]/gu
const frame = renderToString(React.createElement(Shell, { theme: 'abyss', color: 'mono', controller }), { columns: 80 }).replace(ansi, '')
const lines = frame.split('\n')
const fixture = '中文 CJK，ＡＢ。'
const clipped = takeCells(fixture, 8)
const report = {
  dimensions: { columns: 80, rows: lines.length },
  fixtureWidth: displayWidth(fixture),
  wrapParts: [clipped.head, clipped.tail],
  allLinesFit: lines.every(line => stringWidth(line) <= 80),
  noReplacementGlyph: !frame.includes('\uFFFD'),
  compactHeader: frame.includes('dsh-tui · 中文鲸鱼修复会话'),
  compactToolSummary: frame.includes('write_file') && !frame.includes('+完整中文'),
  cursorCells: cursorCell('A中文🐋e\u0301Z', 4),
  ellipsisFits: stringWidth(middleEllipsis('C:\\项目\\深海工作区\\超长目录', 16)) <= 16,
}
writeFileSync(join(results, 'ac6.json'), JSON.stringify(report, null, 2) + '\n')
const failed = report.fixtureWidth !== 16 || !report.allLinesFit || !report.noReplacementGlyph || !report.compactHeader || !report.compactToolSummary || report.cursorCells !== 7 || !report.ellipsisFits
if (failed) {
  console.error(JSON.stringify(report, null, 2))
  process.exit(1)
}
console.log(JSON.stringify(report, null, 2))
