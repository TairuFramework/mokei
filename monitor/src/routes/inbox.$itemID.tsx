import { Alert, Anchor, Loader, Stack, Text, Title } from '@mantine/core'
import { createFileRoute, Link } from '@tanstack/react-router'

import { PendingItemActions } from '../components/PendingItemActions.js'
import { useFlow } from '../flow/FlowProvider.js'
import { useInboxItem } from '../flow/useInboxItem.js'
import { usePresence } from '../presence/PresenceProvider.js'

function InboxItemPage() {
  const { itemID } = Route.useParams()
  return <InboxItemDetail key={itemID} itemID={itemID} />
}

function InboxItemDetail({ itemID }: { itemID: string }) {
  const { connected, status } = useFlow()
  const { item, outcome, loading, error } = useInboxItem(itemID)
  const { setActiveItem } = usePresence()
  const ready = connected && status?.state === 'ready'
  return (
    <Stack>
      <Title order={1}>Inbox item</Title>
      {outcome != null ? (
        <Text>Outcome: {outcome}</Text>
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
          <PendingItemActions key={item.id} item={item} onActiveItemChange={setActiveItem} />
        </>
      )}
    </Stack>
  )
}

export const Route = createFileRoute('/inbox/$itemID')({ component: InboxItemPage })
