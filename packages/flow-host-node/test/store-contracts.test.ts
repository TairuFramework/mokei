import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openMokeiDatabase } from '@mokei/app-node'
import { createMemoryTaskStore } from '@mokei/context-server'
import { createMemoryRunStore, createMemoryTraceStore } from '@mokei/flow-host'
import { openLocalDatabase } from '@tejika/db'
import { afterEach, describe, expect, test } from 'vitest'

import { getFlowRunStore, runStoreDefinition } from '../src/run-store.js'
import { flowStoreDefinitions } from '../src/stores.js'
import { getFlowTaskStore, taskStoreDefinition } from '../src/task-store.js'
import { createFlowTraceStore } from '../src/trace-store.js'
import { runStoreContract } from './contracts/run-store.js'
import { taskStoreContract } from './contracts/task-store.js'
import { traceStoreContract } from './contracts/trace-store.js'
import { logRecord, spanRecord } from './support/records.js'

const hozonHandles: Array<Awaited<ReturnType<typeof openLocalDatabase>>> = []
const temporaryDirectories: Array<string> = []
async function open(path = ':memory:') {
  const db = await openMokeiDatabase({ path, stores: flowStoreDefinitions })
  hozonHandles.push(db)
  return db
}
afterEach(async () => {
  for (const handle of hozonHandles.splice(0)) await handle.close()
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})
runStoreContract('memory runs', createMemoryRunStore)
taskStoreContract('memory tasks', createMemoryTaskStore)
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

traceStoreContract('hozon traces', async () => createFlowTraceStore(await open()))

describe('hozon trace transactions', () => {
  test('rolls back span deletion when log deletion fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'flow-trace-rollback-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'mokei.db')
    const store = createFlowTraceStore(await open(path))
    await store.addSpans([spanRecord()])
    await store.addLogs([logRecord()])
    const db = new DatabaseSync(path)
    try {
      db.exec(`CREATE TRIGGER fail_log_delete BEFORE DELETE ON mokei_logs
        BEGIN SELECT RAISE(ABORT, 'log delete failed'); END`)
    } finally {
      db.close()
    }
    await expect(store.deleteTraces(['trace-one'])).rejects.toThrow('log delete failed')
    expect(await store.getTrace('trace-one')).toEqual({
      spans: [spanRecord()],
      logs: [logRecord()],
    })
    await expect(store.deleteBefore(Number.MAX_SAFE_INTEGER, [])).rejects.toThrow(
      'log delete failed',
    )
    expect(await store.getTrace('trace-one')).toEqual({
      spans: [spanRecord()],
      logs: [logRecord()],
    })
  })
})
