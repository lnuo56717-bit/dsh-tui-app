import { existsSync, writeFileSync } from 'node:fs'

export const name = 'dsh-tui-ac4-driver'
let started = false

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

export function apply(ctx) {
  ctx.on('agent/created', ({ agent }) => {
    if (started) return
    started = true
    void (async () => {
      await pause(250)
      const mode = process.env.DSH_TUI_AC4_CASE
      const target = process.env.DSH_TUI_AC4_TARGET
      const auditPath = process.env.DSH_TUI_AC4_AUDIT
      if (!mode || !target || !auditPath) throw new Error('AC-4 environment is incomplete')
      const session = agent.session
      const content = 'approval allowed once\n'
      session.append('turn/start', { turn: 1 })
      session.append('step/start', { turn: 1, step: 1 })
      session.append('tool/call', {
        turn: 1, step: 1, callId: `ac4-${mode}`, name: 'bash',
        arguments: JSON.stringify({ command: `write ${target}` }),
      })
      const approval = ctx.get('approval')
      if (!approval) throw new Error('approval service is unavailable')
      const outcome = await approval.request({
        agent, toolName: 'bash', callId: `ac4-${mode}`,
        reason: `AC-4 ${mode}: write one fixture file`,
      })
      if (outcome === 'allowed-once') writeFileSync(target, content, 'utf8')
      session.append('tool/result', {
        turn: 1, step: 1,
        message: {
          id: `ac4-result-${mode}`, role: 'user', source: { kind: 'tool', callId: `ac4-${mode}` },
          content: [{ type: 'tool-result', toolCallId: `ac4-${mode}`, isError: outcome !== 'allowed-once', content: [{ type: 'text', text: outcome }] }],
        },
      }, { surfaceOp: 'append' })
      session.append('step/end', { turn: 1, step: 1 })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      const approvalEvents = session.events.filter(event => event.type === 'approval/asked' || event.type === 'approval/decided')
      writeFileSync(auditPath, JSON.stringify({
        mode, outcome, targetExists: existsSync(target),
        approvalEvents: approvalEvents.map(event => ({ type: event.type, data: event.data })),
      }, null, 2) + '\n', 'utf8')
    })().catch(error => process.stderr.write(`ac4-driver: ${error instanceof Error ? error.stack : String(error)}\n`))
  })
}
