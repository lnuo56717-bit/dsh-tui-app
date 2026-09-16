import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { wrapDeepSeekAdapter } from '../../src/llm-vision.js'
import { VISION_MODEL_ID } from '../../src/vision-models.js'

describe('llm-vision adapter wrap', () => {
  it('stamps vision modality on catalog lookup without changing text models', async () => {
    const adapter = {
      async listModels() {
        return [
          { provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'Flash', inputModalities: ['text'] as const },
          { provider: 'deepseek-official', id: VISION_MODEL_ID, name: 'Vision', inputModalities: ['text'] as const },
        ]
      },
      async resolveModel(_provider: string, model: string) {
        return { provider: 'deepseek-official', id: model, name: model, inputModalities: ['text'] as const, context: { contextWindow: 1 } }
      },
      async *stream() {},
    }
    wrapDeepSeekAdapter(adapter, {} as Context)
    const listed = await adapter.listModels()
    expect(listed[0]?.inputModalities).toEqual(['text'])
    expect(listed[1]?.inputModalities).toEqual(['text', 'image'])
    const resolved = await adapter.resolveModel('deepseek-official', VISION_MODEL_ID)
    expect(resolved.inputModalities).toEqual(['text', 'image'])
  })

  it('delegates image requests unchanged when the current adapter is native', async () => {
    let streamed = false
    const adapter = {
      async listModels() { return [] },
      async resolveModel(_provider: string, model: string) {
        return { provider: 'deepseek-official', id: model, name: model, inputModalities: ['text', 'image'] as const }
      },
      async *stream() { streamed = true },
    }
    wrapDeepSeekAdapter(adapter, {} as Context)
    for await (const _chunk of adapter.stream({
      provider: 'deepseek-official', model: VISION_MODEL_ID,
      messages: [{ role: 'user', source: { kind: 'user' }, content: [{
        type: 'image', attachment: { attachmentId: 'image-1', mediaType: 'image/png', bytes: 1, width: 1, height: 1 },
      }] }],
    } as never)) { /* no-op */ }
    expect(streamed).toBe(true)
  })
})
