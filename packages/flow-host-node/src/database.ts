import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { getDataDir } from '@tejika/env'

import { checkFlowDatabaseVersion, migrateFlowDatabase } from './migrations.js'

type OpenFlowDatabaseParams = {
  path?: string
  migrations?: Array<string>
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
    // Reject a newer schema before WAL mode persists a change to the file.
    checkFlowDatabaseVersion(db, params.migrations)
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
