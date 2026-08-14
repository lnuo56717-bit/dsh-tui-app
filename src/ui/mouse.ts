export type WheelDirection = 'up' | 'down'

const SGR = /^(?:\u001B\[|<)?\[?<(\d+);\d+;\d+[Mm]$/u
const SGR_SCAN = /<(\d+);\d+;\d+[Mm]/gu
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
