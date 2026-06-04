import { Text } from 'ink'

export type AssistantStreamingTextProps = { text: string }

export function AssistantStreamingText({ text }: AssistantStreamingTextProps) {
  // Single Text so the label flows inline and the body wraps full width.
  return (
    <Text>
      <Text color="green">assistant: </Text>
      {text}
    </Text>
  )
}
