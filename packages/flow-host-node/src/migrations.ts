import type { DatabaseSync } from 'node:sqlite'

import { withTransaction } from './database.js'

export const migrations: Array<string> = [
  `CREATE TABLE runs (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  trace_id TEXT,
  task_id TEXT,
  data TEXT NOT NULL
);
CREATE INDEX runs_state ON runs (state, updated_at);
CREATE INDEX runs_created ON runs (created_at DESC, seq);
CREATE TABLE tasks (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX tasks_status ON tasks (status, seq);
CREATE TABLE spans (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  data TEXT NOT NULL,
  UNIQUE (trace_id, span_id)
);
CREATE INDEX spans_trace ON spans (trace_id, start_time, seq);
CREATE INDEX spans_end ON spans (end_time);
CREATE TABLE logs (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id TEXT NOT NULL,
  timestamp REAL NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX logs_trace ON logs (trace_id, timestamp, seq);
CREATE INDEX logs_time ON logs (timestamp);`,
]

export const migrateFlowDatabase = (db: DatabaseSync, list: Array<string> = migrations): void => {
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as {
    user_version: number
  }

  if (version > list.length) {
    throw new Error(
      `Database schema version ${version} is newer than supported version ${list.length}`,
    )
  }

  if (version === list.length) {
    return
  }

  withTransaction(db, () => {
    for (const [index, migration] of list.entries()) {
      if (index < version) {
        continue
      }
      db.exec(migration)
      db.exec(`PRAGMA user_version = ${index + 1}`)
    }
  })
}
