import { TextInput } from '@inkjs/ui'
import { Box, Text } from 'ink'
import { useMemo, useState } from 'react'

import { matchSlashCommands, SLASH_COMMANDS } from '../slash.js'
import type { TurnStateName } from '../turn-reducer.js'
import { SlashSuggestions } from './SlashSuggestions.js'
import { StatusLine } from './StatusLine.js'

export type FooterProps = {
  model: string
  state: TurnStateName
  contexts: Array<string>
  onSubmit: (value: string) => void
  placeholder?: string
  disabled?: boolean
}

const COMMAND_SUGGESTIONS = SLASH_COMMANDS.map((c) => `/${c.name}`)

export function Footer({ model, state, contexts, onSubmit, placeholder, disabled }: FooterProps) {
  const [value, setValue] = useState('')
  const [submitSeq, setSubmitSeq] = useState(0)

  const suggestions = useMemo(() => matchSlashCommands(value), [value])

  const handleSubmit = (v: string) => {
    setValue('')
    setSubmitSeq((n) => n + 1)
    onSubmit(v)
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <SlashSuggestions items={suggestions} />
      <StatusLine model={model} state={state} contexts={contexts} />
      {disabled ? null : (
        <Box>
          <Text color="cyan">› </Text>
          <TextInput
            key={submitSeq}
            placeholder={placeholder ?? 'type a message or /help'}
            suggestions={COMMAND_SUGGESTIONS}
            onChange={setValue}
            onSubmit={handleSubmit}
          />
        </Box>
      )}
    </Box>
  )
}
