import type { DatabaseSync } from 'node:sqlite'
import type { TaskRecord, TaskStore } from '@mokei/context-server'
import { TaskStoreConflictError } from '@mokei/context-server'

export function createSQLiteTaskStore(db: DatabaseSync): TaskStore {
  const get = db.prepare('SELECT data FROM tasks WHERE task_id = ?')
  const insert = db.prepare(
    'INSERT INTO tasks (task_id, status, revision, data) VALUES (?, ?, ?, ?) ON CONFLICT(task_id) DO NOTHING',
  )
  const update = db.prepare(
    'UPDATE tasks SET status = ?, revision = ?, data = ? WHERE task_id = ? AND revision = ?',
  )
  const remove = db.prepare('DELETE FROM tasks WHERE task_id = ?')
  function read(taskID: string): TaskRecord | undefined {
    const row = get.get(taskID)
    return row == null ? undefined : (JSON.parse(row.data as string) as TaskRecord)
  }
  return {
    async create(record) {
      const data = JSON.stringify(record)
      const stored = JSON.parse(data) as TaskRecord
      if (Number(insert.run(stored.taskID, stored.status, stored.revision, data).changes) === 0)
        throw new Error(`Task already exists: ${stored.taskID}`)
    },
    async get(taskID) {
      return read(taskID)
    },
    async update(taskID, patch, expected) {
      const record = read(taskID)
      if (record == null) throw new Error(`Task not found: ${taskID}`)
      if (record.revision !== expected.revision) throw new TaskStoreConflictError()
      const data = JSON.stringify({ ...record, ...patch, taskID, revision: record.revision + 1 })
      const stored = JSON.parse(data) as TaskRecord
      if (
        Number(
          update.run(stored.status, stored.revision, data, taskID, expected.revision).changes,
        ) === 0
      )
        throw new TaskStoreConflictError()
      return stored
    },
    async list(filter) {
      if (filter.status.length === 0) return []
      return db
        .prepare(
          `SELECT data FROM tasks WHERE status IN (${filter.status.map(() => '?').join(', ')}) ORDER BY seq ASC`,
        )
        .all(...filter.status)
        .map((row) => JSON.parse(row.data as string) as TaskRecord)
    },
    async delete(taskID) {
      remove.run(taskID)
    },
  }
}
