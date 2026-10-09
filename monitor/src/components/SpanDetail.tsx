import { Alert, Stack, Tabs, Title } from '@mantine/core'
import type { OpenSpan, StoredSpan, TraceLog } from '@mokei/host-protocol'

import { JsonPayload } from './JsonPayload.js'
import { LogList } from './LogList.js'

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
          <JsonPayload
            key={span.spanID}
            value={{
              spanID: span.spanID,
              parentSpanID: span.parentSpanID,
              startTime: span.startTime,
              ...('status' in span ? { endTime: span.endTime, status: span.status } : {}),
              attributes: span.attributes,
            }}
          />
        </Tabs.Panel>
        <Tabs.Panel value="request">
          <JsonPayload
            key={span.spanID}
            value={span.attributes['mokei.mcp.request']}
            empty="No captured payload."
          />
        </Tabs.Panel>
        <Tabs.Panel value="response">
          <JsonPayload
            key={span.spanID}
            value={response?.attributes?.payload}
            empty="No captured payload."
          />
        </Tabs.Panel>
        <Tabs.Panel value="events">
          <JsonPayload key={span.spanID} value={events} />
        </Tabs.Panel>
        <Tabs.Panel value="logs">
          <LogList logs={logs} spanID={span.spanID} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  )
}
