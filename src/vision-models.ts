/** Official DeepSeek vision route advertised by the current hosted catalog. */
export const VISION_MODEL_ID = 'deepseek-v4-flash-vision-exp'

export interface ModalityModel {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly inputModalities?: readonly string[]
}

/** True when this wire model id is known to accept images. */
export function isVisionModelId(id: string): boolean {
  return id === VISION_MODEL_ID || id.includes('vision')
}

/**
 * Stamp image input on official (and similarly named) vision models.
 * Older DeepSeek adapters hard-code text-only, so the compatibility overlay
 * restores the known catalog claim. Native image declarations are preserved.
 */
export function stampVisionModel<T extends ModalityModel>(model: T): T {
  if (!isVisionModelId(model.id)) return model
  const modalities = new Set(model.inputModalities ?? ['text'])
  modalities.add('text')
  modalities.add('image')
  return {
    ...model,
    inputModalities: [...modalities],
    ...model.description === undefined ? { description: 'Experimental vision (image understanding)' } : {},
  }
}
