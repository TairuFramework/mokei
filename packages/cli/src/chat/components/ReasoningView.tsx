import { Spinner } from '@inkjs/ui'
import { Box, Text } from 'ink'

import { HANG_WARN_MS } from './ToolCallStatus.js'

/** Number of trailing reasoning lines kept visible (bounds the live height). */
export const MAX_REASONING_LINES = 6

export type ReasoningViewProps = {
  reasoning: string
  elapsedMs?: number
}

/**
 * Ephemeral view of the model's reasoning (thinking) while it streams, shown
 * dimmed and capped to the last few lines. Surfaces elapsed time and a hang
 * warning, so reasoning models no longer look stalled while they think.
 */
export function ReasoningView({ reasoning, elapsedMs }: ReasoningViewProps) {
  const stuck = elapsedMs != null && elapsedMs >= HANG_WARN_MS
  const seconds = elapsedMs != null ? `${Math.floor(elapsedMs / 1000)}s` : null
  const tail = reasoning.split('\n').slice(-MAX_REASONING_LINES).join('\n')
  return (
    <Box flexDirection="column">
      <Box>
        <Spinner />
        <Text color={stuck ? 'red' : 'magenta'}>
          {' '}
          thinking…
          {seconds != null ? ` (${seconds})` : ''}
          {stuck ? ' — may be stuck — esc to cancel' : ''}
        </Text>
      </Box>
      <Text dimColor>{tail}</Text>
    </Box>
  )
}
