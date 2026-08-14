import React from 'react'
import { renderToString } from 'ink'
import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import type { InteractionController, RuntimeSnapshot } from '../../src/interaction-controller.js'
import { TranscriptStore } from '../../src/transcript-store.js'
import { Shell } from '../../src/ui/app.js'

const ansi = /\u001B\[[0-?]*[ -/]*[@-~]/gu

function staticController(runtime: RuntimeSnapshot): InteractionController {
  const store = new TranscriptStore()
  return {
    transcript: store,
    subscribe: () => () => {},
    getSnapshot: () => runtime,
  } as unknown as InteractionController
}

describe('80-column context visibility', () => {
  it('pins the real context occupancy despite long CJK facts and a transient notice', () => {
    const runtime: RuntimeSnapshot = {
      sessionId: 'session-这是一个很长且不应该挤掉上下文占用率的会话标识',
      cwd: 'C:\\用户\\深海工作区\\一个非常非常长的中文项目路径\\packages\\终端界面',
      model: 'deepseek-provider/一个很长的模型名称',
      agentStatus: 'running',
      permission: 'workspace-write',
      projection: {
        asOfSeq: 42,
        values: {
          title: '正在修复具有超长中文标题的上下文可见性问题',
          permissions: { currentValue: 'workspace-write', options: [] },
          contextPressure: { projectedTokens: 18_000, pressureTokens: 20_000, contextWindow: 128_000 },
          contextBreakdown: { systemTokens: 4_000, toolsTokens: 3_000, messageTokens: 9_000 },
        },
      },
      theme: 'abyss',
      notice: '模型已经实时切换，下一步骤将使用新的推理配置',
      error: undefined,
      approval: undefined,
      questions: undefined,
    }

    const output = renderToString(
      <Shell theme="abyss" color="mono" controller={staticController(runtime)} />,
      { columns: 80 },
    ).replace(ansi, '')
    const lines = output.trimEnd().split('\n')

    expect(output).toContain('ctx 14%')
    expect(output).not.toContain('ctx 16%') // projectedTokens wins over the older pressure sample.
    expect(lines.length).toBeLessThanOrEqual(24)
    for (const line of lines) {
      expect(stringWidth(line)).toBeLessThanOrEqual(80)
      expect(line).not.toContain('\uFFFD')
    }
  })
})
