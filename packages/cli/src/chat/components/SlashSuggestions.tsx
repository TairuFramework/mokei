import { Box, Text } from 'ink'

import type { SlashCommandInfo } from '../slash.js'

export type SlashSuggestionsProps = {
  items: ReadonlyArray<SlashCommandInfo>
}

export function SlashSuggestions({ items }: SlashSuggestionsProps) {
  if (items.length === 0) return null
  return (
    <Box flexDirection="column" paddingX={1}>
      {items.map((c) => (
        <Box key={c.name}>
          <Text color="cyan">/{c.name}</Text>
          <Text dimColor> — {c.description}</Text>
        </Box>
      ))}
    </Box>
  )
}
