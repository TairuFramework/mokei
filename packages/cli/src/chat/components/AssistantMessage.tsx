import { Text } from 'ink'

export type AssistantMessageProps = { text: string }

export function AssistantMessage({ text }: AssistantMessageProps) {
  // Single Text so the label flows inline with the body and the whole block
  // wraps across the full terminal width over multiple lines.
  return (
    <Text>
      <Text color="green">assistant: </Text>
      {text}
    </Text>
  )
}
