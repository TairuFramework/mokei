import { Alert, Code, Stack, Tabs, Title } from '@mantine/core'
import type { OpenSpan, StoredSpan, TraceLog } from '@mokei/host-protocol'

import { LogList } from './LogList.js'

function payload(value: unknown) {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }
  return JSON.stringify(value, null, 2) ?? 'No captured payload.'
}

export function SpanDetail({ span, logs }: { span: StoredSpan | OpenSpan; logs: Array<TraceLog> }) {
  const events = 'events' in span ? span.events : []
  const response = events.find((event) => event.name === 'mcp.response')
  const truncated =
    span.attributes['mokei.payload.truncated'] || response?.attributes?.['mokei.payload.truncated']
  return (
    <Stack>
      <Title order={3}>{span.name}</Title>
      {truncated ? (
        <Alert color="orange">Payload truncated. Captured data is incomplete.</Alert>
      ) : null}
      <Tabs defaultValue="overview" key={span.spanID} keepMounted={false}>
        <Tabs.List>
          {['Overview', 'Request', 'Response', 'Events', 'Logs'].map((tab) => (
            <Tabs.Tab key={tab} value={tab.toLowerCase()}>
              {tab}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel value="overview">
          <Code block>
            {JSON.stringify(
              {
                spanID: span.spanID,
                parentSpanID: span.parentSpanID,
                startTime: span.startTime,
                ...('status' in span ? { endTime: span.endTime, status: span.status } : {}),
                attributes: span.attributes,
              },
              null,
              2,
            )}
          </Code>
        </Tabs.Panel>
        <Tabs.Panel value="request">
          <Code block>{payload(span.attributes['mokei.mcp.request'])}</Code>
        </Tabs.Panel>
        <Tabs.Panel value="response">
          <Code block>{payload(response?.attributes?.payload)}</Code>
        </Tabs.Panel>
        <Tabs.Panel value="events">
          <Code block>{JSON.stringify(events, null, 2)}</Code>
        </Tabs.Panel>
        <Tabs.Panel value="logs">
          <LogList logs={logs} spanID={span.spanID} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  )
}
