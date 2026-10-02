import { createMemoryTraceStore } from '@mokei/flow-host'
import { context, trace } from '@opentelemetry/api'
import { isSetup } from '@sozai/log'
import { expect, test, vi } from 'vitest'

import { setupFlowTelemetry } from '../src/telemetry.js'

test('requires a restart after registered telemetry fails to create its file sink', async () => {
  const store = createMemoryTraceStore()
  const cached = trace.getTracer('cached-before-setup')
  vi.stubEnv('MOKEI_LOG_DIR', '/dev/null/flow-telemetry-test')
  try {
    expect(() => setupFlowTelemetry({ traceStore: store })).toThrow(
      expect.objectContaining({ code: 'ENOTDIR' }),
    )
    expect(isSetup()).toBe(false)
    expect(trace.getTracer('fresh-after-failure').startSpan('fresh').isRecording()).toBe(false)
    const span = cached.startSpan('cached-after-failure')
    const traceID = span.spanContext().traceId
    span.end()
    let retry: ReturnType<typeof setupFlowTelemetry> | undefined
    try {
      expect(() => {
        retry = setupFlowTelemetry({ traceStore: store, logs: { file: false } })
      }).toThrow(/already installed/i)
    } finally {
      await retry?.dispose()
    }
    expect((await store.getTrace(traceID)).spans).toEqual([])
  } finally {
    vi.unstubAllEnvs()
    trace.disable()
    context.disable()
  }
})
