import { Alert, Button, Stack, Text } from '@mantine/core'

import { useFlow } from '../flow/FlowProvider.js'

export function ConnectionBanner() {
  const { connected, restarted, status } = useFlow()
  if (restarted) {
    return (
      <Alert color="red" title="Monitor restarted, reload">
        <Stack align="start">
          <Text>Reload this page to reconnect to the monitor.</Text>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </Stack>
      </Alert>
    )
  }
  if (!connected)
    return (
      <Alert color="yellow" title="Disconnected">
        Reconnecting. Flow actions are unavailable.
      </Alert>
    )
  if (status?.state === 'ready') return null
  if (status?.state === 'failed') {
    return (
      <Alert color="red" title="Flow service failed">
        {status.error.message}
      </Alert>
    )
  }
  return (
    <Alert color="yellow" title="Flow service starting">
      Flow actions are unavailable until the service is ready.
    </Alert>
  )
}
