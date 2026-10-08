import type { HozonDB } from '@hozon/db'
import { getTelemetryStore } from '@hozon/store-telemetry'
import { ROOT_CONTEXT, SpanStatusCode, trace } from '@opentelemetry/api'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { openMokeiDatabase } from '../src/database.js'
import { getTraceIndexStore } from '../src/trace-index.js'
import {
  LocalTraceRecorder,
  type TraceRecorderEvent,
  type TraceRecorderParams,
} from '../src/trace-recorder.js'

let db: HozonDB
let recorder: LocalTraceRecorder
let provider: BasicTracerProvider
let events: Array<TraceRecorderEvent>
beforeEach(async () => {
  vi.useFakeTimers()
  db = await openMokeiDatabase({ path: ':memory:' })
  events = []
})
afterEach(async () => {
  vi.restoreAllMocks()
  await recorder?.shutdown()
  await db.close()
  vi.useRealTimers()
})
function setup(params: Partial<TraceRecorderParams> = {}) {
  recorder = new LocalTraceRecorder({
    provider: db,
    onEvent: (event) => events.push(event),
    ...params,
  })
  provider = new BasicTracerProvider({ spanProcessors: [recorder] })
  return provider.getTracer('recorder-test')
}
async function settle() {
  for (let i = 0; i < 40; i++) await Promise.resolve()
}
function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('emits span:start then span:end then trace:summary in order', async () => {
  const span = setup().startSpan('root', {
    attributes: { 'mokei.kind': 'flow', 'run.id': 'run', 'run.label': 'label' },
  })
  await settle()
  expect(events.map((event) => event.type)).toEqual(['span:start', 'trace:summary'])
  events.length = 0
  span.end()
  expect(events.map((event) => event.type)).toEqual(['span:end', 'trace:summary'])
  expect(recorder.snapshot().summaries[0]).toMatchObject({
    kind: 'flow',
    attributes: { 'run.id': 'run', label: 'label' },
    active: false,
    outcome: 'ok',
    spanCount: 1,
    revision: 2,
  })
})

test('flush writes spans and summaries in one transaction', async () => {
  const span = setup().startSpan('root')
  span.end()
  const transaction = vi.spyOn(db, 'withTransaction')
  await recorder.forceFlush()
  expect(transaction).toHaveBeenCalledOnce()
  const traceID = span.spanContext().traceId
  expect(await (await getTelemetryStore(db)).getSpans(traceID)).toHaveLength(1)
  expect(await (await getTraceIndexStore(db)).get(traceID)).toMatchObject({
    spanCount: 1,
    revision: 2,
  })
  expect(recorder.snapshot()).toEqual({ open: [], spans: [], logs: [], summaries: [] })
})

test('flushes at 200 entries without waiting for the interval', async () => {
  const tracer = setup()
  const transaction = vi.spyOn(db, 'withTransaction')
  for (let i = 0; i < 199; i++) tracer.startSpan(`span-${i}`).end()
  await settle()
  expect(transaction).not.toHaveBeenCalled()
  tracer.startSpan('span-200').end()
  await recorder.forceFlush()
  expect(transaction).toHaveBeenCalledOnce()
  expect(recorder.snapshot().spans).toHaveLength(0)
})

test('flushes at the interval', async () => {
  setup().startSpan('root').end()
  await vi.advanceTimersByTimeAsync(250)
  await recorder.forceFlush()
  expect(recorder.snapshot().spans).toHaveLength(0)
})

