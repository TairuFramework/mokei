import { Box, Text } from 'ink'

export type UserMessageProps = { text: string }

export function UserMessage({ text }: UserMessageProps) {
  return (
    <Box>
      <Text color="cyan">› </Text>
      <Text>{text}</Text>
    </Box>
  )
}
