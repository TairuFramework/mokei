import {
  Alert,
  Button,
  Code,
  Drawer,
  Loader,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core'
import type { HostEvent } from '@mokei/host-protocol'
import { createFileRoute } from '@tanstack/react-router'
import { DateTime } from 'luxon'
import { useEffect, useMemo, useState } from 'react'

import EventBadge from '../components/EventBadge.js'
import { useEnvironment } from '../enkaku/context.js'
import { useHostEvents } from '../hooks.js'
import { useHostInfo } from '../host/hooks.js'

function getEventTime(event: HostEvent): string {
  return DateTime.fromMillis(event.meta.time).toLocaleString(DateTime.TIME_24_WITH_SECONDS)
}

function EventDetails({ event }: { event: HostEvent }) {
  switch (event.type) {
    case 'context:start':
      return (
        <Stack>
          <EventBadge event={event} />
          <Text>
            <Text component="span" fw="bold">
              Context ID:
            </Text>{' '}
            {event.meta.contextID}
          </Text>
          <Text>
            <Text component="span" fw="bold">
              Event ID:
            </Text>{' '}
            {event.meta.eventID}
          </Text>
          <Text>
            <Text component="span" fw="bold">
              Time:
            </Text>{' '}
            {getEventTime(event)}
          </Text>

          <Text>
            <Text component="span" fw="bold">
              Command:
            </Text>{' '}
            <Code>{event.data.command}</Code>
          </Text>
          <Text>
            <Text component="span" fw="bold">
              Arguments:
            </Text>{' '}
            {event.data.args.length ? <Code>{event.data.args.join(', ')}</Code> : '(none)'}
          </Text>
        </Stack>
      )
    case 'context:stop':
      return (
        <Stack>
          <EventBadge event={event} />
          <Text>
            <Text component="span" fw="bold">
              Context ID:
            </Text>{' '}
            {event.meta.contextID}
          </Text>
          <Text>
            <Text component="span" fw="bold">
              Event ID:
            </Text>{' '}
            {event.meta.eventID}
          </Text>
          <Text>
            <Text component="span" fw="bold">
              Time:
            </Text>{' '}
            {getEventTime(event)}
          </Text>
        </Stack>
      )
    case 'context:message':
      return (
        <Stack>
          <EventBadge event={event} />
          <Text>
            <Text component="span" fw="bold">
              Context ID:
            </Text>{' '}
            {event.meta.contextID}
          </Text>
          <Text>
            <Text component="span" fw="bold">
              Event ID:
            </Text>{' '}
            {event.meta.eventID}
          </Text>
          <Text>
            <Text component="span" fw="bold">
              Time:
            </Text>{' '}
            {getEventTime(event)}
          </Text>

          <Code block>{JSON.stringify(event.data.message, null, 2)}</Code>
        </Stack>
      )
  }
}

function HomePage() {
  const env = useEnvironment()

  const hostInfo = useHostInfo()
  useEffect(() => {
    if (hostInfo != null) {
      console.log('host info', hostInfo)
    }
  }, [hostInfo])

  const events = useHostEvents()
  console.log('host events from hook', events)

  const [displayEventDetails, setDisplayEventDetails] = useState<HostEvent | null>(null)

  const eventRows = useMemo(() => {
    return events
      .map((event) => {
        return (
          <Table.Tr
            key={event.meta.eventID}
            onClick={() => setDisplayEventDetails(event)}
            style={{ cursor: 'pointer' }}>
            <Table.Td>{getEventTime(event)}</Table.Td>
            <Table.Td>
              <Tooltip label={event.meta.contextID}>
                <span>{event.meta.contextID.split('-')[0]}</span>
              </Tooltip>
            </Table.Td>
            <Table.Td>
              <EventBadge event={event} />
            </Table.Td>
          </Table.Tr>
        )
      })
      .reverse()
  }, [events])

  const alert =
    env.status === 'connected' ? (
      <Alert
        variant="light"
        title={events.length === 0 ? 'Waiting for events...' : 'Receiving events...'}
        icon={<Loader size="sm" />}
      />
    ) : (
      <Alert color="red" variant="light" title="Client disconnected">
        {env.reason instanceof Error ? <Text>{env.reason.message}</Text> : null}
        <Button onClick={() => env.connect()}>Reconnect</Button>
      </Alert>
    )

  return (
    <>
      <Drawer
        opened={displayEventDetails !== null}
        onClose={() => setDisplayEventDetails(null)}
        position="right"
        title={<Title order={2}>Event details</Title>}>
        {displayEventDetails ? <EventDetails event={displayEventDetails} /> : null}
      </Drawer>
      <Title order={1}>Events stream</Title>
      {alert}
      {eventRows.length ? (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Time</Table.Th>
              <Table.Th>Context</Table.Th>
              <Table.Th>Type</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>{eventRows}</Table.Tbody>
        </Table>
      ) : null}
    </>
  )
}

export const Route = createFileRoute('/')({
  component: HomePage,
})
