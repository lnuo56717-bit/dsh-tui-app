import { describe, expect, it } from 'vitest'
import { isVisionModelId, stampVisionModel, VISION_MODEL_ID } from '../../src/vision-models.js'

describe('vision catalog stamp', () => {
  it('recognizes the official vision model id', () => {
    expect(isVisionModelId(VISION_MODEL_ID)).toBe(true)
    expect(isVisionModelId('deepseek-v4-flash')).toBe(false)
  })

  it('adds image modality and a description to vision routes', () => {
    expect(stampVisionModel({ id: VISION_MODEL_ID, name: 'Vision' })).toMatchObject({
      id: VISION_MODEL_ID,
      inputModalities: ['text', 'image'],
      description: 'Experimental vision (image understanding)',
    })
  })

  it('leaves text-only models unchanged', () => {
    const model = { id: 'deepseek-v4-flash', name: 'Flash', inputModalities: ['text'] as const }
    expect(stampVisionModel(model)).toBe(model)
  })
})
