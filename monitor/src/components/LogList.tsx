import { Code, Group, NativeSelect, Stack, Table, Text, TextInput } from '@mantine/core'
import type { StoredLog } from '@mokei/host-protocol'
import { useState } from 'react'

export type LogListProps = { logs: Array<StoredLog>; spanID?: string }

export function LogList({ logs, spanID }: LogListProps) {
  const [level, setLevel] = useState('all')
  const [text, setText] = useState('')
  const filtered = logs.filter((log) => {
    return (
      (spanID == null || log.spanID === spanID) &&
      (level === 'all' || log.level === level) &&
      log.message.toLowerCase().includes(text.toLowerCase())
    )
  })
  return (
    <Stack>
      <Group align="end">
        <NativeSelect
          label="Log level"
          value={level}
          onChange={(event) => setLevel(event.currentTarget.value)}
          data={['all', 'trace', 'debug', 'info', 'warning', 'error', 'fatal']}
        />
        <TextInput
          label="Search logs"
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
        />
        {spanID == null ? null : <Text size="sm">Span: {spanID}</Text>}
      </Group>
      {filtered.length === 0 ? (
        <Text c="dimmed">No matching logs.</Text>
      ) : (
        <Table.ScrollContainer minWidth={600}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Time</Table.Th>
                <Table.Th>Level</Table.Th>
                <Table.Th>Category</Table.Th>
                <Table.Th>Message</Table.Th>
                <Table.Th>Properties</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filtered.map((log, index) => (
                <Table.Tr key={`${log.timestamp}:${log.spanID}:${index}`}>
                  <Table.Td>{new Date(log.timestamp).toLocaleTimeString()}</Table.Td>
                  <Table.Td>{log.level}</Table.Td>
                  <Table.Td>{log.category.join('.')}</Table.Td>
                  <Table.Td>{log.message}</Table.Td>
                  <Table.Td>
                    <Code block>{JSON.stringify(log.properties, null, 2)}</Code>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  )
}
