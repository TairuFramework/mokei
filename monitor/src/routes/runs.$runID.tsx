import {
  Alert,
  Anchor,
  Button,
  Code,
  DataList,
  Group,
  Loader,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { TERMINAL_RUN_STATES } from '@mokei/flow-client'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'

import { LogList } from '../components/LogList.js'
import { PendingItemActions } from '../components/PendingItemActions.js'
import { RunStateBadge } from '../components/RunStateBadge.js'
import { TraceWaterfall } from '../components/TraceWaterfall.js'
import { useFlow } from '../flow/FlowProvider.js'
import { useInbox } from '../flow/useInbox.js'
import { useRun } from '../flow/useRun.js'
import { useRunTrace } from '../flow/useRunTrace.js'

function RunDetailPage() {
  const { runID } = Route.useParams()
  return <RunDetail key={runID} runID={runID} />
}

function RunDetail({ runID }: { runID: string }) {
  const { control, connected, status } = useFlow()
  const { run, loading, error, refresh } = useRun(runID)
  const {
    trace,
    loading: traceLoading,
    error: traceError,
    refresh: refreshTrace,
  } = useRunTrace(runID)
  const { items, loading: inboxLoading, error: inboxError } = useInbox({ runID })
  const [spanID, setSpanID] = useState<string>()
  const [action, setAction] = useState<{ cancelling: boolean; error?: unknown }>({
    cancelling: false,
  })
  const { cancelling, error: actionError } = action
  const ready = connected && status?.state === 'ready'
  async function cancel() {
    setAction({ cancelling: true })
    try {
      await control.runs.cancel(runID)
      refresh()
      refreshTrace()
    } catch (error) {
      setAction((value) => ({ ...value, error }))
    } finally {
      setAction((value) => ({ ...value, cancelling: false }))
    }
  }
  if (run == null)
    return (
      <Stack>
        <Title order={1}>Run</Title>
        {error != null ? (
          <Alert color="red" title="Run request failed">
            {String(error)}
          </Alert>
        ) : !ready ? (
          <Text c="dimmed">Waiting for the flow service.</Text>
        ) : loading ? (
          <Loader aria-label="Loading run" />
        ) : (
          <Text c="dimmed">Run not found.</Text>
        )}
      </Stack>
    )
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={1}>{run.label}</Title>
        <Group>
          <Button
            disabled={!ready}
            onClick={() => {
              refresh()
              refreshTrace()
            }}>
            Refresh trace
          </Button>
          <Button
            color="red"
            disabled={!ready || TERMINAL_RUN_STATES.includes(run.state)}
            loading={cancelling}
            onClick={() => void cancel()}>
            Cancel run
          </Button>
        </Group>
      </Group>
      {error == null && actionError == null ? null : (
        <Alert color="red" title="Run request failed">
          {String(actionError ?? error)}
        </Alert>
      )}
      <DataList>
        <DataList.Item>
          <DataList.ItemLabel>Run ID</DataList.ItemLabel>
          <DataList.ItemValue>{run.runID}</DataList.ItemValue>
        </DataList.Item>
        <DataList.Item>
          <DataList.ItemLabel>Flow</DataList.ItemLabel>
          <DataList.ItemValue>{run.flowID ?? '—'}</DataList.ItemValue>
        </DataList.Item>
        <DataList.Item>
          <DataList.ItemLabel>State</DataList.ItemLabel>
          <DataList.ItemValue>
            <RunStateBadge state={run.state} />
          </DataList.ItemValue>
        </DataList.Item>
        <DataList.Item>
          <DataList.ItemLabel>Started</DataList.ItemLabel>
          <DataList.ItemValue>{new Date(run.createdAt).toLocaleString()}</DataList.ItemValue>
        </DataList.Item>
        <DataList.Item>
          <DataList.ItemLabel>Updated</DataList.ItemLabel>
          <DataList.ItemValue>{new Date(run.updatedAt).toLocaleString()}</DataList.ItemValue>
        </DataList.Item>
        <DataList.Item>
          <DataList.ItemLabel>Trace ID</DataList.ItemLabel>
          <DataList.ItemValue>{run.traceID ?? '—'}</DataList.ItemValue>
        </DataList.Item>
        <DataList.Item>
          <DataList.ItemLabel>Plan tools</DataList.ItemLabel>
          <DataList.ItemValue>{run.plan.tools.join(', ') || 'None'}</DataList.ItemValue>
        </DataList.Item>
      </DataList>
      {run.result == null ? null : (
        <>
          <Title order={2}>Result</Title>
          <Code block>{JSON.stringify(run.result, null, 2)}</Code>
        </>
      )}
      {run.error == null ? null : (
        <Alert color="red" title="Run error">
          <Code block>{JSON.stringify(run.error, null, 2)}</Code>
        </Alert>
      )}
      <Title order={2}>Pending items</Title>
      {inboxError == null ? null : (
        <Alert color="red" title="Inbox request failed">
          {String(inboxError)}
        </Alert>
      )}
      {inboxLoading ? (
        <Loader size="sm" aria-label="Loading pending items" />
      ) : items.length === 0 ? (
        <Text c="dimmed">No pending items.</Text>
      ) : null}
      {items.map((item) => (
        <Stack key={item.id}>
          <Anchor component={Link} to={`/inbox/${encodeURIComponent(item.id)}`}>
            {item.kind === 'input' ? item.message : `Approval: ${item.plan.tools.join(', ')}`}
          </Anchor>
          <PendingItemActions item={item} />
        </Stack>
      ))}
      {traceError == null ? null : (
        <Alert color="red" title="Trace request failed">
          {String(traceError)}
        </Alert>
      )}
      {traceLoading ? <Loader size="sm" aria-label="Loading trace" /> : null}
      <TraceWaterfall run={run} spans={trace?.spans ?? []} onSelectSpan={setSpanID} />
      <Title order={2}>Logs</Title>
      <LogList logs={trace?.logs ?? []} spanID={spanID} />
    </Stack>
  )
}

export const Route = createFileRoute('/runs/$runID')({ component: RunDetailPage })
