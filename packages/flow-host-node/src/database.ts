import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { getDataDir } from '@tejika/env'

import { migrateFlowDatabase } from './migrations.js'

type OpenFlowDatabaseParams = {
  path?: string
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
    const { user_version: version } = db.prepare('PRAGMA user_version').get() as {
      user_version: number
    }
    if (version > 1) {
      throw new Error(`Database schema version ${version} is newer than supported version 1`)
    }

    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec('PRAGMA foreign_keys = ON')
    migrateFlowDatabase(db)

    return { db, close: () => db.close() }
  } catch (error) {
    db.close()
    throw error
  }
}
