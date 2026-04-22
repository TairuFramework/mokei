import { Box, Text } from 'ink'

export type AssistantStreamingTextProps = { text: string }

export function AssistantStreamingText({ text }: AssistantStreamingTextProps) {
  return (
    <Box>
      <Text color="green">assistant: </Text>
      <Text>{text}</Text>
    </Box>
  )
}
