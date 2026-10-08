import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { type HozonDB, SchemaVersionError } from '@hozon/db'
import { openMokeiDatabase } from '@mokei/app-node'
import { afterEach, describe, expect, test } from 'vitest'

import { getFlowRunStore } from '../src/run-store.js'
import { flowStoreDefinitions } from '../src/stores.js'
import { runRecord } from './support/records.js'

const handles: Array<HozonDB> = []
const temporaryDirectories: Array<string> = []
async function createTemporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'flow-host-node-'))
  temporaryDirectories.push(directory)
  return directory
}
async function open(path: string) {
  const db = await openMokeiDatabase({ path, stores: flowStoreDefinitions })
  handles.push(db)
  return db
}
async function close(db: HozonDB) {
  await db.close()
  handles.splice(handles.indexOf(db), 1)
}
afterEach(async () => {
  for (const db of handles.splice(0)) await db.close()
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

describe('flow stores', () => {
  test('registers the flow tables and indexes', async () => {
    const directory = await createTemporaryDirectory()
    const path = join(directory, 'mokei.db')
    await close(await open(path))
    const db = new DatabaseSync(path, { readOnly: true })
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
      expect(tables.map((row) => row.name)).toEqual(
        expect.arrayContaining(['mokei_flow_runs', 'mokei_flow_tasks']),
      )
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all()
      expect(indexes.map((row) => row.name)).toEqual(
        expect.arrayContaining([
          'mokei_flow_runs_state',
          'mokei_flow_runs_created',
          'mokei_flow_tasks_status',
        ]),
      )
    } finally {
      db.close()
    }
  })

  test('reopens a file database without re-running migrations', async () => {
    const directory = await createTemporaryDirectory()
    const path = join(directory, 'mokei.db')
    const first = await open(path)
    const record = runRecord()
    await (await getFlowRunStore(first)).create(record)
    await close(first)
    const second = await open(path)
    expect(await (await getFlowRunStore(second)).get(record.runID)).toEqual(record)
  })

  test('rejects a database whose schema is newer than supported', async () => {
    const directory = await createTemporaryDirectory()
    const path = join(directory, 'future.db')
    await close(await open(path))
    const db = new DatabaseSync(path)
    try {
      db.prepare('INSERT INTO "mokei_flow-runs_migration" (name, timestamp) VALUES (?, ?)').run(
        '9-future',
        new Date().toISOString(),
      )
    } finally {
      db.close()
    }
    await expect(open(path)).rejects.toBeInstanceOf(SchemaVersionError)
  })
})
