const ENTER_ALT = '\u001B[?1049h\u001B[?25l'
const RESET_CURSOR_COLOR = '\u001B]112\u0007'
const LEAVE_ALT = `${RESET_CURSOR_COLOR}\u001B[?25h\u001B[?1049l`

export interface TerminalLease {
  release(): void
}

export function enterFullscreen(output: Pick<NodeJS.WriteStream, 'write'> = process.stdout): TerminalLease {
  let active = true
  output.write(ENTER_ALT)
  return {
    release(): void {
      if (!active) return
      active = false
      output.write(LEAVE_ALT)
    },
  }
}

export const terminalSequences = { ENTER_ALT, RESET_CURSOR_COLOR, LEAVE_ALT }
