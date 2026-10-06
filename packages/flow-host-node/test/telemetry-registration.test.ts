import type { HozonDB } from '@hozon/db'
import { context, trace } from '@opentelemetry/api'
import { isSetup } from '@sozai/log'
import { afterEach, expect, test, vi } from 'vitest'

import { setupFlowTelemetry } from '../src/telemetry.js'
import { openTestStores } from './support/stores.js'

const databases: Array<HozonDB> = []
afterEach(async () => {
  for (const db of databases.splice(0)) await db.close()
})

async function stores() {
  const result = await openTestStores()
  databases.push(result.db)
  return result
}

test('requires a restart after registered telemetry fails to create its file sink', async () => {
  const { logStore, telemetryStore, traceStore: store } = await stores()
  const cached = trace.getTracer('cached-before-setup')
  vi.stubEnv('MOKEI_LOG_DIR', '/dev/null/flow-telemetry-test')
  try {
    expect(() => setupFlowTelemetry({ logStore, telemetryStore })).toThrow(
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
        retry = setupFlowTelemetry({ logStore, telemetryStore, logs: { file: false } })
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
