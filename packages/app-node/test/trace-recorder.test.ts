import type { HozonDB } from '@hozon/db'
import { getLogStore } from '@hozon/store-log'
import { getTelemetryStore } from '@hozon/store-telemetry'
import type { LogRecord } from '@logtape/logtape'
import { context, ROOT_CONTEXT, SpanStatusCode, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
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
  await settle()
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
  const last = tracer.startSpan('span-200')
  await vi.advanceTimersByTimeAsync(0)
  last.end()
  await settle()
  await recorder.forceFlush()
  expect(transaction).toHaveBeenCalledOnce()
  expect(recorder.snapshot().spans).toHaveLength(0)
})

test('flushes at the interval', async () => {
  setup().startSpan('root').end()
  await vi.advanceTimersByTimeAsync(250)
  await settle()
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
  await settle()
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
  await settle()
  tracer.startSpan('old').end()
  await settle()
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
  await settle()
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
  await settle()
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
  await settle()
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
  await settle()
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
  await settle()
  await recorder.forceFlush()
  expect(await (await getTelemetryStore(db)).getSpans(span.spanContext().traceId)).toEqual([])
  expect(await (await getTraceIndexStore(db)).get(span.spanContext().traceId)).toBeUndefined()
  expect(recorder.info().droppedCount).toBe(1)
  vi.restoreAllMocks()
  // The loss summary survives the rollback and is persisted by the next flush.
  await settle()
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
  await settle()
  await recorder.forceFlush()
  events.length = 0
  const resume = tracer.startSpan(
    'resume',
    { attributes: { 'mokei.root': true, 'mokei.kind': 'flow' } },
    trace.setSpan(ROOT_CONTEXT, root),
  )
  resume.end()
  await settle()
  await recorder.forceFlush()
  const summaries = events.flatMap((event) => (event.type === 'trace:summary' ? [event.data] : []))
  expect(summaries.map((summary) => summary.revision)).toEqual([4])
  expect(summaries[0]).toMatchObject({
    active: false,
    spanCount: 2,
    rootSpanID: root.spanContext().spanId,
  })
})

