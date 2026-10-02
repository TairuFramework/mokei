import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { RunRecord, RunStore } from '@mokei/flow-host'
import { RunStoreConflictError } from '@mokei/flow-host'

export function createSQLiteRunStore(db: DatabaseSync): RunStore {
  const get = db.prepare('SELECT data FROM runs WHERE run_id = ?')
  const insert =
    db.prepare(`INSERT INTO runs (run_id, state, revision, created_at, updated_at, trace_id, task_id, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(run_id) DO NOTHING`)
  const update =
    db.prepare(`UPDATE runs SET state = ?, revision = ?, created_at = ?, updated_at = ?, trace_id = ?, task_id = ?, data = ?
    WHERE run_id = ? AND revision = ?`)
  const remove = db.prepare('DELETE FROM runs WHERE run_id = ?')
  function read(runID: string): RunRecord | undefined {
    const row = get.get(runID)
    return row == null ? undefined : (JSON.parse(row.data as string) as RunRecord)
  }
  return {
    async create(record) {
      const data = JSON.stringify(record)
      const stored = JSON.parse(data) as RunRecord
      const result = insert.run(
        stored.runID,
        stored.state,
        stored.revision,
        stored.createdAt,
        stored.updatedAt,
        stored.traceID ?? null,
        stored.taskID ?? null,
        data,
      )
      if (Number(result.changes) === 0)
        throw new RunStoreConflictError(`Run already exists: ${stored.runID}`)
    },
    async get(runID) {
      return read(runID)
    },
    async update(runID, patch, expected) {
      const record = read(runID)
      if (record == null) throw new Error(`Run not found: ${runID}`)
      if (record.revision !== expected.revision) throw new RunStoreConflictError()
      const data = JSON.stringify({ ...record, ...patch, runID, revision: record.revision + 1 })
      const stored = JSON.parse(data) as RunRecord
      const result = update.run(
        stored.state,
        stored.revision,
        stored.createdAt,
        stored.updatedAt,
        stored.traceID ?? null,
        stored.taskID ?? null,
        data,
        runID,
        expected.revision,
      )
      if (Number(result.changes) === 0) throw new RunStoreConflictError()
      return stored
    },
    async list(filter) {
      if (filter.limit != null && (!Number.isInteger(filter.limit) || filter.limit < 0)) {
        throw new RangeError('Run list limit must be a non-negative integer')
      }
      if (filter.states?.length === 0 || filter.limit === 0) return []
      const conditions: Array<string> = []
      const values: Array<SQLInputValue> = []
      if (filter.states != null) {
        conditions.push(`state IN (${filter.states.map(() => '?').join(', ')})`)
        values.push(...filter.states)
      }
      if (filter.updatedBefore != null) {
        conditions.push('updated_at < ?')
        values.push(filter.updatedBefore)
      }
      let sql = `SELECT data FROM runs${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''} ORDER BY created_at DESC, seq ASC`
      if (filter.limit != null) {
        sql += ' LIMIT ?'
        // Larger valid limits cannot bind as SQLite integers and cannot limit a JS array.
        values.push(Math.min(filter.limit, Number.MAX_SAFE_INTEGER))
      }
      return db
        .prepare(sql)
        .all(...values)
        .map((row) => JSON.parse(row.data as string) as RunRecord)
    },
    async delete(runID) {
      remove.run(runID)
    },
  }
}
