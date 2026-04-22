import { Select } from '@inkjs/ui'
import { Box, Text, useInput } from 'ink'

export type ModelOption = { id: string }

export type ModelSelectCardProps = {
  models: Array<ModelOption>
  onSelect: (id: string) => void
  onCancel: () => void
}

export function ModelSelectCard({ models, onSelect, onCancel }: ModelSelectCardProps) {
  useInput((_, key) => {
    if (key.escape) onCancel()
  })
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta">
      <Text color="magenta">select a model</Text>
      <Select
        options={models.map((m) => ({ label: m.id, value: m.id }))}
        onChange={(value) => onSelect(value)}
      />
      <Text dimColor>[esc] cancel</Text>
    </Box>
  )
}
