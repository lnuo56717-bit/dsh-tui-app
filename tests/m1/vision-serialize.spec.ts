import { describe, expect, it } from 'vitest'
import type { Message } from '@deepseek-ai/dsh-llm'
import { offloadImages, serializeMessagesWithImages } from '../../src/vision-serialize.js'
import { VISION_MODEL_ID } from '../../src/vision-models.js'

const png = {
  attachmentId: 'att-1',
  mediaType: 'image/png',
  bytes: 8,
  width: 1,
  height: 1,
  name: 'dot.png',
}

function user(content: Message['content']): Message {
  return { id: 'm1' as Message['id'], role: 'user', source: { kind: 'user' }, content }
}

describe('vision serialize', () => {
  it('keeps recent images and placeholders older ones past the byte budget', () => {
    const old = { ...png, attachmentId: 'old', bytes: 20 }
    const recent = { ...png, attachmentId: 'new', bytes: 8 }
    const messages = [user([
      { type: 'image', attachment: old },
      { type: 'text', text: 'what is this?' },
      { type: 'image', attachment: recent },
    ])]
    const offloaded = offloadImages(messages, 12)
    expect(offloaded[0]?.content).toEqual([
      { type: 'text', text: expect.stringContaining('omitted') },
      { type: 'text', text: 'what is this?' },
      { type: 'image', attachment: recent },
    ])
  })

  it('serializes user images as data-URL parts in order with text', async () => {
    const messages = [user([
      { type: 'text', text: 'describe' },
      { type: 'image', attachment: png },
    ])]
    const wire = await serializeMessagesWithImages(messages, {
      async readImage(ref) {
        return { ref, data: Uint8Array.from([1, 2, 3, 4]) }
      },
    }, new AbortController().signal)
    expect(wire).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: 'describe' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AQIDBA==' } },
      ],
    }])
    expect(VISION_MODEL_ID).toContain('vision')
  })
})
