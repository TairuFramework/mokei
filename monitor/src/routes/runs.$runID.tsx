import { Alert, Button, Loader, Stack, Text } from '@mantine/core'
import { createFileRoute, Navigate } from '@tanstack/react-router'

import { useRun } from '../flow/useRun.js'

function RunRedirect() {
  const { runID } = Route.useParams()
  const { run, loading, error, refresh } = useRun(runID)
  if (error != null)
    return (
      <Alert color="red" title="Run request failed">
        {String(error)}
        <Button onClick={refresh}>Retry</Button>
      </Alert>
    )
  if (run == null)
    return (
      <Stack>{loading ? <Loader aria-label="Loading run" /> : <Text>Run not found.</Text>}</Stack>
    )
  return run.traceID == null ? (
    <Navigate to="/traces" search={{ kind: 'flow' }} replace />
  ) : (
    <Navigate to="/traces/$traceID" params={{ traceID: run.traceID }} replace />
  )
}
export const Route = createFileRoute('/runs/$runID')({ component: RunRedirect })
