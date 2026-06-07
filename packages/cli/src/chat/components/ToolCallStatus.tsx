import { Spinner } from '@inkjs/ui'
import { Box, Text } from 'ink'

/** Elapsed time after which a running tool is flagged as possibly stuck. */
export const HANG_WARN_MS = 10000

export type ToolCallStatusProps = {
  name: string
  phase: 'calling' | 'done' | 'failed'
  elapsedMs?: number
}

export function ToolCallStatus({ name, phase, elapsedMs }: ToolCallStatusProps) {
  const stuck = phase === 'calling' && elapsedMs != null && elapsedMs >= HANG_WARN_MS
  const color = phase === 'failed' || stuck ? 'red' : 'yellow'
  const seconds = elapsedMs != null ? `${Math.floor(elapsedMs / 1000)}s` : null
  return (
    <Box>
      {phase === 'calling' ? <Spinner /> : <Text>· </Text>}
      <Text color={color}>
        {' '}
        {phase} {name}
        {seconds != null ? ` (running ${seconds})` : ''}
        {stuck ? ' — may be stuck — esc to cancel' : ''}
      </Text>
    </Box>
  )
}
