import React, { useMemo } from 'react'
import { Box, Text, useApp, useInput, useWindowSize } from 'ink'
import type { TuiStartupValues } from '../startup.js'
import type { TranscriptLine } from '../transcript-fold.js'
import { Logo } from './logo.js'
import { resolveTheme } from './theme.js'

export interface ShellProps extends TuiStartupValues {
  lines?: readonly TranscriptLine[]
}

const SAMPLE_LINES: readonly TranscriptLine[] = [
  { seq: 0, role: 'system', text: 'Event plane ready · waiting for a session' },
]

export function Shell(props: ShellProps): React.JSX.Element {
  const { exit } = useApp()
  const { columns = 80, rows = 24 } = useWindowSize()
  const theme = useMemo(() => resolveTheme(props.theme, props.color), [props.theme, props.color])
  const lines = props.lines ?? SAMPLE_LINES
  const compact = columns < 72 || rows < 22
  useInput((input, key) => {
    if (input === 'q' || key.escape || (key.ctrl && input === 'c')) exit()
  })

  return (
    <Box width={columns} height={rows} flexDirection="column" backgroundColor={theme.canvas}>
      <Box paddingX={2} paddingTop={compact ? 0 : 1} alignItems="center">
        {!compact && <Logo theme={theme} monochrome={props.color === 'none'} />}
        <Box marginLeft={compact ? 0 : 3} flexDirection="column">
          <Text bold color={theme.text}>DEEPSEEK / HARNESS</Text>
          <Text color={theme.accent}>TUI event console</Text>
          <Text color={theme.muted}>M1 skeleton · out-of-tree app</Text>
        </Box>
      </Box>

      <Box marginX={2} marginTop={1} borderStyle="single" borderColor={theme.border} flexDirection="column" flexGrow={1} paddingX={1}>
        <Box><Text color={theme.primary}>◆ </Text><Text bold color={theme.text}>TRANSCRIPT</Text><Text color={theme.muted}>  durable events / plain text</Text></Box>
        <Box marginTop={1} flexDirection="column">
          {lines.slice(-Math.max(1, rows - (compact ? 9 : 20))).map(line => (
            <Box key={line.seq}>
              <Text color={line.role === 'user' ? theme.user : line.role === 'assistant' ? theme.text : theme.muted}>
                {line.role === 'user' ? 'YOU  ' : line.role === 'assistant' ? 'DS   ' : 'SYS  '}
              </Text>
              <Text color={theme.text}>{line.text}</Text>
            </Box>
          ))}
        </Box>
      </Box>

      <Box paddingX={2} justifyContent="space-between">
        <Text color={theme.muted}>model —  session {props.resume ?? 'new'}  cwd {process.cwd()}</Text>
        <Text color={theme.accent}>q / esc  quit</Text>
      </Box>
    </Box>
  )
}
