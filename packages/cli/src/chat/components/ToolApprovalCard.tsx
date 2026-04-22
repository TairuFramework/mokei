import { Box, Text, useInput } from 'ink'

export type ToolCallRef = {
  id: string
  name: string
  arguments: string
}

export type ToolApprovalCardProps = {
  call: ToolCallRef
  onApprove: () => void
  onDeny: () => void
}

export function ToolApprovalCard({ call, onApprove, onDeny }: ToolApprovalCardProps) {
  useInput((input, key) => {
    if (key.escape) {
      onDeny()
      return
    }
    const ch = input.toLowerCase()
    if (ch === 'y' || key.return) onApprove()
    else if (ch === 'n') onDeny()
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow">
      <Text color="yellow">approve tool call?</Text>
      <Text>tool: {call.name}</Text>
      <Text>args: {call.arguments}</Text>
      <Text dimColor>[y] approve [n / esc] deny</Text>
    </Box>
  )
}
