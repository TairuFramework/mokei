import type { HozonDB } from '@hozon/db'
import { logStoreDefinition } from '@hozon/store-log'
import { telemetryStoreDefinition } from '@hozon/store-telemetry'
import { openLocalDatabase } from '@tejika/db'

import { runStoreDefinition } from './run-store.js'
import { taskStoreDefinition } from './task-store.js'

export const flowStoreDefinitions = [
  runStoreDefinition,
  taskStoreDefinition,
  telemetryStoreDefinition,
  logStoreDefinition,
]

export function openFlowDatabase(params: { path?: string }): Promise<HozonDB> {
  return openLocalDatabase({
    app: 'mokei',
    name: 'flow',
    path: params.path,
    stores: flowStoreDefinitions,
  })
}
