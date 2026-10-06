import type { HozonDB } from '@hozon/db'
import type { LogStore } from '@hozon/store-log'
import { getLogStore } from '@hozon/store-log'
import type { TelemetryStore } from '@hozon/store-telemetry'
import { getTelemetryStore } from '@hozon/store-telemetry'
import { afterEach } from 'vitest'

import { openMokeiDatabase } from '../../src/database.js'

export async function openTestStores(): Promise<{
  db: HozonDB
  logStore: LogStore
  telemetryStore: TelemetryStore
}> {
  const db = await openMokeiDatabase({ path: ':memory:' })
  return {
    db,
    logStore: await getLogStore(db),
    telemetryStore: await getTelemetryStore(db),
  }
}

export function useTestStores() {
  const databases: Array<HozonDB> = []
  afterEach(async () => {
    for (const db of databases.splice(0)) await db.close()
  })

  return async function stores() {
    const result = await openTestStores()
    databases.push(result.db)
    return result
  }
}
