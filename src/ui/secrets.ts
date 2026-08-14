const NAMED_SECRET = /\b((?:api|access)[_-]?key|authorization|secret(?:[_-]?key)?|password|access[_-]?token)\s*[:=]\s*['"]?[^\s'"]+/gi
const ENV_SECRET = /\b[A-Z][A-Z0-9_]*(?:API_KEY|ACCESS_TOKEN|SECRET|PASSWORD|AUTH_TOKEN)\b\s*[:=]\s*['"]?[^\s'"]+/g
const BEARER = /\bBearer\s+[A-Za-z0-9._\-+=/]{8,}/g
const SK_KEY = /\bsk-(?:ant-|or-)?[A-Za-z0-9_-]{10,}/g

/** Strip credentials from user-visible chrome. Never invent replacements beyond an ellipsis. */
export function redactSecrets(value: string): string {
  return value
    .replace(SK_KEY, 'sk-…')
    .replace(BEARER, 'Bearer …')
    .replace(NAMED_SECRET, (_, name: string) => `${name}=…`)
    .replace(ENV_SECRET, match => match.replace(/[:=]\s*['"]?[^\s'"]+$/u, '=…'))
}

export function redactSecretValue(value: unknown): string {
  try {
    return redactSecrets(typeof value === 'string' ? value : JSON.stringify(value) ?? String(value))
  } catch {
    return '[unserializable]'
  }
}
