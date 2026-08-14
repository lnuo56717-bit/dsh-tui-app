import React, { useMemo, useState, useSyncExternalStore } from 'react'
import { Box, Text, useApp, useInput, useWindowSize } from 'ink'
import type { TuiStartupValues } from '../startup.js'
import { TranscriptStore } from '../transcript-store.js'
import { Logo } from './logo.js'
import { resolveTheme } from './theme.js'
import { TranscriptView } from './transcript-view.js'

export interface ShellProps extends TuiStartupValues {
  store?: TranscriptStore
  sessionId?: string
  model?: string
}

const EMPTY_STORE = new TranscriptStore()

export function Shell(props: ShellProps): React.JSX.Element {
  const { exit } = useApp()
  const { columns = 80, rows = 24 } = useWindowSize()
  const theme = useMemo(() => resolveTheme(props.theme, props.color), [props.theme, props.color])
  const store = props.store ?? EMPTY_STORE
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [scrollOffset, setScrollOffset] = useState(0)
  const compact = columns < 72 || rows < 22
  const nodeBudget = Math.max(1, rows - (compact ? 9 : 19))

  useInput((input, key) => {
    if (input === 'q' || key.escape || (key.ctrl && input === 'c')) exit()
    else if (key.pageUp || (key.ctrl && input === 'u')) {
      setScrollOffset(value => Math.min(Math.max(0, state.nodes.length - 1), value + nodeBudget))
    }
    else if (key.pageDown || (key.ctrl && input === 'd')) setScrollOffset(value => Math.max(0, value - nodeBudget))
    else if (key.end) setScrollOffset(0)
  })

  return (
    <Box width={columns} height={rows} flexDirection="column" backgroundColor={theme.canvas}>
      <Box paddingX={2} paddingTop={compact ? 0 : 1} alignItems="center">
        {!compact && state.nodes.length === 0 && <Logo theme={theme} monochrome={props.color === 'none'} />}
        <Box marginLeft={!compact && state.nodes.length === 0 ? 3 : 0} flexDirection="column">
          <Text bold color={theme.text}>DEEPSEEK / HARNESS</Text>
          <Text color={theme.accent}>TUI event console</Text>
          <Text color={theme.muted}>M2 renderer · streaming / tools / diffs</Text>
        </Box>
      </Box>

      <Box marginX={2} marginTop={1} borderStyle="single" borderColor={theme.border} flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
        <Box><Text color={theme.primary}>◆ </Text><Text bold color={theme.text}>TRANSCRIPT</Text><Text color={theme.muted}>  seq {state.lastSeq < 0 ? '—' : state.lastSeq}{state.gap === undefined ? '' : ` · resnapshot ${state.gap.expected}→${state.gap.received}`}</Text></Box>
        <Box marginTop={1} flexDirection="column" overflow="hidden">
          <TranscriptView state={state} width={Math.max(10, columns - 8)} nodeBudget={nodeBudget} offset={Math.max(0, scrollOffset)} theme={theme} />
        </Box>
      </Box>

      <Box paddingX={2} justifyContent="space-between">
        <Text color={theme.muted}>{props.model ?? 'model —'}  session {props.sessionId ?? props.resume ?? 'new'}  cwd {process.cwd()}</Text>
        <Text color={theme.accent}>PgUp/PgDn scroll  q/esc quit</Text>
      </Box>
    </Box>
  )
}
