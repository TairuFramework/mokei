import type { StoredLog, StoredSpan } from '@mokei/host-protocol'

export type { StoredLog, StoredSpan } from '@mokei/host-protocol'

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
  // Compacts in place: spreading every row into splice() can exceed the argument limit.
  function removeLogs(matches: (value: StoredLog) => boolean): number {
    let kept = 0
    for (const row of logs) {
      if (!matches(row.value)) logs[kept++] = row
    }
    const removed = logs.length - kept
    logs.length = kept
    return removed
  }
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
        .sort((left, right) => {
          return left.value.startTime - right.value.startTime || left.sequence - right.sequence
        })
        .map(({ value }) => copy(value))
      const traceLogs = logs
        .filter(({ value }) => value.traceID === traceID)
        .sort((left, right) => {
          return left.value.timestamp - right.value.timestamp || left.sequence - right.sequence
        })
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
      const logCount = removeLogs((value) => selected.has(value.traceID))
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
      const logCount = removeLogs((value) => value.timestamp < time && !kept.has(value.traceID))
      return { spans: spanCount, logs: logCount }
    },
  }
}
