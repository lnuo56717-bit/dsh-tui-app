import { existsSync, writeFileSync } from 'node:fs'
import { SessionId } from '@deepseek-ai/dsh-session'

export const name = 'dsh-tui-browser-driver'
export const inject = ['agents', 'tools', 'tuiBrowserControl']

let started = false
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const prefix = 'mcp__playwright-mcp__'

async function waitFor(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = predicate()
    if (value) return value
    await pause(50)
  }
  throw new Error(message)
}

function compactResult(result) {
  const content = Array.isArray(result?.content) ? result.content : []
  return {
    isError: result?.isError === true,
    error: result?.error === undefined ? undefined : {
      name: result.error.name, code: result.error.code, message: result.error.message,
    },
    contentTypes: content.map(item => item?.type),
    text: content.filter(item => item?.type === 'text').map(item => String(item.text ?? '')).join('\n').slice(0, 4_000),
    hasImage: content.some(item => item?.type === 'image' || item?.type === 'image-ref' || item?.mimeType?.startsWith?.('image/')),
  }
}

function errorChain(error) {
  const parts = []
  const seen = new Set()
  for (let current = error; current !== undefined && current !== null && !seen.has(current); current = current.cause) {
    seen.add(current)
    parts.push(current instanceof Error ? `${current.name}: ${current.message}` : String(current))
  }
  return parts.join(' <- ')
}

