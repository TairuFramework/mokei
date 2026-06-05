import { Box, Text, useInput } from 'ink'

export type ConfirmCardProps = {
  message: string
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export function ConfirmCard({ message, onConfirm, onCancel }: ConfirmCardProps) {
  useInput((input, key) => {
    if (key.escape) {
      onCancel()
      return
    }
    const ch = input.toLowerCase()
    if (ch === 'y' || key.return) onConfirm()
    else if (ch === 'n') onCancel()
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow">
      <Text color="yellow">{message}</Text>
      <Text dimColor>[y / enter] confirm [n / esc] cancel</Text>
    </Box>
  )
}
