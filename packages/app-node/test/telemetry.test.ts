import { context, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import * as logging from '@sozai/log'
import { createFileSink } from '@tejika/log'
import { expect, test, vi } from 'vitest'

import { LocalTraceRecorder, setupMokeiTelemetry } from '../src/index.js'
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
  const { db } = await stores()
  const existingSink = vi.fn()
  logging.setup({
    sinks: { existing: existingSink },
    loggers: [{ category: [], sinks: ['existing'] }],
  })
  existingSink.mockClear()
  expect(() => setupMokeiTelemetry({ provider: db })).toThrow()
  logging.getLogger('existing').info('still configured')
  expect(existingSink).toHaveBeenCalledOnce()
  expect(logging.isSetup()).toBe(true)
  for (const factory of constructors) expect(factory).not.toHaveBeenCalled()
  logging.reset()

  const provider = new BasicTracerProvider()
  expect(trace.setGlobalTracerProvider(provider)).toBe(true)
  const manager = new AsyncLocalStorageContextManager().enable()
  for (const factory of constructors) vi.mocked(factory).mockClear()
  expect(() => setupMokeiTelemetry({ provider: db })).toThrow()
  const span = trace.getTracer('existing').startSpan('still recording')
  expect(span.isRecording()).toBe(true)
  span.end()
  trace.disable()
  await provider.shutdown()

  expect(context.setGlobalContextManager(manager)).toBe(true)
  expect(() => setupMokeiTelemetry({ provider: db })).toThrow()
  const key = Symbol('existing context')
  context.with(context.active().setValue(key, 'usable'), () => {
    expect(context.active().getValue(key)).toBe('usable')
  })
  for (const factory of constructors) expect(factory).not.toHaveBeenCalled()
  context.disable()
})

test('the recorder replaces the local batch exporter and dispose flushes it before returning', async () => {
  const { db, logStore, telemetryStore } = await stores()
  const stderr = vi.spyOn(console, 'error').mockImplementation(() => {})
  const shutdown = vi.spyOn(BasicTracerProvider.prototype, 'shutdown')
  const onEvent = vi.fn()
  const handle = setupMokeiTelemetry({
    provider: db,
    onEvent,
    logs: { file: false },
    reportCategories: [['mokei', 'flow-host', 'capture']],
  })
  expect(handle.recorder).toBeInstanceOf(LocalTraceRecorder)
  expect(BatchSpanProcessor).not.toHaveBeenCalled()
  expect(createFileSink).not.toHaveBeenCalled()
  expect(() => setupMokeiTelemetry({ provider: db })).toThrow()
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
      logging.getLogger(['mokei', 'mcp', 'notification']).debug('notification')
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
  expect(handle.recorder.snapshot().spans).toHaveLength(2)
  expect(handle.recorder.snapshot().logs).toHaveLength(4)
  expect(onEvent.mock.calls.filter(([event]) => event.type === 'log')).toHaveLength(4)
  await handle.recorder.forceFlush()
  expect(await telemetryStore.getSpans(traceID)).toHaveLength(2)
  const disposeSpan = tracer.startSpan('dispose-only')
  const disposeTraceID = disposeSpan.spanContext().traceId
  disposeSpan.end()
  const disposal = handle.dispose()
  expect(handle.dispose()).toBe(disposal)
  await disposal
  expect(handle.dispose()).toBe(disposal)
  expect(shutdown).toHaveBeenCalledOnce()
  expect(await telemetryStore.getSpans(disposeTraceID)).toHaveLength(1)
  const captured = {
    spans: await telemetryStore.getSpans(traceID),
    logs: await logStore.getTraceLogs(traceID),
  }
  expect(captured.spans.map((span) => span.name)).toEqual(['root', 'child'])
  expect(captured.spans[1]?.parentSpanID).toBe(rootSpanID)
  expect(captured.logs.map((log) => [log.message, log.spanID])).toEqual([
    ['root log', rootSpanID],
    ['notification', rootSpanID],
    ['child log', childSpanID],
    ['after await', childSpanID],
  ])
  expect(handle.recorder.snapshot().logs).toEqual([])
  expect(stderr).toHaveBeenCalledOnce()
  expect(stderr.mock.calls.flat().map(String).join(' ')).toContain('capture failure')
  expect(logging.isSetup()).toBe(false)
  expect(() => setupMokeiTelemetry({ provider: db })).toThrow()
  vi.restoreAllMocks()
})
