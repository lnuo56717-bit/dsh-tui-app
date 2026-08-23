/**
 * Image-capable DeepSeek chat-completions serialization for the rc.5 adapter
 * overlay. Text-only history stays on string user content; image history uses
 * ordered data-URL parts. Tool-result images follow their string tool messages
 * in a separate user message, matching Harness 0.1.1-rc.1.
 */
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { contentHasImage, LlmError } from '@deepseek-ai/dsh-llm'
import { isVisionModelId } from './vision-models.js'

export interface ImageRef {
  readonly attachmentId: string
  readonly mediaType: string
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly name?: string
}

export interface ImageReader {
  readImage(ref: ImageRef, signal?: AbortSignal): Promise<{ readonly ref: ImageRef; readonly data: Uint8Array }>
}

export interface RequestDefaults {
  thinking?: 'enabled' | 'disabled'
  reasoningEffort?: 'off' | 'high' | 'max'
}

interface WireImagePart {
  type: 'image_url'
  image_url: { url: string }
}

interface WireTextPart {
  type: 'text'
  text: string
}

type WireUserPart = WireTextPart | WireImagePart

interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | WireUserPart[] | null
  reasoning_content?: string
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
}

export interface WireRequest {
  model: string
  messages: WireMessage[]
  stream: true
  stream_options: { include_usage: true }
  thinking?: { type: 'enabled' | 'disabled' }
  reasoning_effort?: 'high' | 'max'
  tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }>
  temperature?: number
  max_tokens?: number
  stop?: string[]
}

export const DEFAULT_MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024
const TOOL_RESULT_IMAGE_TEXT = 'Attached image(s) from tool result:'
const OMITTED = '[image omitted to keep the request within its image limit; older images are omitted first.]'

function flattenText(blocks: readonly ContentBlock[]): string {
  return blocks.filter(block => block.type === 'text').map(block => block.text).join('')
}

function imageRef(block: Extract<ContentBlock, { type: 'image' }>): ImageRef {
  return block.attachment as ImageRef
}

/** Oldest images become placeholders once encoded payload would exceed the bound. */
export function offloadImages(messages: readonly Message[], maxBytes: number): Message[] {
  let total = 0
  const keep = new Set<string>()
  const ordered: ImageRef[] = []
  const walk = (blocks: readonly ContentBlock[]): void => {
    for (const block of blocks) {
      if (block.type === 'image') ordered.push(imageRef(block))
      else if (block.type === 'tool-result') walk(block.content)
    }
  }
  for (const message of messages) walk(message.content)
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const ref = ordered[i]!
    const encoded = Math.ceil(ref.bytes * 4 / 3)
    if (total + encoded <= maxBytes) {
      keep.add(ref.attachmentId)
      total += encoded
    }
  }
  const mapBlocks = (blocks: readonly ContentBlock[]): ContentBlock[] => blocks.map(block => {
    if (block.type === 'image') {
      return keep.has(imageRef(block).attachmentId)
        ? block
        : { type: 'text', text: OMITTED }
    }
    if (block.type === 'tool-result') return { ...block, content: mapBlocks(block.content) }
    return block
  })
  return messages.map(message => ({ ...message, content: mapBlocks(message.content) }))
}

function serializeAssistant(message: Message): WireMessage {
  const text = flattenText(message.content)
  const reasoning = message.content.filter(block => block.type === 'reasoning').map(block => block.text).join('')
  const toolCalls = message.content.filter(block => block.type === 'tool-call').map(block => ({
    id: block.id,
    type: 'function' as const,
    function: { name: block.name, arguments: block.arguments },
  }))
  return {
    role: 'assistant',
    content: text,
    ...reasoning.length > 0 ? { reasoning_content: reasoning } : {},
    ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {},
  }
}

async function imagePart(block: Extract<ContentBlock, { type: 'image' }>, reader: ImageReader, signal: AbortSignal): Promise<WireImagePart> {
  const stored = await reader.readImage(imageRef(block), signal)
  return {
    type: 'image_url',
    image_url: { url: `data:${stored.ref.mediaType};base64,${Buffer.from(stored.data).toString('base64')}` },
  }
}

async function contentParts(
  blocks: readonly ContentBlock[],
  reader: ImageReader,
  signal: AbortSignal,
): Promise<WireUserPart[]> {
  const parts: WireUserPart[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        if (block.text.length > 0) parts.push({ type: 'text', text: block.text })
        break
      case 'image':
        parts.push(await imagePart(block, reader, signal))
        break
      case 'tool-result':
        parts.push(...await contentParts(block.content, reader, signal))
        break
      default:
        break
    }
  }
  return parts
}

