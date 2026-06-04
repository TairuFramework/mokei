import { Text } from 'ink'

export type UserMessageProps = { text: string }

export function UserMessage({ text }: UserMessageProps) {
  // Single Text so the marker flows inline and the body wraps full width.
  return (
    <Text>
      <Text color="cyan">› </Text>
      {text}
    </Text>
  )
}
