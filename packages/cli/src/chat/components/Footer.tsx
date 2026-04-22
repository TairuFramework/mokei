import { TextInput } from '@inkjs/ui'
import { Box, Text } from 'ink'

import type { TurnStateName } from '../turn-reducer.js'
import { StatusLine } from './StatusLine.js'

export type FooterProps = {
  model: string
  state: TurnStateName
  contexts: Array<string>
  onSubmit: (value: string) => void
  placeholder?: string
}

export function Footer({ model, state, contexts, onSubmit, placeholder }: FooterProps) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <StatusLine model={model} state={state} contexts={contexts} />
      <Box>
        <Text color="cyan">› </Text>
        <TextInput placeholder={placeholder ?? 'type a message or /help'} onSubmit={onSubmit} />
      </Box>
    </Box>
  )
}
