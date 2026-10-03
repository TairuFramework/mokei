import { Alert, Button, Group, Loader, Stack, Table, Text, Title } from '@mantine/core'
import type { FlowCheckResult, FlowSummary } from '@mokei/flow-client'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { StartRunForm } from '../components/StartRunForm.js'
import { useFlow } from '../flow/FlowProvider.js'
import { useFlows } from '../flow/useFlows.js'

// The daemon currently lists summaries without definitions.
type CheckableFlow = FlowSummary & { definition?: Record<string, unknown> }

export function FlowsPage() {
  const { control, connected, status } = useFlow()
  const { flows, loading, error } = useFlows()
  const navigate = useNavigate()
  const [selected, setSelected] = useState<FlowSummary>()
  const [checking, setChecking] = useState<string>()
  const [checks, setChecks] = useState<Record<string, FlowCheckResult>>({})
  const [checkError, setCheckError] = useState<string>()
  const disabled = !connected || status?.state !== 'ready'
  async function check(flow: CheckableFlow) {
    if (disabled || checking != null || flow.definition == null) return
    setChecking(flow.id)
    setCheckError(undefined)
    try {
      const result = await control.flows.check(flow.definition)
      setChecks((previous) => ({ ...previous, [flow.id]: result }))
    } catch (error) {
      setCheckError(String(error))
    } finally {
      setChecking(undefined)
    }
  }
  return (
    <Stack>
      <Title order={1}>Flows</Title>
      {error == null && checkError == null ? null : (
        <Alert color="red" title="Flow request failed">
          {String(checkError ?? error)}
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
              {flows.map((flow: CheckableFlow) => {
                const result = Object.hasOwn(checks, flow.id) ? checks[flow.id] : undefined
                const issues =
                  result == null
                    ? []
                    : [...('issues' in result ? result.issues : []), ...result.warnings]
                return (
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
                          <Button
                            size="xs"
                            variant="default"
                            disabled={disabled || checking != null || flow.definition == null}
                            loading={checking === flow.id}
                            onClick={() => void check(flow)}>
                            Check
                          </Button>
                        </Group>
                        {flow.definition == null ? (
                          <Text size="xs" c="dimmed">
                            Definition unavailable for checking.
                          </Text>
                        ) : null}
                        {issues.map((issue, index) => (
                          <Alert
                            key={`${index}:${issue.code}`}
                            color={issue.severity === 'error' ? 'red' : 'yellow'}
                            title={`${issue.severity}: ${issue.code}`}>
                            {issue.path.join('.')}: {issue.message}
                            {issue.hint == null ? null : <Text size="sm">{issue.hint}</Text>}
                          </Alert>
                        ))}
                        {result != null && issues.length === 0 ? (
                          <Text size="sm">No issues found.</Text>
                        ) : null}
                      </Stack>
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
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
