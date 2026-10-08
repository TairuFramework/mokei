import { getLogger } from '@logtape/logtape'
import { trace } from '@opentelemetry/api'
import { createFileSink } from '@tejika/log'
import { expect, test, vi } from 'vitest'

import { createTraceReader, setupMokeiTelemetry } from '../src/index.js'
import { useTestStores } from './support/stores.js'

const stores = useTestStores()
vi.mock('@tejika/log', () => ({ createFileSink: vi.fn(() => vi.fn()) }))

test('notification debug logs reach trace queries exclusively through the recorder at the default level', async () => {
  const { db } = await stores()
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  const handle = setupMokeiTelemetry({ provider: db })
  const file = vi.mocked(createFileSink).mock.results[0]?.value
  const reader = createTraceReader({ provider: db, recorder: handle.recorder })
  try {
    const traceID = trace.getTracer('notification-test').startActiveSpan('mcp.context', (span) => {
      getLogger(['mokei', 'mcp', 'notification']).debug('MCP notification {method}', {
        method: 'notifications/message',
      })
      getLogger(['mokei', 'other']).debug('excluded')
      span.end()
      return span.spanContext().traceId
    })
    expect((await reader.get(traceID))?.logs).toMatchObject([
      {
        level: 'debug',
        category: ['mokei', 'mcp', 'notification'],
        properties: { method: 'notifications/message' },
      },
    ])
    expect(file).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
    await handle.recorder.forceFlush()
    expect((await reader.get(traceID))?.logs).toHaveLength(1)
  } finally {
    await handle.dispose()
    vi.restoreAllMocks()
  }
})
