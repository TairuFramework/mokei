import { Spinner } from '@inkjs/ui'
import { Box, Text } from 'ink'

export type ToolCallStatusProps = {
  name: string
  phase: 'calling' | 'done' | 'failed'
}

export function ToolCallStatus({ name, phase }: ToolCallStatusProps) {
  return (
    <Box>
      {phase === 'calling' ? <Spinner /> : <Text>· </Text>}
      <Text color={phase === 'failed' ? 'red' : 'yellow'}>
        {' '}
        {phase} {name}
      </Text>
    </Box>
  )
}
