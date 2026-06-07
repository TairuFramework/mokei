import { MultiSelect } from '@inkjs/ui'
import { Box, Text, useInput } from 'ink'

export type ToolOption = {
  id: string
  name: string
  description?: string
  enabled: boolean
}

export type ToolGroup = {
  contextKey: string
  tools: Array<ToolOption>
}

export type ToolSelectCardProps = {
  groups: Array<ToolGroup>
  onConfirm: (enabledIDs: Array<string>) => void
  onCancel: () => void
}

export function ToolSelectCard({ groups, onConfirm, onCancel }: ToolSelectCardProps) {
  useInput((_, key) => {
    if (key.escape) onCancel()
  })
  const options = groups.flatMap((g) =>
    g.tools.map((t) => ({
      label: `${t.id} — ${t.description ?? t.name}`,
      value: t.id,
    })),
  )
  const defaultValue = groups.flatMap((g) => g.tools.filter((t) => t.enabled).map((t) => t.id))
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="blue">
      <Text color="blue">enable tools</Text>
      <MultiSelect options={options} defaultValue={defaultValue} onSubmit={onConfirm} />
      <Text dimColor>[enter] confirm [esc] cancel</Text>
    </Box>
  )
}
