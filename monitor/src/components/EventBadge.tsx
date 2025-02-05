import { Badge } from '@mantine/core'
import type { HostEvent } from '@mokei/host-protocol'
import {
  IconMailDown,
  IconMailUp,
  IconPlayerPlay,
  IconPlayerStop,
  IconQuestionMark,
} from '@tabler/icons-react'

export type Props = {
  event: HostEvent
}

export default function EventBadge({ event }: Props) {
  switch (event.type) {
    case 'context:message':
      return event.data.from === 'client' ? (
        <Badge color="blue" leftSection={<IconMailDown />} size="lg">
          Client message
        </Badge>
      ) : (
        <Badge color="blue" leftSection={<IconMailUp />} size="lg">
          Server message
        </Badge>
      )
    case 'context:start':
      return (
        <Badge color="green" leftSection={<IconPlayerPlay />} size="lg">
          Context started
        </Badge>
      )
    case 'context:stop':
      return (
        <Badge color="orange" leftSection={<IconPlayerStop />} size="lg">
          Context stopped
        </Badge>
      )
    default:
      return (
        <Badge color="gray" leftSection={<IconQuestionMark />}>
          {(event as { type: string }).type}
        </Badge>
      )
  }
}
