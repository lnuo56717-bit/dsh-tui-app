import { writeFileSync } from 'node:fs'

/**
 * Verification-only overlay for the native ask_user_question tool.
 *
 * It proves two separate things: that the tool is registered in the running
 * profile's model-facing registry, and that executing it through the ordinary
 * tool pipeline blocks until the dshtui QuestionCard returns a human answer.
 */
export const name = 'dsh-tui-ask-user-driver'
export const inject = ['tools']

let started = false
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

export function apply(ctx) {
  const toolsPath = process.env.DSH_TUI_ASK_TOOLS
  const auditPath = process.env.DSH_TUI_ASK_AUDIT
  ctx.on('agent/created', ({ agent }) => {
    if (started) return
    started = true
    void (async () => {
      if (!toolsPath || !auditPath) throw new Error('ask-user driver environment is incomplete')
      await pause(600)
      const names = ctx.tools.schemas().map(schema => schema.name).sort()
      const definition = ctx.tools.get('ask_user_question')
      writeFileSync(toolsPath, `${JSON.stringify({
        toolNames: names,
        registered: names.includes('ask_user_question'),
        description: definition?.description,
      }, null, 2)}\n`, 'utf8')
      if (!names.includes('ask_user_question')) {
        writeFileSync(auditPath, `${JSON.stringify({ skipped: 'ask_user_question is not registered' }, null, 2)}\n`, 'utf8')
        return
      }
      const controller = new AbortController()
      const askedAt = Date.now()
      const result = await ctx.tools.execute({
        callId: 'ask-user-probe',
        name: 'ask_user_question',
        arguments: {
          questions: [{
            id: 'probe',
            header: '原生提问验证',
            question: '选择一个测试选项',
            options: [{ label: '选项甲', description: '第一项' }, { label: '选项乙' }],
            multi_select: false,
          }],
        },
        agent,
        signal: controller.signal,
      })
      writeFileSync(auditPath, `${JSON.stringify({
        // A tool that returned before the human answered would not have paused.
        elapsedMs: Date.now() - askedAt,
        isError: result.isError === true,
        value: result.value,
        error: result.error,
        content: result.content,
      }, null, 2)}\n`, 'utf8')
    })().catch(error => {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      if (auditPath) writeFileSync(auditPath, `${JSON.stringify({ error: detail }, null, 2)}\n`, 'utf8')
      process.stderr.write(`ask-user-driver: ${error instanceof Error ? error.stack : String(error)}\n`)
    })
  })
}
