import { Spinner } from '@inkjs/ui'
import { Box, Text } from 'ink'

import { HANG_WARN_MS } from './ToolCallStatus.js'

export type WaitingStatusProps = {
  elapsedMs?: number
}

/**
 * Spinner shown while waiting for the model's first token. Surfaces elapsed
 * seconds and a hang warning so a slow or stuck generation is visible — the
 * model-streaming counterpart to ToolCallStatus.
 */
export function WaitingStatus({ elapsedMs }: WaitingStatusProps) {
  const stuck = elapsedMs != null && elapsedMs >= HANG_WARN_MS
  const seconds = elapsedMs != null ? `${Math.floor(elapsedMs / 1000)}s` : null
  return (
    <Box>
      <Spinner />
      <Text dimColor={!stuck} color={stuck ? 'red' : undefined}>
        {' '}
        waiting for response…
        {seconds != null ? ` (${seconds})` : ''}
        {stuck ? ' — may be stuck — esc to cancel' : ''}
      </Text>
    </Box>
  )
}
