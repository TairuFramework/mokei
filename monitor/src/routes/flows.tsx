import { Alert, Button, Group, Loader, Stack, Table, Text, Title } from '@mantine/core'
import type { FlowSummary } from '@mokei/flow-client'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { CheckDefinition } from '../components/CheckDefinition.js'
import { StartRunForm } from '../components/StartRunForm.js'
import { useFlow } from '../flow/FlowProvider.js'
import { useFlows } from '../flow/useFlows.js'

export function FlowsPage() {
  const { connected, status } = useFlow()
  const { flows, loading, error } = useFlows()
  const navigate = useNavigate()
  const [selected, setSelected] = useState<FlowSummary>()
  const disabled = !connected || status?.state !== 'ready'
  return (
    <Stack>
      <Title order={1}>Flows</Title>
      {error == null ? null : (
        <Alert color="red" title="Flow request failed">
          {String(error)}
        </Alert>
      )}
      {loading ? <Loader size="sm" aria-label="Loading flows" /> : null}
      {!loading && flows.length === 0 ? <Text c="dimmed">No flows available.</Text> : null}
      {flows.length === 0 ? null : (
        <Table.ScrollContainer minWidth={700}>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                {['Name', 'ID', 'Version', 'Outputs', 'Outcomes', 'Actions'].map((name) => (
                  <Table.Th key={name}>{name}</Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {flows.map((flow) => (
                <Table.Tr key={flow.id}>
                  <Table.Td>{flow.name}</Table.Td>
                  <Table.Td>{flow.id}</Table.Td>
                  <Table.Td>{flow.version}</Table.Td>
                  <Table.Td>{flow.outputs.join(', ') || '—'}</Table.Td>
                  <Table.Td>{flow.outcomes.join(', ') || '—'}</Table.Td>
                  <Table.Td>
                    <Stack gap="xs">
                      <Group>
                        <Button size="xs" disabled={disabled} onClick={() => setSelected(flow)}>
                          Start run
                        </Button>
                      </Group>
                    </Stack>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      <CheckDefinition />
      {selected == null ? null : (
        <Stack>
          <Group justify="space-between">
            <Title order={2}>Start {selected.name}</Title>
            <Button variant="default" onClick={() => setSelected(undefined)}>
              Close
            </Button>
          </Group>
          <StartRunForm
            key={selected.id}
            flow={selected}
            onStarted={(runID) => void navigate({ to: '/runs/$runID', params: { runID } })}
          />
        </Stack>
      )}
    </Stack>
  )
}

export const Route = createFileRoute('/flows')({ component: FlowsPage })
