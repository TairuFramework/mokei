import { Box, Text } from 'ink'

export type AssistantMessageProps = { text: string }

export function AssistantMessage({ text }: AssistantMessageProps) {
  return (
    <Box>
      <Text color="green">assistant: </Text>
      <Text>{text}</Text>
    </Box>
  )
}
