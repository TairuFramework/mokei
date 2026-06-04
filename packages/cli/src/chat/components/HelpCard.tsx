import { Box, Text, useInput } from 'ink'

export type HelpCardProps = {
  onClose: () => void
}

export function HelpCard({ onClose }: HelpCardProps) {
  useInput((_, key) => {
    if (key.escape || key.return) onClose()
  })
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan">
      <Text color="cyan">commands</Text>
      <Text>/help show this help</Text>
      <Text>/context list contexts</Text>
      <Text>/context add KEY CMD ... add MCP context</Text>
      <Text>/context remove KEY remove context</Text>
      <Text>/model [id] pick or switch model</Text>
      <Text>/tools enable/disable tools</Text>
      <Text>/details show full text of the last error</Text>
      <Text>/reasoning [on|off] toggle model reasoning display</Text>
      <Text>/quit, /exit end session</Text>
      <Text>esc cancel active tool, else abort turn</Text>
      <Text dimColor>[esc / enter] close</Text>
    </Box>
  )
}
