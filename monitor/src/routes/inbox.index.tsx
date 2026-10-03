import { Alert, Anchor, Loader, Stack, Table, Text, Title } from '@mantine/core'
import { createFileRoute, Link } from '@tanstack/react-router'

import { useFlow } from '../flow/FlowProvider.js'
import { useInbox } from '../flow/useInbox.js'

function InboxPage() {
  const { items, loading, error } = useInbox()
  const { connected, status } = useFlow()
  return (
    <Stack>
      <Title order={1}>Inbox</Title>
      {error != null ? (
        <Alert color="red" title="Inbox request failed">
          {String(error)}
        </Alert>
      ) : !connected || status?.state !== 'ready' ? (
        <Text c="dimmed">Waiting for the flow service.</Text>
      ) : loading ? (
        <Loader aria-label="Loading inbox" />
      ) : items.length === 0 ? (
        <Text c="dimmed">No pending items.</Text>
      ) : null}
      {items.length === 0 ? null : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Kind</Table.Th>
              <Table.Th>Run</Table.Th>
              <Table.Th>Message or plan tools</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((item) => (
              <Table.Tr key={item.id}>
                <Table.Td>{item.kind}</Table.Td>
                <Table.Td>
                  <Anchor
                    renderRoot={(props) => (
                      <Link {...props} to="/runs/$runID" params={{ runID: item.runID }} />
                    )}>
                    {item.runID}
                  </Anchor>
                </Table.Td>
                <Table.Td>
                  <Anchor
                    renderRoot={(props) => (
                      <Link {...props} to="/inbox/$itemID" params={{ itemID: item.id }} />
                    )}>
                    {item.kind === 'input'
                      ? item.message
                      : item.plan.tools.join(', ') || 'Approval requested'}
                  </Anchor>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  )
}

export const Route = createFileRoute('/inbox/')({ component: InboxPage })
