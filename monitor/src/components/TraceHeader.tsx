import { Alert, Anchor, Button, Group, Stack, Text, Title } from '@mantine/core'
import { TERMINAL_RUN_STATES } from '@mokei/flow-client'
import type { OpenSpan, StoredSpan, TraceSummary } from '@mokei/host-protocol'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'

import { useFlow } from '../flow/FlowProvider.js'
import { useInbox } from '../flow/useInbox.js'
import { useRun } from '../flow/useRun.js'
import { RunStateBadge } from './RunStateBadge.js'

function FlowHeader({ runID, summary }: { runID: string; summary: TraceSummary }) {
  const { run, error, refresh } = useRun(runID)
  const { items, error: inboxError } = useInbox({ runID })
  const { control, connected, status } = useFlow()
  const [cancelling, setCancelling] = useState(false)
  const [actionError, setActionError] = useState<unknown>()
  async function cancel() {
    setCancelling(true)
    setActionError(undefined)
    try {
      await control.runs.cancel(runID)
      refresh()
    } catch (error) {
      setActionError(error)
    } finally {
      setCancelling(false)
    }
  }
  return (
    <Stack>
      <Group>
        <Text>Run ID: {runID}</Text>
        <Text>
          Flow ID: <span>{run?.flowID ?? String(summary.attributes['flow.id'] ?? '—')}</span>
        </Text>
        {run == null ? null : <RunStateBadge state={run.state} />}
        <Button
          color="red"
          loading={cancelling}
          disabled={
            !connected ||
            status?.state !== 'ready' ||
            run == null ||
            TERMINAL_RUN_STATES.includes(run.state)
          }
          onClick={() => void cancel()}>
          Cancel
        </Button>
      </Group>
      {error == null && actionError == null ? null : (
        <Alert color="red" title="Run request failed">
          {String(actionError ?? error)}
          <Button onClick={refresh}>Retry</Button>
        </Alert>
      )}
      {inboxError == null ? null : (
        <Alert color="red" title="Inbox request failed">
          {String(inboxError)}
        </Alert>
      )}
      {items.map((item) => (
        <Anchor
          key={item.id}
          renderRoot={(props) => (
            <Link {...props} to="/inbox/$itemID" params={{ itemID: item.id }} />
          )}>
          Pending inbox item
        </Anchor>
      ))}
    </Stack>
  )
}

export function TraceHeader({
  summary,
  rootSpan,
  now,
}: {
  summary: TraceSummary
  rootSpan?: StoredSpan | OpenSpan
  now: number
}) {
  const attributes = rootSpan?.attributes ?? {}
  const runID = summary.attributes['run.id']
  return (
    <Stack>
      <Title order={2}>{summary.name}</Title>
      {summary.kind === 'flow' ? (
        typeof runID === 'string' ? (
          <FlowHeader key={runID} runID={runID} summary={summary} />
        ) : (
          <Text>Run unavailable.</Text>
        )
      ) : (
        <Group>
          <Text>
            {String(
              attributes['mcp.server.name'] ??
                attributes['server.name'] ??
                attributes['process.command'] ??
                summary.name,
            )}
          </Text>
          <Text>{String(attributes['mcp.transport'] ?? 'Unknown transport')}</Text>
          <Text>
            Uptime:{' '}
            {Math.max(
              0,
              (summary.active ? now : (summary.endTime ?? now)) - summary.startTime,
            ).toFixed(0)}{' '}
            ms
          </Text>
        </Group>
      )}
    </Stack>
  )
}
