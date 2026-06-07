import { Box, Text } from 'ink'

export type ToolResultOutcome = 'error' | 'timeout' | 'cancelled'

export type ToolResultCardProps = {
  name: string
  result?: string
  error?: string
  outcome?: ToolResultOutcome
  durationMs?: number
}

/** Max width for the collapsed single-line error before it is truncated. */
const MAX_ERROR_LINE = 160

function firstLine(text: string): { line: string; hasMore: boolean } {
  const lines = text.split('\n')
  const raw = lines[0] ?? ''
  const multiLine = lines.length > 1
  if (raw.length > MAX_ERROR_LINE) {
    return { line: `${raw.slice(0, MAX_ERROR_LINE)}…`, hasMore: true }
  }
  return { line: raw, hasMore: multiLine }
}

const OUTCOME_LABEL: Record<ToolResultOutcome, string> = {
  error: 'error',
  timeout: 'timed out',
  cancelled: 'cancelled',
}

export function ToolResultCard({ name, result, error, outcome, durationMs }: ToolResultCardProps) {
  const isError = error != null
  const kind: ToolResultOutcome = outcome ?? 'error'
  const duration = durationMs != null ? ` · ${(durationMs / 1000).toFixed(1)}s` : ''

  let body = result ?? ''
  let hint = ''
  if (isError) {
    const { line, hasMore } = firstLine(error)
    body = kind === 'error' ? line : `${OUTCOME_LABEL[kind]} — ${line}`
    hint = hasMore ? '  (/details for full text)' : ''
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={isError ? 'red' : 'gray'}>
      <Text color={isError ? 'red' : 'yellow'}>
        tool · {name}
        {duration}
      </Text>
      <Text>
        {body}
        {hint ? <Text dimColor>{hint}</Text> : null}
      </Text>
    </Box>
  )
}
