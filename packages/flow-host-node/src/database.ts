import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { getDataDir } from '@tejika/env'

import { migrateFlowDatabase } from './migrations.js'

type OpenFlowDatabaseParams = {
  path?: string
  migrations?: Array<string>
}

export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export const openFlowDatabase = (
  params: OpenFlowDatabaseParams,
): { db: DatabaseSync; close(): void } => {
  const path = params.path ?? join(getDataDir('mokei'), 'mokei.db')
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }

  const db = new DatabaseSync(path)

  try {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec('PRAGMA foreign_keys = ON')
    migrateFlowDatabase(db, params.migrations)

    return { db, close: () => db.close() }
  } catch (error) {
    db.close()
    throw error
  }
}
