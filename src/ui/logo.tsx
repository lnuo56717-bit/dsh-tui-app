import React from 'react'
import { Box, Text } from 'ink'
import { LOGO_LINES, MONO_LOGO_LINES } from './logo.generated.js'
import type { Theme } from './theme.js'

export function Logo({ theme, monochrome = false }: { theme: Theme; monochrome?: boolean }): React.JSX.Element {
  if (monochrome) {
    return <Box flexDirection="column">{MONO_LOGO_LINES.map((line, index) => <Text key={index} color={theme.primary}>{line}</Text>)}</Box>
  }
  return (
    <Box flexDirection="column">
      {LOGO_LINES.map((line, lineIndex) => (
        <Text key={lineIndex}>{line.map((segment, segmentIndex) => (
          <Text key={segmentIndex} {...(segment.color === undefined ? {} : { color: segment.color })}>{segment.text}</Text>
        ))}</Text>
      ))}
    </Box>
  )
}
