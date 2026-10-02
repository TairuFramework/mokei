import { createMemoryTaskStore } from '@mokei/context-server'
import { createMemoryRunStore, createMemoryTraceStore } from '@mokei/flow-host'
import { afterEach } from 'vitest'

import {
  createSQLiteRunStore,
  createSQLiteTaskStore,
  createSQLiteTraceStore,
  openFlowDatabase,
} from '../src/index.js'
import { runStoreContract } from './contracts/run-store.js'
import { taskStoreContract } from './contracts/task-store.js'
import { traceStoreContract } from './contracts/trace-store.js'

const handles: Array<ReturnType<typeof openFlowDatabase>> = []
function database() {
  const handle = openFlowDatabase({ path: ':memory:' })
  handles.push(handle)
  return handle.db
}
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
})
runStoreContract('memory runs', createMemoryRunStore)
runStoreContract('SQLite runs', () => createSQLiteRunStore(database()))
taskStoreContract('memory tasks', createMemoryTaskStore)
taskStoreContract('SQLite tasks', () => createSQLiteTaskStore(database()))
traceStoreContract('memory traces', createMemoryTraceStore)
traceStoreContract('SQLite traces', () => createSQLiteTraceStore(database()))
