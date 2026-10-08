import { Alert, Button, Loader, Stack, Tabs, Text } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { LogList } from '../components/LogList.js'
import { SpanDetail } from '../components/SpanDetail.js'
import { TraceHeader } from '../components/TraceHeader.js'
import { TraceWaterfall } from '../components/TraceWaterfall.js'
import { useTrace } from '../traces/useTrace.js'

function TracePage() {
  const { traceID } = Route.useParams()
  const { span: spanID } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { state, loading, notFound, error, retry } = useTrace(traceID)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const spans = [...(state?.spans.values() ?? [])]
  const logs = [...(state?.logs.values() ?? [])]
  const selected = state?.spans.get(spanID ?? '')
  return (
    <Stack>
      {error == null ? null : (
        <Alert color="red" title="Trace request failed">
          {error.message}
          <Button onClick={retry}>Retry</Button>
        </Alert>
      )}
      {loading ? <Loader aria-label="Loading trace" /> : null}
      {notFound ? <Text>Trace not found.</Text> : null}
      {state?.summary == null ? null : (
        <TraceHeader
          summary={state.summary}
          rootSpan={state.spans.get(state.summary.rootSpanID)}
          now={now}
        />
      )}
      {state?.logsTruncated ? (
        <Alert color="orange">Logs truncated. Only the newest logs are available.</Alert>
      ) : null}
      {state == null ? null : (
        <Tabs defaultValue="waterfall" key={traceID} keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="waterfall">Waterfall</Tabs.Tab>
            <Tabs.Tab value="logs">Logs</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="waterfall">
            <Stack>
              <TraceWaterfall
                spans={spans}
                summary={state.summary}
                now={now}
                selectedSpanID={spanID}
                onSelectSpan={(span) => {
                  void navigate({ search: (previous) => ({ ...previous, span }), replace: true })
                }}
                onOpenContext={(traceID) => {
                  void navigate({
                    to: '/traces/$traceID',
                    params: { traceID },
                    search: (previous) => ({ ...previous, span: undefined }),
                  })
                }}
              />
              {selected == null ? null : <SpanDetail span={selected} logs={logs} />}
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="logs">
            <LogList logs={logs} />
          </Tabs.Panel>
        </Tabs>
      )}
    </Stack>
  )
}
export const Route = createFileRoute('/traces/$traceID')({
  validateSearch: (search: Record<string, unknown>): { span?: string } => ({
    span: typeof search.span === 'string' ? search.span : undefined,
  }),
  component: TracePage,
})
