import { createMemoryTaskStore } from '@mokei/context-server'
import { createMemoryRunStore, createMemoryTraceStore } from '@mokei/flow-host'
import { openLocalDatabase } from '@tejika/db'
import { afterEach } from 'vitest'

import {
  createSQLiteRunStore,
  createSQLiteTaskStore,
  createSQLiteTraceStore,
  openFlowDatabase,
} from '../src/index.js'
import { getFlowRunStore, runStoreDefinition } from '../src/run-store.js'
import { getFlowTaskStore, taskStoreDefinition } from '../src/task-store.js'
import { runStoreContract } from './contracts/run-store.js'
import { taskStoreContract } from './contracts/task-store.js'
import { traceStoreContract } from './contracts/trace-store.js'

const handles: Array<ReturnType<typeof openFlowDatabase>> = []
const hozonHandles: Array<Awaited<ReturnType<typeof openLocalDatabase>>> = []
function database() {
  const handle = openFlowDatabase({ path: ':memory:' })
  handles.push(handle)
  return handle.db
}
afterEach(async () => {
  for (const handle of handles.splice(0)) handle.close()
  for (const handle of hozonHandles.splice(0)) await handle.close()
})
runStoreContract('memory runs', createMemoryRunStore)
runStoreContract('SQLite runs', () => createSQLiteRunStore(database()))
taskStoreContract('memory tasks', createMemoryTaskStore)
taskStoreContract('SQLite tasks', () => createSQLiteTaskStore(database()))
runStoreContract('hozon runs', async () => {
  const db = await openLocalDatabase({
    app: 'mokei',
    path: ':memory:',
    stores: [runStoreDefinition],
  })
  hozonHandles.push(db)
  return getFlowRunStore(db)
})
taskStoreContract('hozon tasks', async () => {
  const db = await openLocalDatabase({
    app: 'mokei',
    path: ':memory:',
    stores: [taskStoreDefinition],
  })
  hozonHandles.push(db)
  return getFlowTaskStore(db)
})
traceStoreContract('memory traces', createMemoryTraceStore)
traceStoreContract('SQLite traces', () => createSQLiteTraceStore(database()))
