import type { HozonDB } from '@hozon/db'
import { logStoreDefinition } from '@hozon/store-log'
import { telemetryStoreDefinition } from '@hozon/store-telemetry'
import { type OpenLocalDatabaseParams, openLocalDatabase } from '@tejika/db'

export const mokeiStoreDefinitions = [logStoreDefinition, telemetryStoreDefinition]

export function openMokeiDatabase(
  params: { path?: string; stores?: ReadonlyArray<OpenLocalDatabaseParams['stores'][number]> } = {},
): Promise<HozonDB> {
  return openLocalDatabase({
    app: 'mokei',
    path: params.path,
    stores: [...mokeiStoreDefinitions, ...(params.stores ?? [])],
  })
}
