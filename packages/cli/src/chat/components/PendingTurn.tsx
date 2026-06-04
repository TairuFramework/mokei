import { Box } from 'ink'

import { useElapsed } from '../hooks/useElapsed.js'
import type { PendingApproval } from '../hooks/useToolApproval.js'
import type { TurnState } from '../turn-reducer.js'
import { AssistantStreamingText } from './AssistantStreamingText.js'
import { ReasoningView } from './ReasoningView.js'
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
  const beforeText = turn.state === 'streaming' && turn.currentText === ''
  const thinking = beforeText && turn.currentReasoning !== ''
  const waiting = beforeText && turn.currentReasoning === ''
  const calling = turn.state === 'calling-tool' && turn.activeToolCall != null
  // Hook called unconditionally; the arg gates the interval (React hook rules).
  const now = useElapsed(waiting || thinking || calling)
  const elapsedMs = turn.streamStartedAt != null ? now - turn.streamStartedAt : undefined

  if (turn.state === 'idle') return null

  return (
    <Box flexDirection="column">
      {turn.currentText !== '' ? <AssistantStreamingText text={turn.currentText} /> : null}
      {thinking ? <ReasoningView reasoning={turn.currentReasoning} elapsedMs={elapsedMs} /> : null}
      {waiting ? <WaitingStatus elapsedMs={elapsedMs} /> : null}
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
