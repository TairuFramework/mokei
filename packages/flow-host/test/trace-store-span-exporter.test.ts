import { configure, reset } from '@logtape/logtape'
import { context, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import { ExportResultCode } from '@opentelemetry/core'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { afterEach, expect, test, vi } from 'vitest'

import { createTraceStoreSpanExporter } from '../src/index.js'
import { createMemoryTraceStore } from '../src/trace-store.js'

const providers: Array<BasicTracerProvider> = []
afterEach(async () => {
  for (const provider of providers.splice(0)) await provider.shutdown()
  await reset()
  trace.disable()
  context.disable()
  vi.restoreAllMocks()
})
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected fixture value')
  return value
}
async function spans() {
  const captured = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(captured)] })
  providers.push(provider)
  const tracer = provider.getTracer('capture-test')
  const root = tracer.startSpan(
    'root',
    { kind: SpanKind.SERVER, startTime: [1, 0], attributes: { normal: ['a', 'b'] } },
    ROOT_CONTEXT,
  )
  root.addEvent('event', { normal: 1 }, [1, 500000])
  root.addLink({
    context: { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: 1, isRemote: true },
    attributes: { ignored: true },
  })
  root.setStatus({ code: SpanStatusCode.ERROR, message: 'failure' })
  const child = tracer.startSpan('child', { startTime: [2, 0] }, trace.setSpan(ROOT_CONTEXT, root))
  child.end([3, 0])
  root.end([4, 0])
  await provider.forceFlush()
  return captured.getFinishedSpans()
}
test('maps a span batch including events and links', async () => {
  const batch = await spans()
  const root = required(batch.find((span) => span.name === 'root'))
  const child = required(batch.find((span) => span.name === 'child'))
  // Inject malformed values after SDK attribute validation.
  Object.assign(root.attributes, { bigint: 12n, absent: undefined })
  Object.assign(required(required(root.events[0]).attributes), {
    bigint: 13n,
    normal: { nested: true },
  })
  const store = createMemoryTraceStore()
  const addSpans = vi.spyOn(store, 'addSpans')
  const callback = vi.fn()
  const exporter = createTraceStoreSpanExporter(store)
  exporter.export(batch, callback)
  await required(exporter.forceFlush).call(exporter)
  expect(callback).toHaveBeenCalledExactlyOnceWith({ code: ExportResultCode.SUCCESS })
  expect(addSpans).toHaveBeenCalledExactlyOnceWith([
    {
      traceID: child.spanContext().traceId,
      spanID: child.spanContext().spanId,
      parentSpanID: root.spanContext().spanId,
      name: 'child',
      kind: SpanKind.INTERNAL,
      startTime: 2000,
      endTime: 3000,
      status: { code: SpanStatusCode.UNSET },
      attributes: {},
      events: [],
      links: [],
    },
    {
      traceID: root.spanContext().traceId,
      spanID: root.spanContext().spanId,
      name: 'root',
      kind: SpanKind.SERVER,
      startTime: 1000,
      endTime: 4000,
      status: { code: SpanStatusCode.ERROR, message: 'failure' },
      attributes: { normal: ['a', 'b'], bigint: '12', absent: 'undefined' },
      events: [
        { name: 'event', time: 1000.5, attributes: { normal: { nested: true }, bigint: '13' } },
      ],
      links: [{ traceID: 'a'.repeat(32), spanID: 'b'.repeat(16) }],
    },
  ])
  expect(required(addSpans.mock.calls[0])[0][1]).not.toHaveProperty('parentSpanID')
})
test.each(['sync', 'async'])('reports exporter failure through the callback (%s)', async (mode) => {
  const reports = vi.fn()
  await configure({
    sinks: { reports },
    loggers: [
      { category: ['mokei', 'flow-host', 'capture'], lowestLevel: 'error', sinks: ['reports'] },
    ],
  })
  const failure = new Error('store unavailable')
  const store = createMemoryTraceStore()
  vi.spyOn(store, 'addSpans').mockImplementation(() => {
    if (mode === 'sync') throw failure
    return Promise.reject(failure)
  })
  const exporter = createTraceStoreSpanExporter(store)
  const callback = vi.fn()
  expect(() => exporter.export([], callback)).not.toThrow()
  await required(exporter.forceFlush).call(exporter)
  expect(callback).toHaveBeenCalledExactlyOnceWith({
    code: ExportResultCode.FAILED,
    error: failure,
  })
  expect(reports).toHaveBeenCalledTimes(1)
})
test('wraps a non-error rejection that cannot be stringified', async () => {
  const store = createMemoryTraceStore()
  const rejection = Object.create(null)
  vi.spyOn(store, 'addSpans').mockRejectedValue(rejection)
  const exporter = createTraceStoreSpanExporter(store)
  const callback = vi.fn()
  exporter.export([], callback)
  await required(exporter.forceFlush).call(exporter)
  expect(callback).toHaveBeenCalledTimes(1)
  const result = callback.mock.calls[0]?.[0]
  expect(result.code).toBe(ExportResultCode.FAILED)
  expect(result.error).toBeInstanceOf(Error)
  expect(result.error.cause).toBe(rejection)
})
test('flush and shutdown await outstanding exports without closing the store', async () => {
  const store = createMemoryTraceStore()
  let release!: () => void
  vi.spyOn(store, 'addSpans').mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      }),
  )
  const exporter = createTraceStoreSpanExporter(store)
  const callback = vi.fn()
  exporter.export([], callback)
  let drained = false
  const draining = Promise.all([
    required(exporter.forceFlush).call(exporter),
    exporter.shutdown(),
  ]).then(() => {
    drained = true
  })
  await Promise.resolve()
  expect(drained).toBe(false)
  release()
  await draining
  expect(callback).toHaveBeenCalledTimes(1)
  await expect(store.addLogs([])).resolves.toBeUndefined()
})
