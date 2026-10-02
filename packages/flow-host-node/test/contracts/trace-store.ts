import type { TraceStore } from '@mokei/flow-host'
import { describe, expect, test } from 'vitest'

import { logRecord, mutateNested, spanRecord } from '../support/records.js'
export function traceStoreContract(name: string, create: () => TraceStore): void {
  describe(name, () => {
    test('round-trips fractional times and isolates every nested boundary', async () => {
      const store = create()
      const spans = [spanRecord()]
      const logs = [logRecord()]
      await store.addSpans(spans)
      await store.addLogs(logs)
      mutateNested(spans)
      mutateNested(logs)
      expect(await store.getTrace('trace-one')).toEqual({
        spans: [spanRecord()],
        logs: [logRecord()],
      })
      mutateNested(await store.getTrace('trace-one'))
      expect(await store.getTrace('trace-one')).toEqual({
        spans: [spanRecord()],
        logs: [logRecord()],
      })
      const patch = spanRecord({ name: 'updated' })
      await store.addSpans([patch])
      mutateNested(patch)
      expect((await store.getTrace('trace-one')).spans).toEqual([spanRecord({ name: 'updated' })])
    })
    test('upserts span pairs preserving sequence and orders timestamp ties', async () => {
      const store = create()
      await store.addSpans([
        spanRecord({ spanID: 'first', startTime: 3 }),
        spanRecord({ spanID: 'second', startTime: 1 }),
        spanRecord({ spanID: 'third', startTime: 1 }),
      ])
      await store.addSpans([
        spanRecord({ spanID: 'first', startTime: 1, endTime: 9, name: 'updated' }),
        spanRecord({ traceID: 'other' }),
      ])
      await store.addLogs([
        logRecord({ timestamp: 3, message: 'late' }),
        logRecord({ timestamp: 1, message: 'first' }),
        logRecord({ timestamp: 1, message: 'second' }),
      ])
      const trace = await store.getTrace('trace-one')
      expect(trace.spans.map((span) => span.spanID)).toEqual(['first', 'second', 'third'])
      expect(trace.spans[0]).toMatchObject({ name: 'updated', endTime: 9 })
      expect(trace.logs.map((log) => log.message)).toEqual(['first', 'second', 'late'])
      expect((await store.getTrace('other')).spans).toHaveLength(1)
    })
    test('uses strict end-time cutoff, keeps traces and reports actual counts', async () => {
      const store = create()
      await store.addSpans([
        spanRecord({ traceID: 'old', endTime: 4 }),
        spanRecord({ traceID: 'boundary', startTime: 1, endTime: 5 }),
        spanRecord({ traceID: 'kept' }),
      ])
      await store.addLogs([
        logRecord({ traceID: 'old', timestamp: 4 }),
        logRecord({ traceID: 'boundary', timestamp: 5 }),
        logRecord({ traceID: 'kept' }),
      ])
      expect(await store.deleteBefore(5, ['kept'])).toEqual({ spans: 1, logs: 1 })
      expect(await store.getTrace('old')).toEqual({ spans: [], logs: [] })
      for (const id of ['boundary', 'kept']) {
        const trace = await store.getTrace(id)
        expect(trace.spans).toHaveLength(1)
        expect(trace.logs).toHaveLength(1)
      }
      expect(await store.deleteTraces(['kept', 'kept', 'missing'])).toEqual({ spans: 1, logs: 1 })
      expect(await store.deleteBefore(6, [])).toEqual({ spans: 1, logs: 1 })
      expect(await store.deleteTraces(['missing'])).toEqual({ spans: 0, logs: 0 })
    })
    test('handles missing IDs and empty collections', async () => {
      const store = create()
      await store.addSpans([])
      await store.addLogs([])
      expect(await store.getTrace('missing')).toEqual({ spans: [], logs: [] })
      await store.addSpans([spanRecord()])
      await store.addLogs([logRecord()])
      expect(await store.deleteTraces([])).toEqual({ spans: 0, logs: 0 })
      expect(await store.deleteBefore(0, [])).toEqual({ spans: 0, logs: 0 })
      expect(await store.deleteTraces(['trace-one'])).toEqual({ spans: 1, logs: 1 })
    })
    test('protects a large keep set', async () => {
      const store = create()
      await store.addSpans([spanRecord()])
      await store.addLogs([logRecord()])
      const kept = Array.from({ length: 40000 }, (_, index) => `trace-${index}`)
      kept[20000] = 'trace-one'
      expect(await store.deleteBefore(100, kept)).toEqual({ spans: 0, logs: 0 })
      expect(await store.getTrace('trace-one')).toEqual({
        spans: [spanRecord()],
        logs: [logRecord()],
      })
    })
  })
}
