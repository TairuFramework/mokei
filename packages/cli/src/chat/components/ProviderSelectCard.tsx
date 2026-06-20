import { Select } from '@inkjs/ui'
import { Box, Text, useInput } from 'ink'

const PROVIDERS = [
  { label: 'ollama', value: 'ollama' },
  { label: 'openai', value: 'openai' },
  { label: 'anthropic', value: 'anthropic' },
  { label: 'llama', value: 'llama' },
] as const

export type ProviderSelectCardProps = {
  onSelect: (provider: string) => void
  onCancel: () => void
}

export function ProviderSelectCard({ onSelect, onCancel }: ProviderSelectCardProps) {
  useInput((_, key) => {
    if (key.escape) {
      onCancel()
    }
  })
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan">
      <Text color="cyan">select a provider</Text>
      <Select options={[...PROVIDERS]} onChange={(value) => onSelect(value)} />
      <Text dimColor>[esc] quit</Text>
    </Box>
  )
}