test('write failure retries at 250/1000/4000 ms, then drops and increments droppedCount', async () => {
  const reportError = vi.fn()
  const span = setup({ reportError, flushIntervalMs: 60000 }).startSpan('root')
  span.end()
  const store = await getTelemetryStore(db)
  const getStore = db.getStore.bind(db)
  vi.spyOn(db, 'withTransaction').mockImplementation(async (fn) => fn(db))
  vi.spyOn(db, 'getStore').mockImplementation(async (name) =>
    name === 'telemetry' ? store : getStore(name),
  )
  const add = vi.spyOn(store, 'addSpans').mockRejectedValue(new Error('write failed'))
  const flush = recorder.forceFlush()
  await settle()
  expect(add).toHaveBeenCalledTimes(1)
  for (const [delay, count] of [
    [250, 2],
    [1000, 3],
    [4000, 4],
  ] as Array<[number, number]>) {
    await vi.advanceTimersByTimeAsync(delay - 1)
    expect(add).toHaveBeenCalledTimes(count - 1)
    await vi.advanceTimersByTimeAsync(1)
    expect(add).toHaveBeenCalledTimes(count)
  }
  await flush
  expect(recorder.info()).toEqual({ droppedCount: 1, lostSummaryCount: 0 })
  expect(recorder.snapshot().summaries[0]).toMatchObject({ droppedCount: 1, revision: 3 })
  expect(reportError).toHaveBeenCalled()
  add.mockRestore()
  await recorder.forceFlush()
  expect(await (await getTraceIndexStore(db)).get(span.spanContext().traceId)).toMatchObject({
    droppedCount: 1,
  })
})

test('queue overflow drops the oldest entries and counts them', async () => {
  const tracer = setup({ queueLimit: 2, flushBatchSize: 10, reportError: vi.fn() })
  const spans = ['first', 'second', 'third'].map((name) => {
    const span = tracer.startSpan(name)
    span.end()
    return span
  })
  await settle()
  expect(recorder.snapshot().spans.map((span) => span.name)).toEqual(['second', 'third'])
  expect(recorder.info().droppedCount).toBe(1)
  expect(recorder.snapshot(spans[0]?.spanContext().traceId).summaries[0]?.droppedCount).toBe(1)
})

test('dirty-summary cap drops the oldest inactive summary and increments lostSummaryCount; active summaries are kept', async () => {
  const tracer = setup({ dirtySummaryLimit: 2, reportError: vi.fn() })
  const active = tracer.startSpan('active')
  tracer.startSpan('old').end()
  tracer.startSpan('new').end()
  await settle()
  expect(recorder.snapshot().summaries.map((summary) => summary.name)).toEqual(['active', 'new'])
  expect(recorder.info().lostSummaryCount).toBe(1)
  active.end()
})

test('snapshot returns entries until their transaction commits, and an entry committed mid-read is returned once after merge', async () => {
  const span = setup().startSpan('root')
  span.end()
  const entered = deferred()
  const release = deferred()
  const transaction = db.withTransaction.bind(db)
  vi.spyOn(db, 'withTransaction').mockImplementation((fn) =>
    transaction(async (tx) => {
      await fn(tx)
      entered.resolve()
      await release.promise
    }),
  )
  const flush = recorder.forceFlush()
  await entered.promise
  const snapshot = recorder.snapshot(span.spanContext().traceId)
  expect(snapshot.spans).toHaveLength(1)
  release.resolve()
  await flush
  const stored = await (await getTelemetryStore(db)).getSpans(span.spanContext().traceId)
  const merged = new Map([...snapshot.spans, ...stored].map((span) => [span.spanID, span]))
  expect(merged.size).toBe(1)
  expect(snapshot.summaries).toHaveLength(1)
  expect(recorder.snapshot().spans).toHaveLength(0)
})

test('resume segment reactivates the persisted row, keeping rootSpanID and continuing revision', async () => {
  const tracer = setup()
  const root = tracer.startSpan('root')
  root.end()
  await recorder.forceFlush()
  const resume = tracer.startSpan(
    'flow.run.resume',
    { attributes: { 'mokei.root': true, 'mokei.kind': 'flow' } },
    trace.setSpan(ROOT_CONTEXT, root),
  )
  await settle()
  expect(recorder.snapshot().summaries[0]).toMatchObject({
    rootSpanID: root.spanContext().spanId,
    activeSegmentSpanID: resume.spanContext().spanId,
    active: true,
    outcome: null,
    spanCount: 1,
    revision: 3,
  })
  expect(recorder.snapshot().summaries[0]?.endTime).toBeUndefined()
  resume.end()
  await recorder.forceFlush()
  expect(await (await getTraceIndexStore(db)).get(root.spanContext().traceId)).toMatchObject({
    spanCount: 2,
    revision: 4,
  })
})

