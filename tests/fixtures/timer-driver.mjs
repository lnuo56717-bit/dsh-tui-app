import { writeFileSync } from 'node:fs'

/**
 * Verification-only driver for the elapsed-time chip. It writes real turn
 * brackets through the real session (so the timestamps are the log's own, not
 * the fixture's) and announces the matching `agent/status` transitions the
 * agent loop would announce, which lets the chip be observed live without
 * spending a model call. Test-only: nothing here ships in the bundle.
 */
export const name = 'dsh-tui-timer-driver'

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

function text(value) {
  return { id: `timer-${value}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: value }] }
}

export function apply(ctx) {
  const auditPath = process.env.DSH_TUI_TIMER_AUDIT
  if (!auditPath) throw new Error('DSH_TUI_TIMER_AUDIT is not set')
  let started = false

  ctx.on('agent/session-start', ({ agent, source }) => {
    if (started || source !== 'startup') return
    started = true
    const session = agent.session
    const spans = []

    const runTurn = async (turn, holdMs, prompt, reply) => {
      const start = session.append('turn/start', { turn })
      agent.ctx.emit('agent/status', { agent, status: 'running' })
      await wait(holdMs)
      session.append('step/start', { turn, step: 1 })
      session.append('user/message', text(prompt), { surfaceOp: 'append' })
      session.append('assistant/message', {
        turn,
        step: 1,
        message: {
          id: `timer-reply-${turn}`, role: 'assistant', source: { kind: 'model', provider: 'timer', model: 'fixture' },
          content: [{ type: 'text', text: reply }],
        },
      }, { surfaceOp: 'append', sourceEventSeqs: [] })
      session.append('step/end', { turn, step: 1 })
      const end = session.append('turn/end', { turn, reason: { kind: 'completed' } })
      agent.ctx.emit('agent/status', { agent, status: 'idle' })
      spans.push({ turn, startedAt: start?.time, endedAt: end?.time, spanMs: (end?.time ?? 0) - (start?.time ?? 0) })
    }

    void (async () => {
      try {
        await runTurn(1, 2_400, '第一次任务：计时器起步', '第一段任务完成。')
        await wait(1_200)
        await runTurn(2, 4_300, '第二次任务：观察对话总耗时', '第二段任务完成。')
        writeFileSync(auditPath, `${JSON.stringify({ sessionId: String(session.id), spans })}\n`, 'utf8')
      } catch (error) {
        writeFileSync(auditPath, `${JSON.stringify({ error: String(error?.stack ?? error) })}\n`, 'utf8')
      }
    })()
  })
}
