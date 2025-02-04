import { Alert, Badge, Loader, Table, Title, Tooltip } from '@mantine/core'
import {
  IconMailDown,
  IconMailUp,
  IconPlayerPlay,
  IconPlayerStop,
  IconQuestionMark,
} from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { DateTime } from 'luxon'
import { useEffect, useMemo } from 'react'

import { useHostEvents } from '../hooks.js'
import { useHostInfo } from '../host/hooks.js'

function HomePage() {
  const hostInfo = useHostInfo()
  useEffect(() => {
    if (hostInfo != null) {
      console.log('host info', hostInfo)
    }
  }, [hostInfo])

  const events = useHostEvents()
  console.log('host events from hook', events)

  const eventRows = useMemo(() => {
    return events
      .map((event) => {
        let type = (
          <Badge color="gray" leftSection={<IconQuestionMark />}>
            {event.type}
          </Badge>
        )
        switch (event.type) {
          case 'context:message':
            type =
              event.data.from === 'client' ? (
                <Badge color="blue" leftSection={<IconMailDown />} size="lg">
                  Client message
                </Badge>
              ) : (
                <Badge color="blue" leftSection={<IconMailUp />} size="lg">
                  Server message
                </Badge>
              )
            break
          case 'context:start':
            type = (
              <Badge color="green" leftSection={<IconPlayerPlay />} size="lg">
                Context started
              </Badge>
            )
            break
          case 'context:stop':
            type = (
              <Badge color="orange" leftSection={<IconPlayerStop />} size="lg">
                Context stopped
              </Badge>
            )
            break
        }

        return (
          <Table.Tr key={event.meta.eventID}>
            <Table.Td>
              {DateTime.fromMillis(event.meta.time).toLocaleString(DateTime.TIME_24_WITH_SECONDS)}
            </Table.Td>
            <Table.Td>
              <Tooltip label={event.meta.contextID}>
                <span>{event.meta.contextID.split('-')[0]}</span>
              </Tooltip>
            </Table.Td>
            <Table.Td>{type}</Table.Td>
          </Table.Tr>
        )
      })
      .reverse()
  }, [events])

  return (
    <>
      <Title order={1}>Events stream</Title>
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
      ) : (
        <Alert variant="light" title="Waiting for events" icon={<Loader size="sm" />} />
      )}
    </>
  )
}

export const Route = createFileRoute('/')({
  component: HomePage,
})
