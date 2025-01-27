import { Badge, Table } from '@mantine/core'
import {
  IconMailDown,
  IconMailUp,
  IconPlayerPlay,
  IconPlayerStop,
  IconQuestionMark,
} from '@tabler/icons-react'
import { createLazyFileRoute } from '@tanstack/react-router'
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
    return events.map((event) => {
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
            <Badge color="green" leftSection={<IconPlayerStop />} size="lg">
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
          <Table.Td>{type}</Table.Td>
        </Table.Tr>
      )
    })
  }, [events])

  return (
    <div className="p-2">
      <h3>Events stream</h3>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Time</Table.Th>
            <Table.Th>Type</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>{eventRows}</Table.Tbody>
      </Table>
    </div>
  )
}

export const Route = createLazyFileRoute('/')({
  component: HomePage,
})
