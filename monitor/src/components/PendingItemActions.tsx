import { Alert, Stack, Text } from '@mantine/core'
import { type InboxItem, isFlowControlError } from '@mokei/flow-client'
import { useEffect, useState } from 'react'

import { useFlow } from '../flow/FlowProvider.js'
import { ApprovalCard } from './ApprovalCard.js'
import { SchemaForm } from './SchemaForm.js'

type ActionState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'settled' }
  | { status: 'error'; errors: Array<string> }

export function PendingItemActions({
  item,
  onActiveItemChange,
}: {
  item: InboxItem
  onActiveItemChange?: (itemID?: string) => void
}) {
  const { control, connected, status } = useFlow()
  const itemID = item.id
  const [state, setState] = useState<ActionState>({ status: 'idle' })
  const busy = state.status === 'submitting'
  const settled = state.status === 'settled'
  const errors = state.status === 'error' ? state.errors : []
  const ready = connected && status?.state === 'ready'
  useEffect(() => {
    if (!ready || settled) return
    onActiveItemChange?.(itemID)
    return () => onActiveItemChange?.(undefined)
  }, [itemID, ready, settled, onActiveItemChange])
  async function act(action: 'answer' | 'decline' | 'cancel', values?: Record<string, unknown>) {
    if (!ready || busy || settled) return
    setState({ status: 'submitting' })
    try {
      if (action === 'answer') {
        if (values === undefined) await control.inbox.answer(itemID)
        else await control.inbox.answer(itemID, values)
      } else await control.inbox[action](itemID)
      setState({ status: 'settled' })
    } catch (error) {
      if (isFlowControlError(error, 'INBOX_ITEM_NOT_FOUND')) setState({ status: 'settled' })
      else {
        const issues = isFlowControlError(error) ? error.data?.issues : undefined
        setState({
          status: 'error',
          errors:
            Array.isArray(issues) && issues.every((issue) => typeof issue === 'string')
              ? issues
              : [error instanceof Error ? error.message : String(error)],
        })
      }
    }
  }
  if (settled) return <Text>This item is already settled.</Text>
  if (!ready) return <Text c="dimmed">Waiting for the flow service.</Text>
  return (
    <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
      {item.kind === 'approval' ? (
        <Stack>
          {errors.map((error, index) => (
            <Alert key={`${index}:${error}`} color="red">
              {error}
            </Alert>
          ))}
          <ApprovalCard
            plan={item.plan}
            onApprove={() => void act('answer')}
            onDeny={() => void act('decline')}
          />
        </Stack>
      ) : (
        <Stack>
          <Text>{item.message}</Text>
          <SchemaForm
            schema={item.requestedSchema}
            errors={errors}
            onSubmit={(values) => void act('answer', values)}
            onDecline={() => void act('decline')}
            onCancel={() => void act('cancel')}
          />
        </Stack>
      )}
    </fieldset>
  )
}
