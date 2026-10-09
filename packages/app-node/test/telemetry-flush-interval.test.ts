import { trace } from '@opentelemetry/api'
import { expect, test, vi } from 'vitest'

import { setupMokeiTelemetry } from '../src/index.js'
import { useTestStores } from './support/stores.js'

const stores = useTestStores()

test('a long flush interval keeps live spans available before persistence', async () => {
  const { db, telemetryStore } = await stores()
  vi.useFakeTimers()
  const handle = setupMokeiTelemetry({
    provider: db,
    logs: { file: false },
    flushIntervalMs: 600_000,
  })
  try {
    const span = trace.getTracer('live-before-persistence').startSpan('flow.run', {
      attributes: { 'mokei.root': true, 'mokei.kind': 'flow' },
    })
    span.end()
    const traceID = span.spanContext().traceId
    await vi.advanceTimersByTimeAsync(1000)
    expect(handle.recorder.snapshot(traceID).spans).toHaveLength(1)
    expect(await telemetryStore.getSpans(traceID)).toEqual([])
    await vi.advanceTimersByTimeAsync(599_000)
    expect(await telemetryStore.getSpans(traceID)).toHaveLength(1)
  } finally {
    await handle.dispose()
    vi.useRealTimers()
  }
})
