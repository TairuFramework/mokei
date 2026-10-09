import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HozonDB } from '@hozon/db'
import { getLogStore } from '@hozon/store-log'
import {
  getTelemetryStore,
  type StoredSpan,
  telemetryStoreDefinition,
} from '@hozon/store-telemetry'
import type { TraceSummary } from '@mokei/host-protocol'
import { context, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { openLocalDatabase } from '@tejika/db'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import {
  createTraceReader,
  getTraceIndexStore,
  LocalTraceRecorder,
  openMokeiDatabase,
  type TraceReader,
} from '../src/index.js'

let db: HozonDB
let recorder: LocalTraceRecorder
let reader: TraceReader
beforeEach(async () => {
  db = await openMokeiDatabase({ path: ':memory:' })
  recorder = new LocalTraceRecorder({ provider: db, flushIntervalMs: 60000 })
  reader = createTraceReader({ provider: db, recorder })
})
afterEach(async () => {
  vi.restoreAllMocks()
  await recorder.shutdown()
  await db.close()
})
function start() {
  return new BasicTracerProvider({ spanProcessors: [recorder] })
    .getTracer('reader-test')
    .startSpan('root')
}
function stored(spanID = 'root', patch: Partial<StoredSpan> = {}): StoredSpan {
  return {
    traceID: 'trace',
    spanID,
    name: 'Historical flow',
    kind: 0,
    startTime: 100,
    endTime: 200,
    status: { code: 2 },
    attributes: { 'mokei.kind': 'flow', 'run.id': 'run', 'run.label': 'label' },
    events: [],
    links: [],
    ...patch,
  }
}
function summary(traceID: string, patch: Partial<TraceSummary> = {}): TraceSummary {
  return {
    traceID,
    rootSpanID: 'root',
    name: 'Flow',
    kind: 'flow',
    startTime: 100,
    active: false,
    outcome: 'ok',
    attributes: {},
    spanCount: 1,
    errorCount: 0,
    droppedCount: 0,
    revision: 1,
    ...patch,
  }
}
test('get returns open spans from the recorder', async () => {
  const span = start()
  const result = await reader.get(span.spanContext().traceId)
  expect(result?.spans).toEqual(recorder.snapshot().open)
  expect(result?.spans[0]).not.toHaveProperty('endTime')
  span.end()
})
test('get preserves JSON-looking string attributes after persistence', async () => {
  const span = start()
  const attributes = {
    'mokei.mcp.request': '{"_meta":{},"arguments":{"value":"trace me"},"name":"echo"}',
    array: '["trace me"]',
    whitespace: ' \n {"value":1}',
    strings: ['{"value":1}', '[1,2]', 'plain'],
    quoted: '"quoted"',
    prefixed: 'mokei-json:{"value":1}',
    plain: 'plain',
    number: 42,
    boolean: true,
  }
  span.setAttributes(attributes)
  span.addEvent('mcp.response', attributes)
  span.end()
  const traceID = span.spanContext().traceId
  expect((await reader.get(traceID))?.spans[0]?.attributes).toEqual(attributes)
  await recorder.forceFlush()
  expect(recorder.snapshot(traceID).spans).toEqual([])
  const result = await reader.get(traceID)
  expect(result?.spans).toHaveLength(1)
  expect(result?.spans[0]?.attributes['mokei.mcp.request']).toBe(attributes['mokei.mcp.request'])
  expect(result?.spans[0]?.attributes).toEqual(attributes)
  expect(result?.spans[0]).toMatchObject({ events: [{ attributes }] })
})
test('nested JSON-looking span and event attributes round-trip through the raw Hozon store', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mokei-attributes-'))
  const params = { path: join(directory, 'trace.sqlite') }
  const attributes = {
    object: '{"value":1}',
    array: '[1,2]',
    prefixed: 'mokei-json:{"value":1}',
    nested: { strings: ['{"value":1}', '[1,2]', 'mokei-json:plain'] },
    plain: 'plain',
    number: 42,
    boolean: true,
  }
  const events = [{ name: 'response', time: 150, attributes }]
  try {
    const writer = await openMokeiDatabase(params)
    try {
      await (await getTelemetryStore(writer)).addSpans([stored('root', { attributes, events })])
    } finally {
      await writer.close()
    }
    const raw = await openLocalDatabase({
      ...params,
      app: 'mokei',
      tablePrefix: 'mokei',
      stores: [telemetryStoreDefinition],
    })
    try {
      const spans = await (await getTelemetryStore(raw)).getSpans('trace')
      expect(spans[0]?.attributes).toEqual(attributes)
      expect(spans[0]?.events).toEqual(events)
    } finally {
      await raw.close()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
test('notification log properties retain JSON strings after flushing', async () => {
  const span = start()
  const properties = {
    payload: '{"method":"notifications/message","params":{"value":"trace me"}}',
    array: '[1,2]',
    whitespace: ' \n [1,2]',
    prefixed: 'mokei-json:{"value":1}',
    nested: { strings: ['{"value":1}', '[1,2]', 'mokei-json:plain'] },
    plain: 'plain',
    number: 42,
    boolean: true,
  }
  const manager = new AsyncLocalStorageContextManager().enable()
  context.setGlobalContextManager(manager)
  try {
    context.with(trace.setSpan(context.active(), span), () => {
      recorder.sink({
        timestamp: 100,
        level: 'info',
        category: ['mokei', 'mcp', 'notification'],
        message: ['Notification'],
        rawMessage: 'Notification',
        properties,
      })
    })
  } finally {
    context.disable()
  }
  const traceID = span.spanContext().traceId
  expect((await reader.get(traceID))?.logs[0]?.properties).toMatchObject(properties)
  span.end()
  await recorder.forceFlush()
  expect(recorder.snapshot(traceID).logs).toEqual([])
  const result = await reader.get(traceID)
  expect(result?.logs).toHaveLength(1)
  expect(result?.logs[0]?.properties.payload).toBe(properties.payload)
  expect(result?.logs[0]?.properties).toMatchObject(properties)
  const store = await getLogStore(db)
  expect((await store.getTraceLogs(traceID))[0]?.properties).toMatchObject(properties)
  expect((await store.queryLogs({ traceID, limit: 10 })).logs[0]?.properties).toMatchObject(
    properties,
  )
})
test('get returns a span committed between snapshot and read exactly once', async () => {
  const span = start()
  const telemetry = await getTelemetryStore(db)
  const getSpans = telemetry.getSpans.bind(telemetry)
  vi.spyOn(telemetry, 'getSpans').mockImplementationOnce(async (id) => {
    span.end()
    await recorder.forceFlush()
    return getSpans(id)
  })
  const result = await reader.get(span.spanContext().traceId)
  expect(result?.spans).toHaveLength(1)
  expect(result?.spans[0]).toHaveProperty('endTime')
})
test('get synthesises a summary for a trace with spans but no row', async () => {
  await (await getTelemetryStore(db)).addSpans([
    stored('child', { parentSpanID: 'root', startTime: 110 }),
    stored(),
  ])
  expect((await reader.get('trace'))?.summary).toEqual(
    summary('trace', {
      name: 'Historical flow',
      endTime: 200,
      outcome: 'error',
      spanCount: 2,
      errorCount: 2,
      attributes: { 'run.id': 'run', label: 'label' },
      revision: 0,
    }),
  )
})
test('get caps logs at 1000 and sets logsTruncated', async () => {
  await (await getTelemetryStore(db)).addSpans([stored()])
  const logs = Array.from({ length: 1500 }, (_, i) => ({
    traceID: 'trace',
    spanID: 'root',
    timestamp: i,
    level: 'info' as const,
    category: ['mokei', 'mcp', 'notification'],
    message: 'Notification',
    properties: { 'dev.mokei/logID': `log-${i}` },
  }))
  await (await getLogStore(db)).addLogs(logs.toReversed())
  const result = await reader.get('trace')
  expect(result?.logsTruncated).toBe(true)
  expect(result?.logs).toHaveLength(1000)
  expect(result?.logs[0]).toMatchObject({ timestamp: 500, logID: 'log-500' })
  expect(result?.logs.at(-1)).toMatchObject({ timestamp: 1499, logID: 'log-1499' })
  expect(
    (await createTraceReader({ provider: db, recorder, logLimit: 0 }).get('trace'))?.logs,
  ).toEqual([])
})
test('list overlays a newer in-memory summary over the stored row', async () => {
  const local = summary('trace', { active: true, outcome: null, revision: 2 })
  await (await getTraceIndexStore(db)).upsert([summary('trace')])
  vi.spyOn(recorder, 'snapshot').mockReturnValue({
    open: [],
    spans: [],
    logs: [],
    summaries: [local],
  })
  expect(await reader.list({ limit: 10, active: true })).toEqual({ traces: [local] })
  expect(await reader.list({ limit: 10, active: false })).toEqual({ traces: [] })
  expect((await reader.get('trace'))?.summary).toEqual(local)
})
test('list inserts active summaries in order and pages without skips', async () => {
  await (await getTraceIndexStore(db)).upsert([summary('a'), summary('b'), summary('d')])
  vi.spyOn(recorder, 'snapshot').mockReturnValue({
    open: [],
    spans: [],
    logs: [],
    summaries: [summary('c', { active: true, outcome: null })],
  })
  const first = await reader.list({ limit: 2 })
  expect(first.traces.map((row) => row.traceID)).toEqual(['d', 'c'])
  const second = await reader.list({ limit: 2, cursor: first.cursor })
  expect(second.traces.map((row) => row.traceID)).toEqual(['b', 'a'])
  expect(second.cursor).toBeUndefined()
  expect(await reader.list({ limit: 0 })).toEqual({ traces: [] })
})
test('get deduplicates queued and stored logs by logID', async () => {
  await (await getTelemetryStore(db)).addSpans([stored()])
  const log = {
    traceID: 'trace',
    spanID: 'root',
    timestamp: 100,
    level: 'info' as const,
    category: ['mokei'],
    message: 'queued',
    properties: { 'dev.mokei/logID': 'log' },
    logID: 'log',
  }
  await (await getLogStore(db)).addLogs([{ ...log, spanID: 'root' }])
  vi.spyOn(recorder, 'snapshot').mockReturnValue({
    open: [],
    spans: [],
    logs: [log],
    summaries: [],
  })
  expect((await reader.get('trace'))?.logs).toHaveLength(1)
  expect((await reader.get('trace'))?.logsTruncated).toBe(false)
})
test('get returns undefined for an unknown trace', async () => {
  expect(await reader.get('unknown')).toBeUndefined()
})

test('get preserves legacy logs without IDs, including identical notifications', async () => {
  await (await getTelemetryStore(db)).addSpans([stored()])
  const log = {
    traceID: 'trace',
    spanID: 'root',
    timestamp: 100,
    level: 'info' as const,
    category: ['mokei', 'mcp', 'notification'],
    message: 'legacy',
    properties: {},
  }
  await (await getLogStore(db)).addLogs([log, log])
  const result = await reader.get('trace')
  expect(result?.logs).toHaveLength(2)
  expect(new Set(result?.logs.map((entry) => entry.logID)).size).toBe(2)
  expect((await reader.get('trace'))?.logs).toEqual(result?.logs)
})

test('list and get retain a higher stored revision', async () => {
  const persisted = summary('trace', { revision: 3, name: 'ÉCLAIR 100%_done', outcome: 'error' })
  await (await getTraceIndexStore(db)).upsert([persisted])
  vi.spyOn(recorder, 'snapshot').mockReturnValue({
    open: [],
    spans: [],
    logs: [],
    summaries: [summary('trace', { active: true, revision: 2 })],
  })
  expect((await reader.get('trace'))?.summary).toEqual(persisted)
  expect(await reader.list({ limit: 1, active: true })).toEqual({ traces: [] })
  expect(
    await reader.list({
      limit: 1,
      kind: 'flow',
      active: false,
      outcome: 'error',
      name: 'éclair 100%_',
      since: 100,
      until: 100,
    }),
  ).toEqual({ traces: [persisted] })
  expect(await reader.list({ limit: 1, name: 'missing' })).toEqual({ traces: [] })
  expect(await reader.list({ limit: 1, since: 101 })).toEqual({ traces: [] })
  expect(await reader.list({ limit: 1, until: 99 })).toEqual({ traces: [] })
})

test('get returns queued spans committed after the snapshot exactly once', async () => {
  const span = start()
  span.end()
  const telemetry = await getTelemetryStore(db)
  const getSpans = telemetry.getSpans.bind(telemetry)
  vi.spyOn(telemetry, 'getSpans').mockImplementationOnce(async (id) => {
    await recorder.forceFlush()
    return getSpans(id)
  })
  const result = await reader.get(span.spanContext().traceId)
  expect(result?.spans).toHaveLength(1)
  expect(result?.spans[0]).toHaveProperty('endTime')
  expect(recorder.snapshot().spans).toEqual([])
})

test('name filtering matches label and flow ID in stored and live summaries', async () => {
  const persisted = summary('stored', {
    name: 'flow.run',
    attributes: { label: 'Éclair 100%_done!', 'flow.id': 'Review-Flow' },
  })
  const local = { ...persisted, traceID: 'live', revision: 2 }
  await (await getTraceIndexStore(db)).upsert([persisted])
  vi.spyOn(recorder, 'snapshot').mockReturnValue({
    open: [],
    spans: [],
    logs: [],
    summaries: [local],
  })
  for (const name of ['FLOW.RUN', 'éCLAIR', '100%_done!', 'REVIEW-flow']) {
    expect((await reader.list({ limit: 10, name })).traces.map((row) => row.traceID)).toEqual([
      'stored',
      'live',
    ])
  }
  expect((await reader.list({ limit: 10, name: 'missing' })).traces).toEqual([])
})
