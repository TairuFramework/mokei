import { Select } from '@inkjs/ui'
import { Box, Text, useApp, useInput } from 'ink'

const PROVIDERS = [
  { label: 'ollama', value: 'ollama' },
  { label: 'openai', value: 'openai' },
  { label: 'anthropic', value: 'anthropic' },
] as const

export type ProviderSelectCardProps = {
  onSelect: (provider: string) => void
  onCancel: () => void
}

export function ProviderSelectCard({ onSelect, onCancel }: ProviderSelectCardProps) {
  const { exit } = useApp()
  useInput((_, key) => {
    if (key.escape) {
      onCancel()
      exit()
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