function userContent(parts: readonly WireUserPart[]): string | WireUserPart[] {
  const text: string[] = []
  for (const part of parts) {
    if (part.type === 'image_url') return [...parts]
    text.push(part.text)
  }
  return text.join('')
}

export async function serializeMessagesWithImages(
  messages: readonly Message[],
  reader: ImageReader,
  signal: AbortSignal,
): Promise<WireMessage[]> {
  for (const message of messages) {
    if (message.role !== 'user' && contentHasImage(message.content)) {
      throw new LlmError(
        `The DeepSeek chat-completions adapter cannot represent image content in a ${message.role} message.`,
        'UNSUPPORTED_CONTENT',
      )
    }
  }
  const wire: WireMessage[] = []
  let pendingToolImages: WireImagePart[] = []
  const flushToolImages = (): void => {
    if (pendingToolImages.length === 0) return
    wire.push({
      role: 'user',
      content: [{ type: 'text', text: TOOL_RESULT_IMAGE_TEXT }, ...pendingToolImages],
    })
    pendingToolImages = []
  }

  for (const message of messages) {
    if (message.role === 'system') {
      flushToolImages()
      wire.push({ role: 'system', content: flattenText(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      flushToolImages()
      wire.push(serializeAssistant(message))
      continue
    }
    const regular = message.content.filter(block => block.type !== 'tool-result')
    const toolResults = message.content.filter((block): block is Extract<ContentBlock, { type: 'tool-result' }> => (
      block.type === 'tool-result'
    ))
    const content = userContent(await contentParts(regular, reader, signal))
    if (content.length > 0 || toolResults.length === 0) {
      flushToolImages()
      wire.push({ role: 'user', content })
    }
    for (const result of toolResults) {
      const parts = await contentParts(result.content, reader, signal)
      const images = parts.filter((part): part is WireImagePart => part.type === 'image_url')
      const text = parts.filter(part => part.type === 'text').map(part => part.text).join('')
      wire.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        content: text || (images.length > 0 ? '(see attached image)' : '(no output)'),
      })
      pendingToolImages.push(...images)
    }
  }
  flushToolImages()
  return wire
}

function resolveThinking(options: GenerateOptions, defaults: RequestDefaults): {
  thinking?: 'enabled' | 'disabled'
  reasoningEffort?: 'high' | 'max'
} {
  if (options.purpose === 'session-title') return { thinking: 'disabled' }
  const effort = options.reasoningEffort === undefined ? defaults.reasoningEffort : String(options.reasoningEffort)
  if (defaults.thinking === 'disabled' && effort !== undefined && effort !== 'off') {
    throw new LlmError(`DeepSeek deployment does not support reasoning effort "${effort}"`, 'UNSUPPORTED_REASONING_EFFORT')
  }
  if (effort === 'off') return { thinking: 'disabled' }
  if (effort === 'high' || effort === 'max') {
    return { thinking: 'enabled', reasoningEffort: effort }
  }
  return defaults.thinking === undefined ? {} : { thinking: defaults.thinking }
}

export async function serializeRequestWithImages(
  options: GenerateOptions,
  images: { reader: ImageReader; maxRequestImageBytes: number; signal: AbortSignal },
  defaults: RequestDefaults = {},
): Promise<WireRequest> {
  if (!isVisionModelId(options.model)) {
    throw new LlmError(`DeepSeek model "${options.model}" does not accept image input.`, 'UNSUPPORTED_CONTENT')
  }
  const requestMessages = offloadImages(options.messages, images.maxRequestImageBytes)
  const messages: WireMessage[] = []
  if (options.system !== undefined) messages.push({ role: 'system', content: options.system })
  messages.push(...await serializeMessagesWithImages(requestMessages, images.reader, images.signal))
  const tools = options.tools?.map(tool => ({
    type: 'function' as const,
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }))
  const resolved = resolveThinking(options, defaults)
  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...resolved.thinking !== undefined ? { thinking: { type: resolved.thinking } } : {},
    ...resolved.reasoningEffort !== undefined ? { reasoning_effort: resolved.reasoningEffort } : {},
    ...tools !== undefined && tools.length > 0 ? { tools } : {},
    ...options.temperature !== undefined ? { temperature: options.temperature } : {},
    ...options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
    ...options.stop !== undefined ? { stop: options.stop } : {},
  }
}
