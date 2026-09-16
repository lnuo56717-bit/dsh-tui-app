import { writeFileSync } from 'node:fs'

export const name = 'dsh-tui-ac3-driver'
let started = false

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

export function apply(ctx) {
  const begin = ({ agent }) => {
    if (started) return
    started = true
    void (async () => {
      await pause(250)
      const session = agent.session
      const target = process.env.DSH_TUI_AC3_TARGET
      if (!target) throw new Error('DSH_TUI_AC3_TARGET is required')
      const content = '深海工具写入成功，whale 🐋\n'

      session.append('turn/start', { turn: 1 })
      session.append('step/start', { turn: 1, step: 1 })
      session.append('user/message', {
        id: 'ac3-user', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: '请把指定的中英混排内容写入目标文件。' }],
      }, { surfaceOp: 'append' })
      await pause(80)
      const attempt1 = 'ac3-attempt-1'
      let index = 0
      const stream1 = []
      agent.ctx.emit('agent/assistant-stream', { agent, frame: { type: 'start', attemptId: attempt1, revision: 1, turn: 1, step: 1 } })
      const emit1 = chunk => {
        const time = Date.now()
        stream1.push({ type: 'chunk', time, chunk })
        agent.ctx.emit('agent/assistant-stream', { agent, frame: { type: 'chunk', attemptId: attempt1, revision: 1, index: index++, time, chunk } })
      }
      emit1({ type: 'block-start', index: 0, blockType: 'text' })
      await pause(80)
      emit1({ type: 'text-delta', index: 0, text: '正在准备' })
      await pause(100)
      emit1({ type: 'text-delta', index: 0, text: '写入文件…' })
      await pause(100)
      const settled1 = session.append('assistant/message', {
        turn: 1, step: 1,
        message: {
          id: 'ac3-assistant-1', role: 'assistant',
          source: { kind: 'model', provider: 'ac3', model: 'fixture' },
          content: [{ type: 'text', text: '正在准备写入文件…' }],
        },
        stream: stream1,
      }, { surfaceOp: 'append' })
      agent.ctx.emit('agent/assistant-stream', { agent, frame: { type: 'end', attemptId: attempt1, revision: 1, index, outcome: { kind: 'committed', eventType: 'assistant/message', seq: settled1.seq } } })
      const call = session.append('tool/call', {
        turn: 1, step: 1, callId: 'ac3-write', name: 'write_file',
        arguments: JSON.stringify({ path: target, content }),
      })
      await pause(120)
      writeFileSync(target, content, 'utf8')
      session.append('tool/result', {
        turn: 1, step: 1,
        message: {
          id: 'ac3-tool-result', role: 'user', source: { kind: 'tool', callId: 'ac3-write' },
          content: [{ type: 'tool-result', toolCallId: 'ac3-write', content: [{ type: 'text', text: 'wrote 1 file' }] }],
        },
        meta: { diff: `--- /dev/null\n+++ ${target}\n@@ -0,0 +1 @@\n+${content.trimEnd()}` },
      }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
      session.append('step/end', { turn: 1, step: 1 })
      session.append('step/start', { turn: 1, step: 2 })
      const attempt2 = 'ac3-attempt-2'
      const finalTime = Date.now()
      const finalDelta = { type: 'text-delta', index: 0, text: '任务完成：文件已写入。' }
      agent.ctx.emit('agent/assistant-stream', { agent, frame: { type: 'start', attemptId: attempt2, revision: 2, turn: 1, step: 2 } })
      agent.ctx.emit('agent/assistant-stream', { agent, frame: { type: 'chunk', attemptId: attempt2, revision: 2, index: 0, time: finalTime, chunk: finalDelta } })
      await pause(100)
      const settled2 = session.append('assistant/message', {
        turn: 1, step: 2,
        message: {
          id: 'ac3-assistant-2', role: 'assistant',
          source: { kind: 'model', provider: 'ac3', model: 'fixture' },
          content: [{ type: 'text', text: '任务完成：文件已写入。' }],
        },
        stream: [{ type: 'chunk', time: finalTime, chunk: finalDelta }],
      }, { surfaceOp: 'append' })
      agent.ctx.emit('agent/assistant-stream', { agent, frame: { type: 'end', attemptId: attempt2, revision: 2, index: 1, outcome: { kind: 'committed', eventType: 'assistant/message', seq: settled2.seq } } })
      session.append('step/end', { turn: 1, step: 2 })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    })().catch(error => {
      process.stderr.write(`ac3-driver: ${error instanceof Error ? error.stack : String(error)}\n`)
    })
  }
  ctx.on('agent/created', begin)
  ctx.on('agent/session-start', begin)
}
