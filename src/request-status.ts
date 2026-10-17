import { redactSecrets } from './ui/secrets.js'

export interface RequestFailure {
  readonly message: string
  readonly code?: string
  readonly status?: number
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

/** Display projection only: never change the provider's durable failure. */
function safeText(value: string): string {
  return redactSecrets(value)
    .replace(/https?:\/\/[^\s<>"']+/giu, value => {
      try {
        const url = new URL(value)
        return `${url.origin}${url.pathname}${url.search === '' ? '' : '?…'}`
      } catch { return '[URL]' }
    })
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
    .replace(/\s+/gu, ' ').trim()
}

export function requestFailure(value: unknown): RequestFailure {
  const data = record(value)
  const message = safeText(typeof value === 'string' ? value
    : typeof data.message === 'string' ? data.message : 'The model request failed.')
  const code = typeof data.code === 'string' ? safeText(data.code) : ''
  return {
    message: message || 'The model request failed.',
    ...(code === '' ? {} : { code }),
    ...(typeof data.status === 'number' && Number.isInteger(data.status) ? { status: data.status } : {}),
  }
}

export function failureLabel(failure: RequestFailure): string {
  const facts = [failure.code, failure.status === undefined ? undefined : `HTTP ${failure.status}`].filter(Boolean)
  return `${facts.length === 0 ? '' : `[${facts.join(' · ')}] `}${failure.message}`
}

export function failureHint(failure: RequestFailure): string {
  if (failure.code === 'TRANSPORT' || failure.code === 'TIMEOUT') return 'Check the network/proxy, then resend your prompt.'
  if (failure.code === 'MISSING_CREDENTIAL' || failure.status === 401) return 'Check the configured provider credential, then resend.'
  if (failure.code === 'RATE_LIMIT' || failure.status === 429) return 'The provider is rate-limiting requests. Wait, then resend.'
  return 'The turn has ended. Fix the reported issue, then resend your prompt.'
}
