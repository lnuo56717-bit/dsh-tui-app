import { writeFileSync } from 'node:fs'

export const name = 'dsh-tui-ac5-driver'
let initialized = false
let resumedAgent

function textOf(message) {
  return (message?.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('')
}

export function apply(ctx) {
  const phase = process.env.DSH_TUI_AC5_PHASE
  const idPath = process.env.DSH_TUI_AC5_ID
  const resumePath = process.env.DSH_TUI_AC5_RESUME
  const followupPath = process.env.DSH_TUI_AC5_FOLLOWUP
  if (!phase || !idPath || !resumePath || !followupPath) throw new Error('AC-5 environment is incomplete')

  ctx.on('agent/session-start', ({ agent, source }) => {
    if (initialized) return
    initialized = true
    if (phase === 'seed' && source === 'startup') {
      const session = agent.session
      session.append('turn/start', { turn: 1 })
      session.append('step/start', { turn: 1, step: 1 })
      session.append('user/message', {
        id: 'ac5-user', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: '请保存这段会话历史。' }],
      }, { surfaceOp: 'append' })
      session.append('assistant/message', {
        turn: 1, step: 1,
        message: {
          id: 'ac5-assistant', role: 'assistant', source: { kind: 'model', provider: 'ac5', model: 'fixture' },
          content: [{ type: 'text', text: '已保存的鲸鱼历史：deep sea 🐋' }],
        },
      }, { surfaceOp: 'append', sourceEventSeqs: [] })
      session.append('step/end', { turn: 1, step: 1 })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      writeFileSync(idPath, JSON.stringify({ sessionId: String(session.id), eventCount: session.events.length }) + '\n', 'utf8')
    } else if (phase === 'resume' && source === 'resume') {
      resumedAgent = agent
      const text = agent.session.events.map(event => event.type === 'user/message' ? textOf(event.data) : event.type === 'assistant/message' ? textOf(event.data.message) : '').join('\n')
      writeFileSync(resumePath, JSON.stringify({
        sessionId: String(agent.session.id), eventCount: agent.session.events.length,
        historyObserved: text.includes('已保存的鲸鱼历史：deep sea 🐋'), source,
      }) + '\n', 'utf8')
    }
  })

  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    if (phase !== 'resume' || agent !== resumedAgent) return
    writeFileSync(followupPath, JSON.stringify({
      sessionId: String(agent.id), text: textOf(message), source: message.source,
    }) + '\n', 'utf8')
  })

  ctx.on('agent/pre-step', async ({ agent }, next) => {
    if (phase === 'resume' && agent === resumedAgent) return { kind: 'reject' }
    return next()
  })
}
