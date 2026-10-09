import { Anchor, Badge, Group, Image, Title } from '@mantine/core'
import { Link } from '@tanstack/react-router'

import { useInbox } from '../flow/useInbox.js'

const links: Array<{ label: string; to: string }> = [
  { label: 'Traces', to: '/traces' },
  { label: 'Flows', to: '/flows' },
  { label: 'Inbox', to: '/inbox' },
]

export function AppHeader() {
  const { items } = useInbox()
  return (
    <Group px="md" h="100%" justify="space-between">
      <Group gap="sm">
        <Image
          src="/logo.svg"
          alt="Mokei logo"
          h={40}
          w={40}
          style={{ border: '2px solid white', borderRadius: 20 }}
        />
        <Title c="white" order={3}>
          Mokei Monitor
        </Title>
      </Group>
      <Group component="nav" aria-label="Main navigation">
        {links.map(({ label, to }) => (
          <Anchor
            key={to}
            component={Link}
            to={to}
            c="white"
            activeProps={{ style: { fontWeight: 700 } }}
            activeOptions={{ exact: to === '/' }}>
            {label}
            {label === 'Inbox' ? (
              <Badge ml="xs" size="sm" aria-label={`${items.length} pending items`}>
                {items.length}
              </Badge>
            ) : null}
          </Anchor>
        ))}
      </Group>
    </Group>
  )
}
