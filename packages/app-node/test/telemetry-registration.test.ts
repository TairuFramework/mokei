import { context, trace } from '@opentelemetry/api'
import { isSetup } from '@sozai/log'
import { afterEach, expect, test, vi } from 'vitest'

import { setupMokeiTelemetry } from '../src/telemetry.js'
import { useTestStores } from './support/stores.js'

const stores = useTestStores()

afterEach(() => {
  vi.unstubAllEnvs()
})

test('requires a restart after registered telemetry fails to create its file sink', async () => {
  const { db, telemetryStore } = await stores()
  const cached = trace.getTracer('cached-before-setup')
  vi.stubEnv('MOKEI_LOG_DIR', '/dev/null/flow-telemetry-test')
  try {
    expect(() => setupMokeiTelemetry({ provider: db })).toThrow(
      expect.objectContaining({ code: 'ENOTDIR' }),
    )
    expect(isSetup()).toBe(false)
    expect(trace.getTracer('fresh-after-failure').startSpan('fresh').isRecording()).toBe(false)
    const span = cached.startSpan('cached-after-failure')
    const traceID = span.spanContext().traceId
    span.end()
    let retry: ReturnType<typeof setupMokeiTelemetry> | undefined
    try {
      expect(() => {
        retry = setupMokeiTelemetry({ provider: db, logs: { file: false } })
      }).toThrow(/already installed/i)
    } finally {
      await retry?.dispose()
    }
    expect(await telemetryStore.getSpans(traceID)).toEqual([])
  } finally {
    trace.disable()
    context.disable()
  }
})
