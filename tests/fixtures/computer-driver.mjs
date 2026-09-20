import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { SessionId } from '@deepseek-ai/dsh-session'

export const name = 'dsh-tui-computer-driver'
export const inject = ['agents', 'tools', 'tuiComputerControl']

const prefix = 'mcp__cua-driver-mcp__'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
let started = false

async function waitFor(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await predicate()
    if (value) return value
    await pause(50)
  }
  throw new Error(message)
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

function textOf(result) {
  return (Array.isArray(result?.content) ? result.content : [])
    .filter(item => item?.type === 'text')
    .map(item => String(item.text ?? ''))
    .join('\n')
}

function compactResult(result) {
  const content = Array.isArray(result?.content) ? result.content : []
  const text = textOf(result)
  return {
    isError: result?.isError === true,
    error: result?.error === undefined ? undefined : {
      name: result.error.name, code: result.error.code, message: result.error.message,
    },
    contentTypes: content.map(item => item?.type),
    text: text.slice(0, 2_000),
    hasImage: content.some(item => item?.type === 'image' || item?.type === 'image-ref' || item?.mimeType?.startsWith?.('image/')),
  }
}

function materialize(result) {
  const roots = [result, result?.structuredContent]
  for (const item of Array.isArray(result?.content) ? result.content : []) {
    roots.push(item, item?.structuredContent)
    if (item?.type === 'text') {
      try { roots.push(JSON.parse(String(item.text ?? ''))) } catch {}
    }
  }
  return roots.filter(value => value !== undefined)
}

function objectsBelow(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return []
  seen.add(value)
  const items = [value]
  for (const child of Array.isArray(value) ? value : Object.values(value)) items.push(...objectsBelow(child, seen))
  return items
}

function allObjects(result) {
  return materialize(result).flatMap(root => objectsBelow(root))
}

function approvalCount(agent) {
  let count = 0
  for (let seq = 0; seq < agent.session.seq; seq += 1) {
    if (agent.session.eventAt(seq)?.type === 'approval/asked') count += 1
  }
  return count
}

function priorTurn(agent) {
  let maximum = -1
  for (let seq = 0; seq < agent.session.seq; seq += 1) {
    const event = agent.session.eventAt(seq)
    if (event?.type === 'turn/start' && Number.isSafeInteger(event.data?.turn)) maximum = Math.max(maximum, event.data.turn)
  }
  return maximum
}

function findWindow(result, pid, title) {
  return allObjects(result).find(value => Number(value?.pid) === pid && Number.isSafeInteger(Number(value?.window_id))
    && (title === undefined || String(value?.title ?? value?.window_title ?? '').includes(title)))
}

function findElement(result, phrase) {
  const lower = phrase.toLowerCase()
  return allObjects(result).find(value => typeof value?.element_token === 'string'
    && JSON.stringify(value).toLowerCase().includes(lower))
}

function findBrowserBinding(result) {
  const objects = allObjects(result)
  const target = objects.find(value => typeof value?.target_id === 'string' && (typeof value?.tab_id === 'string' || Array.isArray(value?.tabs)))
  const tab = typeof target?.tab_id === 'string'
    ? target.tab_id
    : objects.find(value => typeof value?.tab_id === 'string')?.tab_id
  return typeof target?.target_id === 'string' && typeof tab === 'string'
    ? { targetId: target.target_id, tabId: tab }
    : undefined
}

function refusalCode(result) {
  return allObjects(result).find(value => typeof value?.code === 'string' && String(value.code).includes('browser_'))?.code
}

