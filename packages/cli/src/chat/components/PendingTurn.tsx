import { Box } from 'ink'

import { useElapsed } from '../hooks/useElapsed.js'
import type { PendingApproval } from '../hooks/useToolApproval.js'
import type { TurnState } from '../turn-reducer.js'
import { AssistantStreamingText } from './AssistantStreamingText.js'
import { ToolApprovalCard } from './ToolApprovalCard.js'
import { ToolCallStatus } from './ToolCallStatus.js'
import { WaitingStatus } from './WaitingStatus.js'

export type PendingTurnProps = {
  turn: TurnState
  pending: PendingApproval | null
  onApprove: () => void
  onDeny: () => void
}

export function PendingTurn({ turn, pending, onApprove, onDeny }: PendingTurnProps) {
  const waiting = turn.state === 'streaming' && turn.currentText === ''
  const calling = turn.state === 'calling-tool' && turn.activeToolCall != null
  // Hook called unconditionally; the arg gates the interval (React hook rules).
  const now = useElapsed(waiting || calling)

  if (turn.state === 'idle') return null

  return (
    <Box flexDirection="column">
      {turn.currentText !== '' ? <AssistantStreamingText text={turn.currentText} /> : null}
      {waiting ? (
        <WaitingStatus
          elapsedMs={turn.streamStartedAt != null ? now - turn.streamStartedAt : undefined}
        />
      ) : null}
      {turn.state === 'awaiting-approval' && pending != null ? (
        <ToolApprovalCard call={pending.call} onApprove={onApprove} onDeny={onDeny} />
      ) : null}
      {calling && turn.activeToolCall != null ? (
        <ToolCallStatus
          name={turn.activeToolCall.call.name}
          phase="calling"
          elapsedMs={now - turn.activeToolCall.startedAt}
        />
      ) : null}
    </Box>
  )
}
