import { Alert, Anchor, Loader, Stack, Text, Title } from '@mantine/core'
import { isFlowControlError } from '@mokei/flow-client'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { ApprovalCard } from '../components/ApprovalCard.js'
import { SchemaForm } from '../components/SchemaForm.js'
import { useFlow } from '../flow/FlowProvider.js'
import { useInboxItem } from '../flow/useInboxItem.js'
import { usePresence } from '../presence/PresenceProvider.js'

function InboxItemPage() {
  const { itemID } = Route.useParams()
  return <InboxItemDetail key={itemID} itemID={itemID} />
}

function InboxItemDetail({ itemID }: { itemID: string }) {
  const { control, connected, status } = useFlow()
  const { item, outcome, loading, error } = useInboxItem(itemID)
  const { setActiveItem } = usePresence()
  const [busy, setBusy] = useState(false)
  const [settled, setSettled] = useState(false)
  const [errors, setErrors] = useState<Array<string>>([])
  const ready = connected && status?.state === 'ready'
  useEffect(() => {
    setActiveItem(itemID)
    return () => setActiveItem(undefined)
  }, [itemID, setActiveItem])
  async function act(action: 'answer' | 'decline' | 'cancel', values?: Record<string, unknown>) {
    if (!ready || busy || settled || outcome != null) return
    setBusy(true)
    setErrors([])
    try {
      if (action === 'answer') {
        if (values === undefined) await control.inbox.answer(itemID)
        else await control.inbox.answer(itemID, values)
      } else await control.inbox[action](itemID)
      setSettled(true)
    } catch (error) {
      if (isFlowControlError(error, 'INBOX_ITEM_NOT_FOUND')) setSettled(true)
      else {
        const issues = isFlowControlError(error) ? error.data?.issues : undefined
        setErrors(
          Array.isArray(issues) && issues.every((issue) => typeof issue === 'string')
            ? issues
            : [error instanceof Error ? error.message : String(error)],
        )
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <Stack>
      <Title order={1}>Inbox item</Title>
      {outcome != null ? (
        <Text>Outcome: {outcome}</Text>
      ) : settled ? (
        <Text>This item is already settled.</Text>
      ) : error != null ? (
        <Alert color="red">{String(error)}</Alert>
      ) : !ready ? (
        <Text c="dimmed">Waiting for the flow service.</Text>
      ) : loading ? (
        <Loader aria-label="Loading inbox item" />
      ) : item == null ? (
        <Text c="dimmed">No longer pending</Text>
      ) : (
        <>
          <Anchor
            renderRoot={(props) => (
              <Link {...props} to="/runs/$runID" params={{ runID: item.runID }} />
            )}>
            {item.runID}
          </Anchor>
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
        </>
      )}
    </Stack>
  )
}

export const Route = createFileRoute('/inbox/$itemID')({ component: InboxItemPage })