test('running trace with a failed child is active with errorCount 1', async () => {
  const tracer = setup()
  const root = tracer.startSpan('root')
  const child = tracer.startSpan('child', {}, trace.setSpan(ROOT_CONTEXT, root))
  child.setStatus({ code: SpanStatusCode.ERROR })
  child.end()
  await settle()
  expect(recorder.snapshot().summaries[0]).toMatchObject({
    active: true,
    outcome: null,
    spanCount: 1,
    errorCount: 1,
  })
  root.end()
})

test('non-root end loads or synthesises an inactive summary', async () => {
  const tracer = setup()
  const parent = trace.wrapSpanContext({
    traceId: '12345678901234567890123456789012',
    spanId: '1234567890123456',
    traceFlags: 1,
  })
  tracer.startSpan('orphan', {}, trace.setSpan(ROOT_CONTEXT, parent)).end()
  await recorder.forceFlush()
  expect(await (await getTraceIndexStore(db)).get(parent.spanContext().traceId)).toMatchObject({
    active: false,
    spanCount: 1,
    revision: 1,
    kind: 'step',
  })
})

test('sweepInterrupted marks persisted active rows interrupted and bumps revision', async () => {
  const root = setup().startSpan('root')
  await recorder.forceFlush()
  expect(await recorder.sweepInterrupted()).toBe(1)
  expect(await (await getTraceIndexStore(db)).get(root.spanContext().traceId)).toMatchObject({
    active: false,
    outcome: 'interrupted',
    revision: 2,
  })
  expect(await recorder.sweepInterrupted()).toBe(0)
})

test('shutdown flushes the queue', async () => {
  const span = setup().startSpan('root')
  span.end()
  await recorder.shutdown()
  expect(await (await getTelemetryStore(db)).getSpans(span.spanContext().traceId)).toHaveLength(1)
})

test('converts complete spans without exposing ended fields on open spans', async () => {
  const tracer = setup()
  const parent = tracer.startSpan('parent', { startTime: 1000 })
  const span = tracer.startSpan(
    'child',
    {
      startTime: 1001.25,
      attributes: { text: 'value', values: [1, 2], flag: true },
      links: [{ context: parent.spanContext() }],
    },
    trace.setSpan(ROOT_CONTEXT, parent),
  )
  const open = recorder.snapshot().open.find((entry) => entry.name === 'child')
  expect(open).toMatchObject({
    startTime: 1001.25,
    parentSpanID: parent.spanContext().spanId,
    links: [{ traceID: parent.spanContext().traceId, spanID: parent.spanContext().spanId }],
  })
  expect(open).not.toHaveProperty('endTime')
  expect(open).not.toHaveProperty('status')
  span.addEvent('event', { detail: 'value' }, 1002.5)
  span.setStatus({ code: SpanStatusCode.ERROR, message: 'failure' })
  span.end(1003.75)
  expect(recorder.snapshot().spans[0]).toMatchObject({
    ...open,
    endTime: 1003.75,
    status: { code: 2, message: 'failure' },
    events: [{ name: 'event', time: 1002.5, attributes: { detail: 'value' } }],
  })
  parent.end(1004)
})