export function apply(ctx) {
  const startPath = process.env.DSH_TUI_COMPUTER_START
  const auditPath = process.env.DSH_TUI_COMPUTER_AUDIT
  const fixtureReadyPath = process.env.DSH_TUI_COMPUTER_FIXTURE_READY
  const fixtureResultPath = process.env.DSH_TUI_COMPUTER_FIXTURE_RESULT
  const fixtureUrl = process.env.DSH_TUI_COMPUTER_FIXTURE_URL
  const existingBrowserPid = Number(process.env.DSH_TUI_COMPUTER_EXISTING_BROWSER_PID)
  if (!startPath || !auditPath || !fixtureReadyPath || !fixtureResultPath || !fixtureUrl) {
    throw new Error('computer driver environment is incomplete')
  }

  ctx.on('agent/created', ({ agent }) => {
    if (started) return
    started = true
    void (async () => {
      const scoped = agent.ctx.get('tools') ?? ctx.tools
      const beforeNames = scoped.schemas(agent).map(schema => schema.name)
      await waitFor(() => existsSync(startPath), 90_000, 'Computer Center did not signal the probe to start')
      const fixture = JSON.parse(readFileSync(fixtureReadyPath, 'utf8'))
      await waitFor(() => ctx.tuiComputerControl.state(agent).phase === 'pending', 60_000, 'Lead computer lease did not enter pending')

      const turn = priorTurn(agent) + 1
      agent.session.append('turn/start', { turn })
      await waitFor(() => ctx.tuiComputerControl.state(agent).phase === 'active', 10_000, 'Lead computer lease did not enter active')
      const names = scoped.schemas(agent).map(schema => schema.name)
      const cuaNames = names.filter(name => name.startsWith(prefix)).sort()
      const approvalsBefore = approvalCount(agent)
      let serial = 0
      const raw = new Map()
      const execute = (label, name, args) => scoped.execute({
        callId: `computer-gate-${label}`,
        name: `${prefix}${name}`,
        arguments: args,
        agent,
        signal: new AbortController().signal,
      })
      const run = async (label, name, args) => {
        const result = await execute(label, name, args)
        raw.set(label, result)
        return { serial: ++serial, label, ...compactResult(result) }
      }

      ctx.tuiComputerControl.setPaused(agent, true)
      const paused = await run('paused-screen', 'get_screen_size', {})
      ctx.tuiComputerControl.setPaused(agent, false)

      const header = agent.session.requestHeader?.()
      const childHandle = await ctx.agents.create({
        sessionId: SessionId(`session-computer-isolation-${Date.now()}`),
        parentAgent: agent,
        meta: { cwd: process.cwd(), parentSession: agent.session.id, origin: 'subagent', delegationDepth: 1 },
        agentOptions: header?.config === undefined ? undefined : { provider: header.config.provider, model: header.config.model },
      })
      let childToolCount = -1
      let childCallDenied = false
      let secondLeaseDenied = false
      try {
        const childTools = childHandle.agent.ctx.get('tools') ?? ctx.tools
        childToolCount = childTools.schemas(childHandle.agent).filter(schema => schema.name.startsWith(prefix)).length
        try {
          const childResult = await childTools.execute({
            callId: 'computer-gate-wrong-agent', name: `${prefix}get_screen_size`, arguments: {},
            agent: childHandle.agent, signal: new AbortController().signal,
          })
          childCallDenied = childResult?.isError === true
        } catch { childCallDenied = true }
        try { await ctx.tuiComputerControl.arm(childHandle.agent) } catch { secondLeaseDenied = true }
      } finally {
        await childHandle.dispose()
      }

      const results = [paused]
      results.push(await run('screen-size', 'get_screen_size', {}))
      results.push(await run('accessibility', 'get_accessibility_tree', {}))
      results.push(await run('fixture-windows', 'list_windows', { pid: fixture.pid }))
      const fixtureWindow = findWindow(raw.get('fixture-windows'), fixture.pid, 'dsh CUA Fixture')
      if (fixtureWindow === undefined) throw new Error('Cua Driver did not find the dedicated WinForms fixture window')
      const windowId = Number(fixtureWindow.window_id)
      results.push(await run('fixture-state', 'get_window_state', {
        pid: fixture.pid, window_id: windowId, max_elements: 128, max_depth: 12,
      }))
      const input = findElement(raw.get('fixture-state'), 'Gate input')
      const button = findElement(raw.get('fixture-state'), 'Apply fixture value')
      if (input === undefined || button === undefined) throw new Error('WinForms accessibility elements were not exposed')
      results.push(await run('fixture-set-value', 'set_value', {
        pid: fixture.pid, element_token: input.element_token, value: 'm8-private-value',
      }))
      results.push(await run('fixture-refresh', 'get_window_state', {
        pid: fixture.pid, window_id: windowId, max_elements: 128, max_depth: 12,
      }))
      const refreshedButton = findElement(raw.get('fixture-refresh'), 'Apply fixture value')
      if (refreshedButton === undefined) throw new Error('WinForms button disappeared after value update')
      results.push(await run('fixture-click', 'click', {
        pid: fixture.pid, element_token: refreshedButton.element_token, delivery_mode: 'background',
      }))
      await waitFor(() => existsSync(fixtureResultPath), 5_000, 'WinForms button click did not update the fixture result')
      results.push(await run('fixture-verify', 'get_window_state', {
        pid: fixture.pid, window_id: windowId, query: 'clicked', max_elements: 128, max_depth: 12,
      }))

      const browser = { isolated: undefined, existingProfile: undefined, flow: [] }
      browser.isolated = await run('browser-prepare', 'browser_prepare', {
        allow_launch: true, profile: { mode: 'isolated_new' }, session: 'dsh-tui-m8-browser',
      })
      const isolatedResult = raw.get('browser-prepare')
      if (!browser.isolated.isError && refusalCode(isolatedResult) === undefined) {
        let binding = findBrowserBinding(isolatedResult)
        if (binding === undefined) {
          const launched = allObjects(isolatedResult).find(value => Number.isSafeInteger(Number(value?.pid)) && Number.isSafeInteger(Number(value?.window_id)))
          if (launched === undefined) throw new Error('isolated browser launch did not return a bindable process/window')
          browser.flow.push(await run('browser-bind', 'get_browser_state', {
            pid: Number(launched.pid), window_id: Number(launched.window_id), session: 'dsh-tui-m8-browser',
          }))
          binding = findBrowserBinding(raw.get('browser-bind'))
        }
        if (binding === undefined) throw new Error('isolated browser did not return an exact target/tab binding')
        browser.flow.push(await run('browser-navigate', 'browser_navigate', {
          target_id: binding.targetId, tab_id: binding.tabId, url: fixtureUrl, session: 'dsh-tui-m8-browser',
        }))
        browser.flow.push(await run('browser-state', 'get_browser_state', {
          target_id: binding.targetId, tab_id: binding.tabId, include_screenshot: true, session: 'dsh-tui-m8-browser',
        }))
        const inputRef = allObjects(raw.get('browser-state')).find(value => typeof value?.ref === 'string'
          && JSON.stringify(value).toLowerCase().includes('public note'))?.ref
        if (typeof inputRef !== 'string') throw new Error('browser fixture input ref was not returned')
        browser.flow.push(await run('browser-type', 'browser_type', {
          target_id: binding.targetId, tab_id: binding.tabId, ref: inputRef, text: 'browser-private-value', replace: true,
          session: 'dsh-tui-m8-browser',
        }))
        browser.flow.push(await run('browser-after-type', 'get_browser_state', {
          target_id: binding.targetId, tab_id: binding.tabId, query: 'browser-private-value', session: 'dsh-tui-m8-browser',
        }))
      }

      if (Number.isSafeInteger(existingBrowserPid) && existingBrowserPid > 0) {
        const existingWindows = await run('existing-windows', 'list_windows', { pid: existingBrowserPid })
        results.push(existingWindows)
        const existingWindow = findWindow(raw.get('existing-windows'), existingBrowserPid)
        if (existingWindow !== undefined) {
          browser.existingProfile = await run('existing-profile', 'browser_prepare', {
            pid: existingBrowserPid,
            window_id: Number(existingWindow.window_id),
            strategy: { kind: 'existing_profile' },
            session: 'dsh-tui-m8-existing',
          })
        }
      }
      results.push(await run('browser-end', 'end_session', { session: 'dsh-tui-m8-browser' }))

      const approvalsAfter = approvalCount(agent)
      const stateBeforeEnd = ctx.tuiComputerControl.state(agent)
      agent.session.append('turn/end', { turn, reason: { kind: 'completed' } })
      await waitFor(() => ctx.tuiComputerControl.state(agent).phase === 'idle', 20_000, 'computer lease did not disarm after turn/end')
      await waitFor(() => scoped.schemas(agent).every(schema => !schema.name.startsWith(prefix)), 20_000, 'CUA tools remained after turn/end')

      writeFileSync(auditPath, `${JSON.stringify({
        runtime: ctx.tuiComputerControl.runtime(),
        beforeToolCount: beforeNames.filter(name => name.startsWith(prefix)).length,
        toolCount: cuaNames.length,
        exactTools: cuaNames,
        highRiskRegistered: ['kill_app', 'clipboard_read', 'clipboard_write', 'start_recording', 'replay_trajectory', 'install_ffmpeg', 'set_config']
          .every(name => cuaNames.includes(`${prefix}${name}`)),
        childToolCount,
        childCallDenied,
        secondLeaseDenied,
        approvalsBefore,
        approvalsAfter,
        stateBeforeEnd,
        stateAfterEnd: ctx.tuiComputerControl.state(agent),
        afterToolCount: scoped.schemas(agent).filter(schema => schema.name.startsWith(prefix)).length,
        fixtureResult: readFileSync(fixtureResultPath, 'utf8'),
        results,
        browser,
      }, null, 2)}\n`, 'utf8')
    })().catch(async error => {
      try { await ctx.tuiComputerControl.stop(agent, 'Computer PTY probe failed', false) } catch {}
      const detail = `${errorChain(error)}\n${error instanceof Error ? error.stack ?? '' : ''}`
      writeFileSync(auditPath, `${JSON.stringify({ error: detail }, null, 2)}\n`, 'utf8')
      process.stderr.write(`computer-driver: ${detail}\n`)
    })
  })
}
