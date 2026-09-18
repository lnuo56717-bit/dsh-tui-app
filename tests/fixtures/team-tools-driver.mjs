import { writeFileSync } from 'node:fs'

export const name = 'dsh-tui-team-tools-driver'
export const inject = ['tools']

let written = false
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

export function apply(ctx) {
  const path = process.env.DSH_TUI_TEAM_TOOLS
  if (!path) throw new Error('DSH_TUI_TEAM_TOOLS is missing')
  writeFileSync(path, `${JSON.stringify({ stage: 'plugin-applied', names: [] }, null, 2)}\n`, 'utf8')
  ctx.on('agent/created', ({ agent }) => {
    if (written) return
    written = true
    void (async () => {
      await pause(800)
      const scoped = agent.ctx.get('tools') ?? ctx.tools
      // ToolService is one layered registry. Passing the Agent is what asks it
      // to resolve registrations installed in that Agent's exact Cordis scope.
      const names = scoped.schemas(agent).map(schema => schema.name).sort()
      writeFileSync(path, `${JSON.stringify({ stage: 'agent-created', names }, null, 2)}\n`, 'utf8')
    })().catch(error => process.stderr.write(`team-tools-driver: ${error instanceof Error ? error.stack : String(error)}\n`))
  })
}
