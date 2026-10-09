import { JsonViewer } from '@mantine/code-highlight'
import { Code, Text } from '@mantine/core'

export type JsonPayloadProps = { value: unknown; empty?: string; label?: string }

// Key by item identity at call sites to reapply the initial expansion depth.
export function JsonPayload({ value, empty, label }: JsonPayloadProps) {
  if (value === undefined) return <Text>{empty}</Text>
  let content = value
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      if (parsed !== null && typeof parsed === 'object') content = parsed
    } catch {
      // Truncated payloads must remain readable as raw text.
    }
    if (typeof content === 'string') return <Code block>{value}</Code>
  }
  // Scalars need no tree: keep attribute lists compact.
  if (content === null || typeof content !== 'object') {
    return <Code block>{JSON.stringify(content)}</Code>
  }
  return (
    <JsonViewer
      value={content}
      rootName={label}
      defaultExpandDepth={2}
      withCopy
      withSize
      withControls
      withChevrons
      collapseStringsAfterLength={200}
      groupArraysAfterLength={50}
    />
  )
}
