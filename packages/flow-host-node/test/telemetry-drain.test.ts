import { trace } from '@opentelemetry/api'
import { expect, test, vi } from 'vitest'

import { setupFlowTelemetry } from '../src/telemetry.js'
import { useTestStores } from './support/stores.js'

const stores = useTestStores()

test('timed out provider cleanup still awaits an owned local span write', async () => {
  vi.useFakeTimers()
  const { logStore, telemetryStore, traceStore: store } = await stores()
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const addSpans = telemetryStore.addSpans.bind(telemetryStore)
  vi.spyOn(telemetryStore, 'addSpans').mockImplementation(async (spans) => {
    await pending
    await addSpans(spans)
  })
  const telemetry = setupFlowTelemetry({ logStore, telemetryStore, logs: { file: false } })
  const span = trace.getTracer('local-drain').startSpan('owned write')
  const traceID = span.spanContext().traceId
  span.end()
  let settled = false
  const disposal = telemetry
    .dispose()
    .catch((error: unknown) => error)
    .finally(() => {
      settled = true
    })
  try {
    await vi.advanceTimersByTimeAsync(20_000)
    expect(telemetryStore.addSpans).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
    release()
    expect(await disposal).toBeInstanceOf(AggregateError)
    expect((await store.getTrace(traceID)).spans).toHaveLength(1)
  } finally {
    release()
    await disposal
    vi.useRealTimers()
  }
})