export function apply(ctx) {
  const startPath = process.env.DSH_TUI_BROWSER_START
  const auditPath = process.env.DSH_TUI_BROWSER_AUDIT
  const fixtureUrl = process.env.DSH_TUI_BROWSER_FIXTURE_URL
  if (!startPath || !auditPath || !fixtureUrl) throw new Error('browser driver environment is incomplete')

  ctx.on('agent/created', ({ agent }) => {
    if (started) return
    started = true
    void (async () => {
      await waitFor(() => existsSync(startPath), 60_000, 'Browser Center did not signal the probe to start')
      const scoped = agent.ctx.get('tools') ?? ctx.tools
      const names = await waitFor(() => {
        const current = scoped.schemas(agent).map(schema => schema.name)
        return current.includes(`${prefix}browser_snapshot`) ? current : undefined
      }, 60_000, 'Playwright MCP tools were not registered for the Lead Session')

      // This verification driver stands in for one model step. ApprovalService
      // deliberately refuses audit events between turns, so keep every probe in
      // one explicit turn just as the real Agent loop does for model tool calls.
      const priorTurns = []
      for (let seq = 0; seq < agent.session.seq; seq += 1) {
        const event = agent.session.eventAt(seq)
        if (event?.type === 'turn/start' && Number.isSafeInteger(event.data?.turn)) priorTurns.push(event.data.turn)
      }
      const turn = Math.max(0, ...priorTurns) + 1
      agent.session.append('turn/start', { turn })

      let serial = 0
      const execute = (label, browserName, args) => scoped.execute({
        callId: `browser-gate-${label}`,
        name: `${prefix}${browserName}`,
        arguments: args,
        agent,
        signal: new AbortController().signal,
      })
      const run = async (label, browserName, args) => {
        serial += 1
        const result = await execute(label, browserName, args)
        return { serial, label, ...compactResult(result) }
      }

      // Start an approved navigation, then pause after its durable ask record but
      // before the operator answers. The monotonic guard must still stop it.
      let earlyResult
      const pausedPromise = execute('paused-nav', 'browser_navigate', { url: fixtureUrl }).then(result => {
        earlyResult = result
        return result
      })
      const asked = await waitFor(() => {
        for (let seq = agent.session.seq - 1; seq >= 0; seq -= 1) {
          const event = agent.session.eventAt(seq)
          if (event?.type === 'approval/asked' && event.data?.callId === 'browser-gate-paused-nav') return true
        }
        return earlyResult === undefined ? false : 'settled'
      }, 20_000, 'paused navigation never reached approval')
      if (asked === 'settled') throw new Error(`paused navigation settled before approval: ${JSON.stringify(compactResult(earlyResult))}`)
      ctx.tuiBrowserControl.setPaused(agent, true)
      const pausedNavigation = { serial: ++serial, label: 'paused-nav', ...compactResult(await pausedPromise) }
      ctx.tuiBrowserControl.setPaused(agent, false)

      const results = [
        pausedNavigation,
        await run('navigate', 'browser_navigate', { url: fixtureUrl }),
        await run('snapshot-initial', 'browser_snapshot', {}),
      ]

      // The official provider is Session-owned. A second live child Agent must
      // start at about:blank while the Lead keeps its fixture page, and disposing
      // that handle must tear down only the child's MCP/browser process.
      const header = agent.session.requestHeader?.()
      const childSessionId = SessionId(`session-browser-isolation-${Date.now()}`)
      const childAgentOptions = header?.config === undefined ? undefined : {
        provider: header.config.provider, model: header.config.model,
      }
      const childHandle = await ctx.agents.create({
        sessionId: childSessionId,
        parentAgent: agent,
        meta: {
          cwd: process.cwd(), parentSession: agent.session.id, origin: 'subagent', delegationDepth: 1,
        },
        agentOptions: childAgentOptions,
      })
      try {
        const childTools = childHandle.agent.ctx.get('tools') ?? ctx.tools
        await waitFor(() => childTools.schemas(childHandle.agent).some(schema => schema.name === `${prefix}browser_snapshot`), 30_000, 'child browser tools unavailable')
        results.push({
          serial: ++serial,
          label: 'child-snapshot',
          ...compactResult(await childTools.execute({
            callId: 'browser-gate-child-snapshot', name: `${prefix}browser_snapshot`, arguments: {},
            agent: childHandle.agent, signal: new AbortController().signal,
          })),
        })
        results.push(await run('lead-after-child', 'browser_snapshot', {}))
      } finally {
        await childHandle.dispose()
      }

      const resumedChild = await ctx.agents.resume({
        resumeSessionId: childSessionId,
        parentAgent: agent,
        agentOptions: childAgentOptions,
      })
      try {
        const stateBeforeCall = ctx.tuiBrowserControl.state(resumedChild.agent)
        const resumedTools = resumedChild.agent.ctx.get('tools') ?? ctx.tools
        await waitFor(() => resumedTools.schemas(resumedChild.agent).some(schema => schema.name === `${prefix}browser_snapshot`), 30_000, 'resumed child browser tools unavailable')
        results.push({
          serial: ++serial,
          label: 'resumed-child-snapshot',
          cleanStateBeforeCall: stateBeforeCall.activity.length === 0 && stateBeforeCall.activeCalls === 0 && stateBeforeCall.paused === false,
          ...compactResult(await resumedTools.execute({
            callId: 'browser-gate-resumed-child-snapshot', name: `${prefix}browser_snapshot`, arguments: {},
            agent: resumedChild.agent, signal: new AbortController().signal,
          })),
        })
      } finally {
        await resumedChild.dispose()
      }

      results.push(
        await run('click-reject', 'browser_click', { element: 'Change status button', target: '#action' }),
        await run('snapshot-after-reject', 'browser_snapshot', {}),
        await run('click-allow', 'browser_click', { element: 'Change status button', target: '#action' }),
        await run('snapshot-after-click', 'browser_snapshot', {}),
        await run('type-normal', 'browser_type', { element: 'Public note', target: '#normal', text: 'safe-visible-value' }),
        await run('snapshot-after-type', 'browser_snapshot', {}),
        await run('type-sensitive', 'browser_type', { element: 'Password', target: '#password', text: 'must-never-reach-browser' }),
        await run('snapshot-after-sensitive', 'browser_snapshot', {}),
        await run('screenshot', 'browser_take_screenshot', { scale: 'css' }),
        await run('unsafe', 'browser_run_code_unsafe', { code: 'async page => page.url()' }),
      )

      writeFileSync(auditPath, `${JSON.stringify({
        toolCount: names.filter(name => name.startsWith(prefix)).length,
        exactTools: names.filter(name => name.startsWith(prefix)).sort(),
        runtime: ctx.tuiBrowserControl.runtime(),
        state: ctx.tuiBrowserControl.state(agent),
        results,
      }, null, 2)}\n`, 'utf8')
      agent.session.append('turn/end', { turn, reason: { kind: 'completed' } })
    })().catch(error => {
      const detail = `${errorChain(error)}\n${error instanceof Error ? error.stack ?? '' : ''}`
      writeFileSync(auditPath, `${JSON.stringify({ error: detail }, null, 2)}\n`, 'utf8')
      process.stderr.write(`browser-driver: ${detail}\n`)
    })
  })
}
