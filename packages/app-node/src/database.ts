import type { HozonDB } from '@hozon/db'
import { type OpenLocalDatabaseParams, openLocalDatabase } from '@tejika/db'

import { mokeiLogStoreDefinition, mokeiTelemetryStoreDefinition } from './telemetry-store.js'
import { traceIndexStoreDefinition } from './trace-index.js'

export const mokeiStoreDefinitions = [
  mokeiLogStoreDefinition,
  mokeiTelemetryStoreDefinition,
  traceIndexStoreDefinition,
]

export function openMokeiDatabase(
  params: { path?: string; stores?: ReadonlyArray<OpenLocalDatabaseParams['stores'][number]> } = {},
): Promise<HozonDB> {
  return openLocalDatabase({
    app: 'mokei',
    tablePrefix: 'mokei',
    path: params.path,
    stores: [...mokeiStoreDefinitions, ...(params.stores ?? [])],
  })
}
