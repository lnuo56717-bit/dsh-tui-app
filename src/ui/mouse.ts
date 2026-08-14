export type WheelDirection = 'up' | 'down'

const SGR = /^(?:\u001B\[|<)?\[?<(\d+);\d+;\d+[Mm]$/u
const SGR_SCAN = /<(\d+);\d+;\d+[Mm]/gu
const SGR_REPORT = /<(\d+);(\d+);(\d+)([Mm])/gu
const X10_PREFIX = '\u001B[M'

function wheelOf(button: number): WheelDirection | 'other' {
  if (button === 64 || button === 68) return 'up'
  if (button === 65 || button === 69) return 'down'
  return 'other'
}

/** Decode a key sequence after Ink strips the leading ESC, or a raw CSI mouse report. */
export function parseWheel(input: string): WheelDirection | 'other' | undefined {
  if (input === '') return undefined
  const sgr = SGR.exec(input)
  if (sgr !== null) return wheelOf(Number(sgr[1]))
  if (input.startsWith(X10_PREFIX) && input.length >= X10_PREFIX.length + 3) {
    return wheelOf(input.charCodeAt(X10_PREFIX.length) - 32)
  }
  if (input.startsWith('[<') && /;\d+;\d+[Mm]$/u.test(input)) return 'other'
  return undefined
}

export interface WheelBurst {
  /** Net wheel notches: negative scrolls toward older rows, positive toward newer. */
  readonly notches: number
  /** Whether the chunk carried any mouse report at all, wheel or not. */
  readonly mouse: boolean
}

/**
 * A fast flick arrives as several SGR reports inside one stdin chunk. Counting
 * every report keeps the scroll proportional to the flick instead of collapsing
 * it to one line — and keeps mouse bytes from ever reaching the composer.
 */
export function parseWheelBurst(input: string): WheelBurst {
  if (input === '') return { notches: 0, mouse: false }
  let notches = 0
  let mouse = false
  SGR_SCAN.lastIndex = 0
  for (let match = SGR_SCAN.exec(input); match !== null; match = SGR_SCAN.exec(input)) {
    mouse = true
    const wheel = wheelOf(Number(match[1]))
    if (wheel === 'up') notches -= 1
    else if (wheel === 'down') notches += 1
  }
  if (mouse) return { notches, mouse }
  for (let index = input.indexOf(X10_PREFIX); index >= 0 && index + X10_PREFIX.length + 2 < input.length;) {
    mouse = true
    const wheel = wheelOf(input.charCodeAt(index + X10_PREFIX.length) - 32)
    if (wheel === 'up') notches -= 1
    else if (wheel === 'down') notches += 1
    index = input.indexOf(X10_PREFIX, index + X10_PREFIX.length + 3)
  }
  return { notches, mouse }
}

export function isMouseNoise(input: string): boolean {
  return parseWheel(input) !== undefined
}

export interface MouseReport {
  /** Press and release bracket a drag; motion reports carry the held button. */
  readonly kind: 'press' | 'release' | 'motion'
  /** 0 left · 1 middle · 2 right (modifier bits already stripped). */
  readonly button: number
  /** One-based terminal column. */
  readonly x: number
  /** One-based terminal row. */
  readonly y: number
}

/**
 * Decode SGR mouse reports (`?1006` mode) from one stdin chunk: clicks,
 * releases, and — because the app enables `?1002` — drag motion. Wheel codes
 * (64+) are skipped here; `parseWheelBurst` owns those.
 */
export function parseMouseBurst(input: string): MouseReport[] {
  if (input === '') return []
  const reports: MouseReport[] = []
  SGR_REPORT.lastIndex = 0
  for (let match = SGR_REPORT.exec(input); match !== null; match = SGR_REPORT.exec(input)) {
    const raw = Number(match[1])
    const button = raw & 3
    const x = Number(match[2])
    const y = Number(match[3])
    if (raw >= 64) continue // wheel
    if (raw >= 32) reports.push({ kind: 'motion', button, x, y })
    else reports.push({ kind: match[4] === 'M' ? 'press' : 'release', button, x, y })
  }
  return reports
}
