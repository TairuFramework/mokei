import { TextInput } from '@inkjs/ui'
import { Box, Text, useInput } from 'ink'

export type LlamaPathCardProps = {
  onSubmit: (path: string) => void
  onCancel: () => void
}

export function LlamaPathCard({ onSubmit, onCancel }: LlamaPathCardProps) {
  useInput((_, key) => {
    if (key.escape) {
      onCancel()
    }
  })
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan">
      <Text color="cyan">enter GGUF model path</Text>
      <Box>
        <Text color="cyan">› </Text>
        <TextInput
          placeholder="/path/to/model.gguf"
          onSubmit={(value) => {
            const trimmed = value.trim()
            if (trimmed !== '') {
              onSubmit(trimmed)
            }
          }}
        />
      </Box>
      <Text dimColor>[enter] confirm [esc] quit</Text>
    </Box>
  )
}
