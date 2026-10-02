import { describe, expect, test } from 'vitest'

import type { StoredLog, StoredSpan } from '../src/trace-store.js'
import { createMemoryTraceStore } from '../src/trace-store.js'

function span(spanID: string, startTime: number, traceID = 'trace'): StoredSpan {
  return {
    traceID,
    spanID,
    name: spanID,
    kind: 1,
    startTime,
    endTime: startTime + 1,
    status: { code: 0 },
    attributes: {},
    events: [],
    links: [],
  }
}

function log(timestamp: number, traceID = 'trace'): StoredLog {
  return {
    traceID,
    spanID: 'span',
    timestamp,
    level: 'info',
    category: ['test'],
    message: String(timestamp),
    properties: {},
  }
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected trace record')
  return value
}

describe('memory trace store', () => {
  test('orders spans and logs with stable insertion ties', async () => {
    const store = createMemoryTraceStore()
    await store.addSpans([span('late', 2.5), span('first', 1.5), span('second', 1.5)])
    await store.addLogs([log(20), log(10), { ...log(10), message: 'second' }])

    const trace = await store.getTrace('trace')
    expect(trace.spans.map(({ spanID }) => spanID)).toEqual(['first', 'second', 'late'])
    expect(trace.logs.map(({ message }) => message)).toEqual(['10', 'second', '20'])
  })

  test('overwrites a span without changing its insertion position', async () => {
    const store = createMemoryTraceStore()
    await store.addSpans([span('first', 1), span('second', 1)])
    await store.addSpans([{ ...span('first', 1), name: 'updated' }])

    const spans = (await store.getTrace('trace')).spans
    expect(spans).toHaveLength(2)
    expect(spans.map(({ name }) => name)).toEqual(['updated', 'second'])
  })

  test('copies batches and fetched nested records', async () => {
    const store = createMemoryTraceStore()
    const value = span('span', 1)
    value.attributes.nested = { values: ['original'] }
    value.events.push({ name: 'event', time: 1, attributes: { value: 'original' } })
    const entry = log(1)
    entry.properties.nested = { values: ['original'] }
    await store.addSpans([value])
    await store.addLogs([entry])

    ;(value.attributes.nested as { values: Array<string> }).values.push('input')
    required(value.events[0]).attributes.value = 'input'
    ;(entry.properties.nested as { values: Array<string> }).values.push('input')
    const fetched = await store.getTrace('trace')
    const fetchedSpan = required(fetched.spans[0])
    const fetchedLog = required(fetched.logs[0])
    ;(fetchedSpan.attributes.nested as { values: Array<string> }).values.push('output')
    required(fetchedSpan.events[0]).attributes.value = 'output'
    ;(fetchedLog.properties.nested as { values: Array<string> }).values.push('output')

    const later = await store.getTrace('trace')
    const laterSpan = required(later.spans[0])
    const laterLog = required(later.logs[0])
    expect(laterSpan.attributes.nested).toEqual({ values: ['original'] })
    expect(required(laterSpan.events[0]).attributes).toEqual({ value: 'original' })
    expect(laterLog.properties.nested).toEqual({ values: ['original'] })
  })

  test('deletes strictly older rows except kept traces', async () => {
    const store = createMemoryTraceStore()
    const liveTraceID = 'live'
    const boundaryTraceID = 'boundary'
    await store.addSpans([
      { ...span('old', 1, 'old'), endTime: 19 },
      { ...span('boundary', 1, boundaryTraceID), endTime: 20 },
      { ...span('live', 1, liveTraceID), endTime: 1 },
    ])
    await store.addLogs([log(19, 'old'), log(20, boundaryTraceID), log(1, liveTraceID)])

    expect(await store.deleteBefore(20, [liveTraceID])).toEqual({ spans: 1, logs: 1 })
    expect((await store.getTrace(boundaryTraceID)).spans).toHaveLength(1)
    expect((await store.getTrace(liveTraceID)).spans).toHaveLength(1)
    expect(await store.getTrace('missing')).toEqual({ spans: [], logs: [] })
    expect(await store.deleteTraces([])).toEqual({ spans: 0, logs: 0 })
    expect(await store.deleteTraces(['old', boundaryTraceID])).toEqual({ spans: 1, logs: 1 })
    expect(await store.deleteTraces(['old', boundaryTraceID])).toEqual({ spans: 0, logs: 0 })
  })
})
