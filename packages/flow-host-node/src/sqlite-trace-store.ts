import type { DatabaseSync } from 'node:sqlite'
import type { StoredLog, StoredSpan, TraceStore } from '@mokei/flow-host'

import { withTransaction } from './transaction.js'

export function createSQLiteTraceStore(db: DatabaseSync): TraceStore {
  const addSpan =
    db.prepare(`INSERT INTO spans (trace_id, span_id, start_time, end_time, data) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(trace_id, span_id) DO UPDATE SET start_time = excluded.start_time, end_time = excluded.end_time, data = excluded.data`)
  const addLog = db.prepare('INSERT INTO logs (trace_id, timestamp, data) VALUES (?, ?, ?)')
  const getSpans = db.prepare(
    'SELECT data FROM spans WHERE trace_id = ? ORDER BY start_time ASC, seq ASC',
  )
  const getLogs = db.prepare(
    'SELECT data FROM logs WHERE trace_id = ? ORDER BY timestamp ASC, seq ASC',
  )
  function deleteSelected(ids: Array<string>, before?: number): { spans: number; logs: number } {
    return withTransaction(db, () => {
      // One bound ID per insert avoids SQLite's variable limit for arbitrarily large sets.
      db.exec('CREATE TEMP TABLE flow_trace_selection (trace_id TEXT PRIMARY KEY)')
      const insert = db.prepare('INSERT OR IGNORE INTO flow_trace_selection (trace_id) VALUES (?)')
      for (const id of ids) insert.run(id)
      const selected = 'trace_id IN (SELECT trace_id FROM flow_trace_selection)'
      const spanDelete = db.prepare(
        `DELETE FROM spans WHERE ${before == null ? selected : `end_time < ? AND NOT (${selected})`}`,
      )
      const logDelete = db.prepare(
        `DELETE FROM logs WHERE ${before == null ? selected : `timestamp < ? AND NOT (${selected})`}`,
      )
      const spans = Number((before == null ? spanDelete.run() : spanDelete.run(before)).changes)
      const logs = Number((before == null ? logDelete.run() : logDelete.run(before)).changes)
      db.exec('DROP TABLE flow_trace_selection')
      return { spans, logs }
    })
  }
  return {
    async addSpans(spans) {
      for (const span of spans) {
        const data = JSON.stringify(span)
        const stored = JSON.parse(data) as StoredSpan
        addSpan.run(stored.traceID, stored.spanID, stored.startTime, stored.endTime, data)
      }
    },
    async addLogs(logs) {
      for (const log of logs) {
        const data = JSON.stringify(log)
        const stored = JSON.parse(data) as StoredLog
        addLog.run(stored.traceID, stored.timestamp, data)
      }
    },
    async getTrace(traceID) {
      return {
        spans: getSpans.all(traceID).map((row) => JSON.parse(row.data as string) as StoredSpan),
        logs: getLogs.all(traceID).map((row) => JSON.parse(row.data as string) as StoredLog),
      }
    },
    async deleteTraces(traceIDs) {
      return traceIDs.length === 0 ? { spans: 0, logs: 0 } : deleteSelected(traceIDs)
    },
    async deleteBefore(time, keepTraceIDs) {
      return deleteSelected(keepTraceIDs, time)
    },
  }
}
