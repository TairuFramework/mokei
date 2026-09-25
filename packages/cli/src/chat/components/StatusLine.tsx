import { Spinner } from '@inkjs/ui'
import { Box, Text } from 'ink'

import type { TurnStateName } from '../turn-reducer.js'

export type StatusLineProps = {
  model: string
  state: TurnStateName
  contexts: Array<string>
}

export function StatusLine({ model, state, contexts }: StatusLineProps) {
  const busy = state !== 'idle'
  return (
    <Box>
      {busy ? <Spinner /> : null}
      <Text color="magenta"> {model} </Text>
      <Text color="gray">· {state} </Text>
      {contexts.length > 0 ? <Text color="blue">· ctx: {contexts.join(',')}</Text> : null}
    </Box>
  )
}
