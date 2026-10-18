import { context, metrics, trace } from '@opentelemetry/api'
import { MeterProvider } from '@opentelemetry/sdk-metrics'
import { afterEach, expect, test } from 'vitest'

import { setupMokeiTelemetry } from '../src/telemetry.js'
import { useTestStores } from './support/stores.js'

const stores = useTestStores()

afterEach(() => {
  metrics.disable()
  trace.disable()
  context.disable()
})

test('a registered meter provider blocks setup when metrics would be registered', async () => {
  const { db } = await stores()
  expect(metrics.setGlobalMeterProvider(new MeterProvider())).toBe(true)
  expect(() =>
    setupMokeiTelemetry({
      provider: db,
      logs: { file: false },
      otlp: { endpoint: 'http://127.0.0.1:1/v1/traces' },
    }),
  ).toThrow('A global meter provider is already registered')
})
