import { Anchor, Badge, Group, Stack, Table, Text, Title } from '@mantine/core'
import type { TraceCall } from '@mokei/host-protocol'
import { Link } from '@tanstack/react-router'

function outcomeBadge(call: TraceCall) {
  if (call.outcome == null) return <Badge color="blue">running</Badge>
  return <Badge color={call.outcome === 'error' ? 'red' : 'green'}>{call.outcome}</Badge>
}

/** Calls into this trace from other traces (a flow's tool calls into a context), newest first. */
export function TraceCalls({ calls, truncated }: { calls: Array<TraceCall>; truncated: boolean }) {
  if (calls.length === 0) return null
  const sorted = [...calls].sort((a, b) => b.startTime - a.startTime)
  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Title order={4}>Called from</Title>
        <Text size="sm" c="dimmed">
          {truncated ? `newest ${sorted.length}` : sorted.length}
        </Text>
      </Group>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Call</Table.Th>
            <Table.Th>Started</Table.Th>
            <Table.Th>Outcome</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sorted.map((call) => (
            <Table.Tr key={call.spanID}>
              <Table.Td>
                <Anchor
                  renderRoot={(props) => (
                    <Link
                      {...props}
                      to="/traces/$traceID"
                      params={{ traceID: call.traceID }}
                      search={(previous) => ({ ...previous, span: call.spanID })}
                    />
                  )}>
                  {call.name}
                </Anchor>
              </Table.Td>
              <Table.Td>{new Date(call.startTime).toLocaleTimeString()}</Table.Td>
              <Table.Td>{outcomeBadge(call)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  )
}
