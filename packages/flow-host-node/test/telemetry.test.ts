import { context, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import * as logging from '@sozai/log'
import { createFileSink } from '@tejika/log'
import { expect, test, vi } from 'vitest'

import { setupFlowTelemetry } from '../src/index.js'
import { useTestStores } from './support/stores.js'

const stores = useTestStores()

vi.mock('@opentelemetry/sdk-trace-base', { spy: true })
vi.mock('@opentelemetry/context-async-hooks', { spy: true })
vi.mock('@tejika/log', () => ({ createFileSink: vi.fn() }))

test('rejects existing logging and telemetry without allocation', async () => {
  const constructors = [
    BasicTracerProvider,
    BatchSpanProcessor,
    AsyncLocalStorageContextManager,
    createFileSink,
  ]
  const { logStore, telemetryStore } = await stores()
  const existingSink = vi.fn()
  logging.setup({
    sinks: { existing: existingSink },
    loggers: [{ category: [], sinks: ['existing'] }],
  })
  existingSink.mockClear()
  expect(() => setupFlowTelemetry({ logStore, telemetryStore })).toThrow()
  logging.getLogger('existing').info('still configured')
  expect(existingSink).toHaveBeenCalledOnce()
  expect(logging.isSetup()).toBe(true)
  for (const factory of constructors) expect(factory).not.toHaveBeenCalled()
  logging.reset()

  const provider = new BasicTracerProvider()
  expect(trace.setGlobalTracerProvider(provider)).toBe(true)
  const manager = new AsyncLocalStorageContextManager().enable()
  for (const factory of constructors) vi.mocked(factory).mockClear()
  expect(() => setupFlowTelemetry({ logStore, telemetryStore })).toThrow()
  const span = trace.getTracer('existing').startSpan('still recording')
  expect(span.isRecording()).toBe(true)
  span.end()
  trace.disable()
  await provider.shutdown()

  expect(context.setGlobalContextManager(manager)).toBe(true)
  expect(() => setupFlowTelemetry({ logStore, telemetryStore })).toThrow()
  const key = Symbol('existing context')
  context.with(context.active().setValue(key, 'usable'), () => {
    expect(context.active().getValue(key)).toBe('usable')
  })
  for (const factory of constructors) expect(factory).not.toHaveBeenCalled()
  context.disable()
})

test('captures an ordered span tree and logs for one lifetime', async () => {
  const { logStore, telemetryStore, traceStore: store } = await stores()
  const addLogs = vi.spyOn(logStore, 'addLogs')
  const stderr = vi.spyOn(console, 'error').mockImplementation(() => {})
  const shutdown = vi.spyOn(BasicTracerProvider.prototype, 'shutdown')
  const handle = setupFlowTelemetry({ logStore, telemetryStore, logs: { file: false } })
  expect(createFileSink).not.toHaveBeenCalled()
  expect(() => setupFlowTelemetry({ logStore, telemetryStore })).toThrow()
  const tracer = trace.getTracer('telemetry-test')
  const logger = logging.getLogger(['application'])
  logger.info('outside')
  const startTime = Date.now()
  const { traceID, rootSpanID, childSpanID } = await tracer.startActiveSpan(
    'root',
    { startTime },
    async (root) => {
      const traceID = root.spanContext().traceId
      const rootSpanID = root.spanContext().spanId
      logger.info('root log')
      logger.debug('excluded debug')
      const childSpanID = await tracer.startActiveSpan(
        'child',
        { startTime: startTime + 1 },
        async (child) => {
          logger.info('child log')
          await Promise.resolve()
          logger.info('after await')
          logging.getLogger(['mokei', 'flow-host', 'capture']).info('excluded report')
          logging.getReporter(
            ['mokei', 'flow-host', 'capture'],
            '@mokei/flow-host',
          )('capture failure')
          child.end()
          return child.spanContext().spanId
        },
      )
      root.end()
      return { traceID, rootSpanID, childSpanID }
    },
  )
  logger.info('after spans')
  const disposal = handle.dispose()
  expect(handle.dispose()).toBe(disposal)
  await disposal
  expect(handle.dispose()).toBe(disposal)
  expect(shutdown).toHaveBeenCalledOnce()
  const captured = await store.getTrace(traceID)
  expect(captured.spans.map((span) => span.name)).toEqual(['root', 'child'])
  expect(captured.spans[1]?.parentSpanID).toBe(rootSpanID)
  expect(captured.logs.map((log) => [log.message, log.spanID])).toEqual([
    ['root log', rootSpanID],
    ['child log', childSpanID],
    ['after await', childSpanID],
  ])
  expect(addLogs.mock.calls.flatMap(([logs]) => logs)).toHaveLength(3)
  expect(stderr).toHaveBeenCalledOnce()
  expect(String(stderr.mock.calls[0]?.[0])).toContain('capture failure')
  expect(logging.isSetup()).toBe(false)
  expect(() => setupFlowTelemetry({ logStore, telemetryStore })).toThrow()
  vi.restoreAllMocks()
})
