/**
 * Overlay the installed rc.5 DeepSeek adapter with vision catalog claims and
 * image-capable serialization, without replacing the Harness package.
 */
import type { Context } from '@deepseek-ai/cordis'
import { attributionHeaders, contentHasImage, LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEFAULT_MAX_REQUEST_IMAGE_BYTES, serializeRequestWithImages, type ImageRef } from './vision-serialize.js'
import { stampVisionModel } from './vision-models.js'

export const name = 'llm-vision'
export const inject = ['llm']

const PROVIDER = 'deepseek-official'
const wrapped = new WeakSet<object>()

interface AdapterConfig {
  options: () => {
    baseURL: string
    defaults: { thinking?: 'enabled' | 'disabled'; reasoningEffort?: 'off' | 'high' | 'max' }
    models: Array<{ id: string; inputModalities?: string[] }>
  }
  resolveApiKey: (connection: unknown) => Promise<string>
  resolveUserId: () => string
}

interface DeepSeekAdapterLike {
  listModels: (provider: string) => Promise<readonly LlmModelInfo[]>
  resolveModel: (provider: string, model: string, signal?: AbortSignal) => Promise<LlmResolvedModelInfo>
  stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>
  config?: AdapterConfig
}

interface AdapterRegistration {
  adapter: DeepSeekAdapterLike
}

interface LlmRuntimeLike {
  adapters?: Map<string, AdapterRegistration>
}

interface SseModule {
  parseSse: (stream: ReadableStream<BufferSource>, onComment?: (comment: string) => void) => AsyncIterable<string>
}

interface TranslateModule {
  translate: (payloads: AsyncIterable<string>) => AsyncIterable<StreamChunk>
}

let wire: Promise<{ parseSse: SseModule['parseSse']; translate: TranslateModule['translate'] }> | undefined

export function wrapDeepSeekAdapter(adapter: DeepSeekAdapterLike, ctx: Context): void {
  if (wrapped.has(adapter)) return
  const originalList = adapter.listModels.bind(adapter)
  const originalResolve = adapter.resolveModel.bind(adapter)
  const originalStream = adapter.stream.bind(adapter)
  adapter.listModels = async (provider: string) => (await originalList(provider)).map(stampVisionModel)
  adapter.resolveModel = async (provider, model, signal) => stampVisionModel(await originalResolve(provider, model, signal))
  adapter.stream = async function* (options: GenerateOptions): AsyncIterable<StreamChunk> {
    const hasImages = options.messages.some(message => contentHasImage(message.content))
    if (!hasImages) {
      yield* originalStream(options)
      return
    }
    yield* streamWithImages(adapter, options, ctx)
  }
  wrapped.add(adapter)
}

async function* streamWithImages(
  adapter: DeepSeekAdapterLike,
  options: GenerateOptions,
  ctx: Context,
): AsyncIterable<StreamChunk> {
  const config = adapter.config
  if (config === undefined) {
    throw new LlmError('DeepSeek image conversion requires the official adapter connection facts.', 'UNSUPPORTED_CONTENT')
  }
  const attachments = ctx.get('attachments') as {
    readImage: (ref: ImageRef, signal?: AbortSignal) => Promise<{ ref: ImageRef; data: Uint8Array }>
  } | undefined
  if (attachments === undefined) {
    throw new LlmError('DeepSeek image conversion requires the durable attachment service.', 'UNSUPPORTED_CONTENT')
  }
  const connection = config.options()
  const body = await serializeRequestWithImages(options, {
    reader: attachments,
    maxRequestImageBytes: DEFAULT_MAX_REQUEST_IMAGE_BYTES,
    signal: options.signal ?? new AbortController().signal,
  }, connection.defaults)
  const apiKey = await config.resolveApiKey(connection)
  const userId = config.resolveUserId()
  const { parseSse, translate } = await loadWire()
  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
    accept: 'text/event-stream',
    ...attributionHeaders(),
    'x-deepseek-harness-user-id': String(userId),
    ...options.sessionId !== undefined ? { 'x-deepseek-harness-session-id': String(options.sessionId) } : {},
    ...options.purpose === 'compaction' ? { 'x-deepseek-harness-compact': '1' } : {},
  }
  let response: Response
  try {
    response = await fetch(`${connection.baseURL}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      ...options.signal === undefined ? {} : { signal: options.signal },
    })
  } catch (error: unknown) {
    if (options.signal?.aborted) throw error
    throw new LlmError(`DeepSeek API request to ${connection.baseURL} failed`, 'TRANSPORT', { cause: error })
  }
  if (!response.ok) {
    let message = `DeepSeek API error (HTTP ${response.status})`
    try {
      const parsed = await response.json() as { error?: { message?: string } }
      if (parsed.error?.message) message = parsed.error.message
    } catch {
      // Keep the status-based message when the error body is not JSON.
    }
    throw new LlmError(message, response.status === 401 || response.status === 403 ? 'AUTH' : 'INVALID_REQUEST', {
      status: response.status,
    })
  }
  if (response.body === null) throw new LlmError('DeepSeek API returned no response body', 'EMPTY_RESPONSE')
  yield* translate(parseSse(response.body))
}

async function loadWire(): Promise<{ parseSse: SseModule['parseSse']; translate: TranslateModule['translate'] }> {
  wire ??= (async () => {
    const dir = resolveDeepseekLib()
    if (dir === undefined) {
      throw new LlmError('DeepSeek vision overlay could not locate dsh-llm-deepseek SSE helpers.', 'UNSUPPORTED_CONTENT')
    }
    const sse = await import(pathToFileURL(join(dir, 'sse.js')).href) as SseModule
    const translate = await import(pathToFileURL(join(dir, 'translate.js')).href) as TranslateModule
    return { parseSse: sse.parseSse, translate: translate.translate }
  })()
  return wire
}

function resolveDeepseekLib(): string | undefined {
  const homes = [process.env.DSH_HOME, join(homedir(), '.dsh')].filter((value): value is string => value !== undefined)
  for (const home of homes) {
    const pkg = join(home, 'profiles/node_modules/@deepseek-ai/dsh-llm-deepseek')
    if (existsSync(join(pkg, 'lib/types/sse.js'))) return join(pkg, 'lib/types')
    if (existsSync(join(pkg, 'lib/sse.js'))) return join(pkg, 'lib')
  }
  try {
    const argv = process.argv[1]
    if (argv === undefined) return undefined
    const req = createRequire(argv)
    const root = dirname(req.resolve('@deepseek-ai/dsh-llm-deepseek/package.json'))
    if (existsSync(join(root, 'lib/types/sse.js'))) return join(root, 'lib/types')
    if (existsSync(join(root, 'lib/sse.js'))) return join(root, 'lib')
  } catch {
    return undefined
  }
  return undefined
}

function wrapRegistered(ctx: Context): void {
  const runtime = ctx.llm as unknown as LlmRuntimeLike
  const entry = runtime.adapters?.get(PROVIDER)
  if (entry?.adapter !== undefined) wrapDeepSeekAdapter(entry.adapter, ctx)
}

export function apply(ctx: Context): void {
  wrapRegistered(ctx)
  ctx.on('llm/adapters-updated', () => wrapRegistered(ctx))
}