test('rolls back both stores when a summary write fails', async () => {
  const span = setup({ retryDelaysMs: [], reportError: vi.fn() }).startSpan('root')
  span.end()
  const transaction = db.withTransaction.bind(db)
  vi.spyOn(db, 'withTransaction').mockImplementation((fn) =>
    transaction(async (tx) => {
      const get = tx.getStore.bind(tx)
      vi.spyOn(tx, 'getStore').mockImplementation(async (name) => {
        const store = await get(name)
        if (name === 'trace-index') {
          return {
            upsert: async () => {
              throw new Error('summary write failed')
            },
          }
        }
        return store
      })
      return fn(tx)
    }),
  )
  await recorder.forceFlush()
  expect(await (await getTelemetryStore(db)).getSpans(span.spanContext().traceId)).toEqual([])
  expect(await (await getTraceIndexStore(db)).get(span.spanContext().traceId)).toBeUndefined()
  expect(recorder.info().droppedCount).toBe(1)
  vi.restoreAllMocks()
  // The loss summary survives the rollback and is persisted by the next flush.
  await recorder.forceFlush()
  expect(await (await getTraceIndexStore(db)).get(span.spanContext().traceId)).toMatchObject({
    spanCount: 1,
    droppedCount: 1,
  })
})

test('serialises concurrent flushes and retains changes made during a transaction', async () => {
  const tracer = setup()
  const root = tracer.startSpan('root')
  const first = tracer.startSpan('first', {}, trace.setSpan(ROOT_CONTEXT, root))
  first.end()
  const entered = deferred()
  const release = deferred()
  const transaction = db.withTransaction.bind(db)
  const spy = vi.spyOn(db, 'withTransaction').mockImplementationOnce((fn) =>
    transaction(async (tx) => {
      await fn(tx)
      entered.resolve()
      await release.promise
    }),
  )
  const flush = recorder.forceFlush()
  expect(recorder.forceFlush()).toBe(flush)
  await entered.promise
  tracer.startSpan('second', {}, trace.setSpan(ROOT_CONTEXT, root)).end()
  root.end()
  const snapshot = recorder.snapshot()
  expect(snapshot.spans).toHaveLength(3)
  expect(snapshot.summaries[0]?.spanCount).toBe(3)
  release.resolve()
  await flush
  expect(spy).toHaveBeenCalledTimes(2)
  expect(await (await getTelemetryStore(db)).getSpans(root.spanContext().traceId)).toHaveLength(3)
  expect(await (await getTraceIndexStore(db)).get(root.spanContext().traceId)).toMatchObject({
    active: false,
    spanCount: 3,
    revision: 4,
  })
  expect(snapshot.spans).toHaveLength(3)
  expect(recorder.snapshot().spans).toHaveLength(0)
})

test('a resume that ends before hydration continues persisted counts and revisions', async () => {
  const tracer = setup()
  const root = tracer.startSpan('root', { attributes: { 'mokei.kind': 'flow' } })
  root.end()
  await recorder.forceFlush()
  events.length = 0
  const resume = tracer.startSpan(
    'resume',
    { attributes: { 'mokei.root': true, 'mokei.kind': 'flow' } },
    trace.setSpan(ROOT_CONTEXT, root),
  )
  resume.end()
  await recorder.forceFlush()
  const summaries = events.flatMap((event) => (event.type === 'trace:summary' ? [event.data] : []))
  expect(summaries.map((summary) => summary.revision)).toEqual([3, 4])
  expect(summaries[0]).toMatchObject({ active: true, spanCount: 1 })
  expect(summaries[1]).toMatchObject({
    active: false,
    spanCount: 2,
    rootSpanID: root.spanContext().spanId,
  })
})

test('a non-root end hydrates an existing active summary without changing root metadata', async () => {
  const tracer = setup()
  const root = tracer.startSpan('root', { attributes: { 'mokei.kind': 'flow' } })
  await recorder.forceFlush()
  await recorder.shutdown()
  const next = setup()
  next
    .startSpan('child', {}, trace.setSpan(ROOT_CONTEXT, root))
    .setStatus({ code: SpanStatusCode.ERROR })
    .end()
  await recorder.forceFlush()
  expect(await (await getTraceIndexStore(db)).get(root.spanContext().traceId)).toMatchObject({
    active: true,
    outcome: null,
    kind: 'flow',
    name: 'root',
    rootSpanID: root.spanContext().spanId,
    activeSegmentSpanID: root.spanContext().spanId,
    spanCount: 1,
    errorCount: 1,
    revision: 2,
  })
})
