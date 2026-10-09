import { trace } from '@opentelemetry/api'
import { expect, test, vi } from 'vitest'

import { setupMokeiTelemetry } from '../src/telemetry.js'
import { useTestStores } from './support/stores.js'

const stores = useTestStores()

test('timed out provider cleanup still awaits an owned transactional span write', async () => {
  vi.useFakeTimers()
  const { db, telemetryStore } = await stores()
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const withTransaction = db.withTransaction.bind(db)
  const write = vi.spyOn(db, 'withTransaction').mockImplementation(async (action) => {
    await pending
    return await withTransaction(action)
  })
  const telemetry = setupMokeiTelemetry({ provider: db, logs: { file: false } })
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
    expect(write).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
    release()
    expect(await disposal).toBeInstanceOf(AggregateError)
    expect(await telemetryStore.getSpans(traceID)).toHaveLength(1)
  } finally {
    release()
    await disposal
    vi.useRealTimers()
  }
})
