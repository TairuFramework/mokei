import { Badge } from '@mantine/core'
import type { RunState } from '@mokei/flow-client'

const colors: Record<RunState, string> = {
  awaiting_approval: 'yellow',
  denied: 'red',
  working: 'blue',
  input_required: 'orange',
  completed: 'green',
  failed: 'red',
  cancelled: 'gray',
}

export function RunStateBadge({ state }: { state: RunState }) {
  return <Badge color={colors[state]}>{state.replaceAll('_', ' ')}</Badge>
}
