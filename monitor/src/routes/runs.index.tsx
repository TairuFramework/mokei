import {
  Alert,
  Anchor,
  Button,
  Group,
  Loader,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core'
import { type RunState, TERMINAL_RUN_STATES } from '@mokei/flow-client'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'

import { RunStateBadge } from '../components/RunStateBadge.js'
import { useFlow } from '../flow/FlowProvider.js'
import { useRuns } from '../flow/useRuns.js'

const states: Array<RunState> = [
  'awaiting_approval',
  'denied',
  'working',
  'input_required',
  'completed',
  'failed',
  'cancelled',
]

function RunsPage() {
  const { control, connected, status } = useFlow()
  const [state, setState] = useState<RunState>()
  const { runs, loading, error, refresh } = useRuns(state == null ? undefined : { states: [state] })
  const [action, setAction] = useState<{ cancelling?: string; error?: unknown }>({})
  const { cancelling, error: actionError } = action
  async function cancel(runID: string) {
    setAction({ cancelling: runID })
    try {
      await control.runs.cancel(runID)
      refresh()
    } catch (error) {
      setAction((value) => ({ ...value, error }))
    } finally {
      setAction((value) => ({ ...value, cancelling: undefined }))
    }
  }
  return (
    <Stack>
      <Title order={1}>Runs</Title>
      <SegmentedControl
        aria-label="Run state"
        value={state ?? 'all'}
        onChange={(value) => setState(states.find((state) => state === value))}
        data={['all', ...states].map((value) => ({ value, label: value.replaceAll('_', ' ') }))}
        style={{ flexWrap: 'wrap' }}
      />
      {error == null && actionError == null ? null : (
        <Alert color="red" title="Run request failed">
          {String(actionError ?? error)}
        </Alert>
      )}
      {loading ? <Loader size="sm" aria-label="Loading runs" /> : null}
      {!loading && runs.length === 0 ? <Text c="dimmed">No runs match this filter.</Text> : null}
      {runs.length === 0 ? null : (
        <Table.ScrollContainer minWidth={700}>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Label</Table.Th>
                <Table.Th>Flow</Table.Th>
                <Table.Th>State</Table.Th>
                <Table.Th>Started</Table.Th>
                <Table.Th>Updated</Table.Th>
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {runs.map((run) => (
                <Table.Tr key={run.runID}>
                  <Table.Td>
                    <Anchor
                      renderRoot={(props) => (
                        <Link {...props} to="/runs/$runID" params={{ runID: run.runID }} />
                      )}>
                      {run.label}
                    </Anchor>
                  </Table.Td>
                  <Table.Td>{run.flowID ?? '—'}</Table.Td>
                  <Table.Td>
                    <RunStateBadge state={run.state} />
                  </Table.Td>
                  <Table.Td>{new Date(run.createdAt).toLocaleString()}</Table.Td>
                  <Table.Td>{new Date(run.updatedAt).toLocaleString()}</Table.Td>
                  <Table.Td>
                    <Group>
                      <Button
                        size="xs"
                        color="red"
                        variant="light"
                        disabled={
                          !connected ||
                          status?.state !== 'ready' ||
                          cancelling != null ||
                          TERMINAL_RUN_STATES.includes(run.state)
                        }
                        loading={cancelling === run.runID}
                        onClick={() => void cancel(run.runID)}>
                        Cancel
                      </Button>
                    </Group>
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

export const Route = createFileRoute('/runs/')({ component: RunsPage })