test('a non-root end hydrates an existing active summary without changing root metadata', async () => {
  const tracer = setup()
  const root = tracer.startSpan('root', { attributes: { 'mokei.kind': 'flow' } })
  await settle()
  await recorder.forceFlush()
  await recorder.shutdown()
  const next = setup()
  next
    .startSpan('child', {}, trace.setSpan(ROOT_CONTEXT, root))
    .setStatus({ code: SpanStatusCode.ERROR })
    .end()
  await settle()
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

test('snapshot immediately after resume excludes the unresolved summary', async () => {
  const tracer = setup()
  const root = tracer.startSpan('root')
  root.end()
  await settle()
  await recorder.forceFlush()
  const store = await getTraceIndexStore(db)
  const persisted = await store.get(root.spanContext().traceId)
  const release = deferred()
  vi.spyOn(store, 'get').mockImplementation(async () => {
    await release.promise
    return persisted
  })
  const getStore = db.getStore.bind(db)
  vi.spyOn(db, 'getStore').mockImplementation(async (name) =>
    name === 'trace-index' ? store : getStore(name),
  )
  const resume = tracer.startSpan(
    'resume',
    { attributes: { 'mokei.root': true } },
    trace.setSpan(ROOT_CONTEXT, root),
  )
  try {
    expect(recorder.snapshot().summaries).toEqual([])
    expect(recorder.snapshot().open[0]?.spanID).toBe(resume.spanContext().spanId)
    await settle()
    expect(recorder.snapshot().summaries).toEqual([])
  } finally {
    release.resolve()
    await settle()
  }
  expect(recorder.snapshot().summaries[0]).toMatchObject({
    rootSpanID: persisted?.rootSpanID,
    revision: 3,
    spanCount: 1,
    active: true,
  })
})

test('failed hydration retries without writing provisional summaries and preserves pending changes', async () => {
  const tracer = setup({ flushIntervalMs: 60000, reportError: vi.fn() })
  const root = tracer.startSpan('root')
  root.end()
  await settle()
  await recorder.forceFlush()
  const store = await getTraceIndexStore(db)
  const get = store.get.bind(store)
  const read = vi
    .spyOn(store, 'get')
    .mockRejectedValueOnce(new Error('read failed'))
    .mockImplementation(get)
  const getStore = db.getStore.bind(db)
  vi.spyOn(db, 'getStore').mockImplementation(async (name) =>
    name === 'trace-index' ? store : getStore(name),
  )
  const resume = tracer.startSpan(
    'resume',
    { attributes: { 'mokei.root': true } },
    trace.setSpan(ROOT_CONTEXT, root),
  )
  resume.end()
  await settle()
  tracer
    .startSpan('child during retry', {}, trace.setSpan(ROOT_CONTEXT, root))
    .setStatus({ code: SpanStatusCode.ERROR })
    .end()
  await settle()
  await recorder.forceFlush()
  expect(await get(root.spanContext().traceId)).toMatchObject({ revision: 2, spanCount: 1 })
  expect(recorder.snapshot().summaries).toEqual([])
  await vi.advanceTimersByTimeAsync(249)
  expect(read).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  await settle()
  await recorder.forceFlush()
  expect(await get(root.spanContext().traceId)).toMatchObject({
    rootSpanID: root.spanContext().spanId,
    revision: 5,
    spanCount: 3,
    errorCount: 1,
  })
  expect(recorder.info().lostSummaryCount).toBe(0)
})

test('hydration exhaustion uses all retry delays and reports loss without replacing persisted data', async () => {
  const tracer = setup({ flushIntervalMs: 60000, reportError: vi.fn() })
  const root = tracer.startSpan('root')
  root.end()
  await settle()
  await recorder.forceFlush()
  const store = await getTraceIndexStore(db)
  const get = store.get.bind(store)
  const read = vi.spyOn(store, 'get').mockRejectedValue(new Error('read failed'))
  const getStore = db.getStore.bind(db)
  vi.spyOn(db, 'getStore').mockImplementation(async (name) =>
    name === 'trace-index' ? store : getStore(name),
  )
  tracer
    .startSpan('resume', { attributes: { 'mokei.root': true } }, trace.setSpan(ROOT_CONTEXT, root))
    .end()
  await settle()
  for (const [index, delay] of [250, 1000, 4000].entries()) {
    await vi.advanceTimersByTimeAsync(delay - 1)
    expect(read).toHaveBeenCalledTimes(index + 1)
    await vi.advanceTimersByTimeAsync(1)
    expect(read).toHaveBeenCalledTimes(index + 2)
  }
  await settle()
  await recorder.forceFlush()
  expect(recorder.info().lostSummaryCount).toBe(1)
  expect(await get(root.spanContext().traceId)).toMatchObject({ revision: 2, spanCount: 1 })
  expect(recorder.snapshot().summaries).toEqual([])
})

test('stalled hydration retains one delta, bounds unresolved traces and allows unrelated flush and shutdown', async () => {
  const tracer = setup({
    dirtySummaryLimit: 1,
    queueLimit: 2,
    flushBatchSize: 10000,
    reportError: vi.fn(),
  })
  const ready = tracer.startSpan('ready')
  await settle()
  const store = await getTraceIndexStore(db)
  const get = store.get.bind(store)
  const release = deferred()
  const read = vi.spyOn(store, 'get').mockImplementation(async () => {
    await release.promise
    return undefined
  })
  const getStore = db.getStore.bind(db)
  vi.spyOn(db, 'getStore').mockImplementation(async (name) =>
    name === 'trace-index' ? store : getStore(name),
  )
  const stalled = tracer.startSpan('stalled')
  for (let i = 0; i < 50; i++)
    tracer.startSpan('child', {}, trace.setSpan(ROOT_CONTEXT, stalled)).end()
  tracer.startSpan('overflow')
  await settle()
  expect(read).toHaveBeenCalledTimes(1)
  expect(recorder.info()).toEqual({ droppedCount: 48, lostSummaryCount: 1 })
  let flushed = false
  void recorder.forceFlush().then(() => {
    flushed = true
  })
  await vi.advanceTimersByTimeAsync(0)
  expect(flushed).toBe(true)
  expect(await get(ready.spanContext().traceId)).toMatchObject({ active: true, revision: 1 })
  expect(await (await getTelemetryStore(db)).getSpans(stalled.spanContext().traceId)).toHaveLength(
    2,
  )
  expect(recorder.snapshot().summaries.map((summary) => summary.name)).toEqual(['ready'])
  let stopped = false
  void recorder.shutdown().then(() => {
    stopped = true
  })
  await settle()
  expect(stopped).toBe(true)
  expect(recorder.info().lostSummaryCount).toBe(2)
  release.resolve()
  await settle()
  expect(recorder.snapshot().summaries.map((summary) => summary.traceID)).toEqual([
    ready.spanContext().traceId,
  ])
})

test('persisted active child updates survive ready-summary cap pressure before hydration', async () => {
  const tracer = setup()
  const root = tracer.startSpan('root', { attributes: { 'mokei.kind': 'flow' } })
  await settle()
  await recorder.forceFlush()
  await recorder.shutdown()
  const next = setup({ dirtySummaryLimit: 1, reportError: vi.fn() })
  const active = next.startSpan('another active')
  await settle()
  const store = await getTraceIndexStore(db)
  const get = store.get.bind(store)
  const release = deferred()
  vi.spyOn(store, 'get').mockImplementation(async (traceID) => {
    if (traceID === root.spanContext().traceId) await release.promise
    return get(traceID)
  })
  const getStore = db.getStore.bind(db)
  vi.spyOn(db, 'getStore').mockImplementation(async (name) =>
    name === 'trace-index' ? store : getStore(name),
  )
  next
    .startSpan('child', {}, trace.setSpan(ROOT_CONTEXT, root))
    .setStatus({ code: SpanStatusCode.ERROR })
    .end()
  await settle()
  const pendingSnapshot = recorder.snapshot()
  const pendingInfo = recorder.info()
  release.resolve()
  expect(pendingSnapshot.summaries.map((summary) => summary.name)).toEqual(['another active'])
  expect(pendingInfo.lostSummaryCount).toBe(0)
  await settle()
  await recorder.forceFlush()
  expect(await get(root.spanContext().traceId)).toMatchObject({
    active: true,
    rootSpanID: root.spanContext().spanId,
    name: 'root',
    spanCount: 1,
    errorCount: 1,
    revision: 2,
  })
  active.end()
})

test('hydration coalesces a burst into one summary with all count and loss deltas', async () => {
  const tracer = setup({ queueLimit: 2, flushBatchSize: 10000, reportError: vi.fn() })
  const store = await getTraceIndexStore(db)
  const release = deferred()
  vi.spyOn(store, 'get').mockImplementation(async () => {
    await release.promise
    return undefined
  })
  const getStore = db.getStore.bind(db)
  vi.spyOn(db, 'getStore').mockImplementation(async (name) =>
    name === 'trace-index' ? store : getStore(name),
  )
  const root = tracer.startSpan('root')
  for (let i = 0; i < 50; i++)
    tracer
      .startSpan('child', {}, trace.setSpan(ROOT_CONTEXT, root))
      .setStatus({ code: SpanStatusCode.ERROR })
      .end()
  await settle()
  expect(events.filter((event) => event.type === 'trace:summary')).toHaveLength(0)
  release.resolve()
  await settle()
  expect(events.filter((event) => event.type === 'trace:summary')).toHaveLength(1)
  expect(recorder.snapshot().summaries[0]).toMatchObject({
    active: true,
    spanCount: 50,
    errorCount: 50,
    droppedCount: 48,
    revision: 99,
  })
})

function logRecord(category = ['application']): LogRecord {
  return {
    timestamp: Date.now(),
    level: 'info',
    category,
    message: ['hello ', 'world'],
    rawMessage: 'hello {name}',
    properties: { name: 'world', nested: { value: 1 }, 'dev.mokei/logID': 'caller-id' },
  }
}

function withLogSpan(action: () => void) {
  const manager = new AsyncLocalStorageContextManager().enable()
  context.setGlobalContextManager(manager)
  const span = trace.wrapSpanContext({
    traceId: '12345678901234567890123456789012',
    spanId: '1234567890123456',
    traceFlags: 1,
  })
  try {
    context.with(trace.setSpan(context.active(), span), action)
  } finally {
    context.disable()
  }
}

test('traced log records get a logID, are queued and emitted as log events', async () => {
  const span = setup().startSpan('root')
  const manager = new AsyncLocalStorageContextManager().enable()
  context.setGlobalContextManager(manager)
  const record = logRecord()
  try {
    context.with(trace.setSpan(context.active(), span), () => recorder.sink(record))
  } finally {
    context.disable()
  }
  const log = recorder.snapshot().logs[0]
  expect(log).toMatchObject({
    traceID: span.spanContext().traceId,
    spanID: span.spanContext().spanId,
    timestamp: record.timestamp,
    level: 'info',
    category: ['application'],
    message: 'hello {name}',
    logID: expect.any(String),
    properties: { name: 'world', nested: { value: 1 } },
  })
  expect(log?.logID).not.toBe('caller-id')
  expect(log?.properties['dev.mokei/logID']).toBe(log?.logID)
  expect(events.filter((event) => event.type === 'log')).toEqual([{ type: 'log', data: log }])
  record.properties.nested = 'changed'
  expect(recorder.snapshot().logs[0]?.properties.nested).toEqual({ value: 1 })
  span.end()
  await settle()
  const transaction = vi.spyOn(db, 'withTransaction')
  await recorder.forceFlush()
  expect(transaction).toHaveBeenCalledOnce()
  const stored = await (await getLogStore(db)).getTraceLogs(span.spanContext().traceId)
  expect(stored[0]?.properties['dev.mokei/logID']).toBe(log?.logID)
  expect(await (await getTelemetryStore(db)).getSpans(span.spanContext().traceId)).toHaveLength(1)
  expect(recorder.snapshot().logs).toEqual([])
})

test('untraced records are ignored', () => {
  setup()
  recorder.sink(logRecord())
  expect(recorder.snapshot().logs).toEqual([])
  expect(events).toEqual([])
})

test('the hozon category and report categories are excluded', () => {
  setup({ reportCategories: [['test', 'report']] })
  withLogSpan(() => {
    recorder.sink(logRecord(['hozon', 'db']))
    recorder.sink(logRecord(['test', 'report', 'child']))
    recorder.sink(logRecord(['test', 'reporter']))
  })
  expect(recorder.snapshot().logs.map((log) => log.category)).toEqual([['test', 'reporter']])
})

test('logs share the bounded queue with spans and stop on shutdown', async () => {
  const span = setup({ queueLimit: 2, reportError: vi.fn() }).startSpan('root')
  await settle()
  span.end()
  withLogSpan(() => {
    recorder.sink(logRecord())
    recorder.sink(logRecord())
  })
  expect(recorder.snapshot().spans).toEqual([])
  expect(recorder.snapshot().logs).toHaveLength(2)
  expect(new Set(recorder.snapshot().logs.map((log) => log.logID)).size).toBe(2)
  expect(recorder.info().droppedCount).toBe(1)
  await recorder.shutdown()
  withLogSpan(() => recorder.sink(logRecord()))
  expect(recorder.snapshot().logs).toEqual([])
})

test('dropped logs count against a trace while its summary is hydrating', async () => {
  const span = setup({ queueLimit: 1, reportError: vi.fn() }).startSpan('root')
  const manager = new AsyncLocalStorageContextManager().enable()
  context.setGlobalContextManager(manager)
  try {
    context.with(trace.setSpan(context.active(), span), () => {
      recorder.sink(logRecord())
      recorder.sink(logRecord())
    })
  } finally {
    context.disable()
  }
  await settle()
  expect(recorder.info().droppedCount).toBe(1)
  expect(recorder.snapshot().summaries[0]?.droppedCount).toBe(1)
})
