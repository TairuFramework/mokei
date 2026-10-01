import type { LogLevel } from '@logtape/logtape'
import type { JSONValue } from '@mokei/context-server'

export type StoredSpan = {
  traceID: string
  spanID: string
  parentSpanID?: string
  name: string
  kind: number
  startTime: number
  endTime: number
  status: { code: number; message?: string }
  attributes: Record<string, JSONValue>
  events: Array<{ name: string; time: number; attributes: Record<string, JSONValue> }>
  links: Array<{ traceID: string; spanID: string }>
}

export type StoredLog = {
  traceID: string
  spanID: string
  timestamp: number
  level: LogLevel
  category: Array<string>
  message: string
  properties: Record<string, JSONValue>
}

export type TraceStore = {
  addSpans(spans: Array<StoredSpan>): Promise<void>
  addLogs(logs: Array<StoredLog>): Promise<void>
  getTrace(traceID: string): Promise<{ spans: Array<StoredSpan>; logs: Array<StoredLog> }>
  deleteTraces(traceIDs: Array<string>): Promise<{ spans: number; logs: number }>
  deleteBefore(time: number, keepTraceIDs: Array<string>): Promise<{ spans: number; logs: number }>
}

type SpanRow = { sequence: number; value: StoredSpan }
type LogRow = { sequence: number; value: StoredLog }

function copy<TValue>(value: TValue): TValue {
  return JSON.parse(JSON.stringify(value)) as TValue
}

export function createMemoryTraceStore(): TraceStore {
  const spans = new Map<string, SpanRow>()
  const logs: Array<LogRow> = []
  let sequence = 0

  return {
    async addSpans(batch) {
      for (const span of batch) {
        const key = JSON.stringify([span.traceID, span.spanID])
        const existing = spans.get(key)
        spans.set(key, { sequence: existing?.sequence ?? sequence++, value: copy(span) })
      }
    },
    async addLogs(batch) {
      for (const log of batch) logs.push({ sequence: sequence++, value: copy(log) })
    },
    async getTrace(traceID) {
      const traceSpans = [...spans.values()]
        .filter(({ value }) => value.traceID === traceID)
        .sort(
          (left, right) =>
            left.value.startTime - right.value.startTime || left.sequence - right.sequence,
        )
        .map(({ value }) => copy(value))
      const traceLogs = logs
        .filter(({ value }) => value.traceID === traceID)
        .sort(
          (left, right) =>
            left.value.timestamp - right.value.timestamp || left.sequence - right.sequence,
        )
        .map(({ value }) => copy(value))
      return { spans: traceSpans, logs: traceLogs }
    },
    async deleteTraces(traceIDs) {
      const selected = new Set(traceIDs)
      let spanCount = 0
      for (const [key, row] of spans) {
        if (selected.has(row.value.traceID)) {
          spans.delete(key)
          spanCount++
        }
      }
      const remainingLogs = logs.filter(({ value }) => !selected.has(value.traceID))
      const logCount = logs.length - remainingLogs.length
      logs.splice(0, logs.length, ...remainingLogs)
      return { spans: spanCount, logs: logCount }
    },
    async deleteBefore(time, keepTraceIDs) {
      const kept = new Set(keepTraceIDs)
      let spanCount = 0
      for (const [key, row] of spans) {
        if (row.value.endTime < time && !kept.has(row.value.traceID)) {
          spans.delete(key)
          spanCount++
        }
      }
      const remainingLogs = logs.filter(
        ({ value }) => !(value.timestamp < time && !kept.has(value.traceID)),
      )
      const logCount = logs.length - remainingLogs.length
      logs.splice(0, logs.length, ...remainingLogs)
      return { spans: spanCount, logs: logCount }
    },
  }
}
