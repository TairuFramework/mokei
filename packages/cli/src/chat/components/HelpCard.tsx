import { Box, Text } from 'ink'

export function HelpCard() {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan">
      <Text color="cyan">commands</Text>
      <Text>/help show this help</Text>
      <Text>/context list contexts</Text>
      <Text>/context add KEY CMD ... add MCP context</Text>
      <Text>/context remove KEY remove context</Text>
      <Text>/model [id] pick or switch model</Text>
      <Text>/tools enable/disable tools</Text>
      <Text>/quit, /exit end session</Text>
      <Text>esc abort current turn</Text>
    </Box>
  )
}
