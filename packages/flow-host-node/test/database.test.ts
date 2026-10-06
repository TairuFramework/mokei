import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { type HozonDB, SchemaVersionError } from '@hozon/db'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { getFlowRunStore } from '../src/run-store.js'
import { openFlowDatabase } from '../src/stores.js'
import { runRecord } from './support/records.js'

const handles: Array<HozonDB> = []
const temporaryDirectories: Array<string> = []
async function createTemporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'flow-host-node-'))
  temporaryDirectories.push(directory)
  return directory
}
async function open(params: { path?: string } = {}) {
  const db = await openFlowDatabase(params)
  handles.push(db)
  return db
}
async function close(db: HozonDB) {
  await db.close()
  handles.splice(handles.indexOf(db), 1)
}
beforeEach(() => {
  vi.stubEnv('MOKEI_DATABASE_PATH', undefined)
})
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const db of handles.splice(0)) await db.close()
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

describe('flow database', () => {
  test('creates parent directories and registers every flow store', async () => {
    const directory = await createTemporaryDirectory()
    const path = join(directory, 'nested', 'flow.db')
    await close(await open({ path }))
    const db = new DatabaseSync(path, { readOnly: true })
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
      expect(tables.map((row) => row.name)).toEqual(
        expect.arrayContaining([
          'mokei_flow_runs',
          'mokei_flow_tasks',
          'hozon_spans',
          'hozon_logs',
        ]),
      )
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all()
      expect(indexes.map((row) => row.name)).toEqual(
        expect.arrayContaining([
          'mokei_flow_runs_state',
          'mokei_flow_runs_created',
          'mokei_flow_tasks_status',
        ]),
      )
      expect(db.prepare('PRAGMA journal_mode').get()).toMatchObject({ journal_mode: 'wal' })
    } finally {
      db.close()
    }
  })

  test('uses flow.db in the mokei data directory by default', async () => {
    const directory = await createTemporaryDirectory()
    vi.stubEnv('MOKEI_DATA_DIR', directory)
    await close(await open())
    await access(join(directory, 'flow.db'))
  })

  test('honours MOKEI_DATABASE_PATH and lets an explicit path win', async () => {
    const directory = await createTemporaryDirectory()
    const envPath = join(directory, 'env.db')
    const explicitPath = join(directory, 'explicit.db')
    vi.stubEnv('MOKEI_DATABASE_PATH', envPath)
    await close(await open())
    await access(envPath)
    await rm(envPath)
    await close(await open({ path: explicitPath }))
    await access(explicitPath)
    await expect(access(envPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('reopens a file database without re-running migrations', async () => {
    const directory = await createTemporaryDirectory()
    const path = join(directory, 'flow.db')
    const first = await open({ path })
    const record = runRecord()
    await (await getFlowRunStore(first)).create(record)
    await close(first)
    const second = await open({ path })
    expect(await (await getFlowRunStore(second)).get(record.runID)).toEqual(record)
  })

  test('rejects a database whose schema is newer than supported', async () => {
    const directory = await createTemporaryDirectory()
    const path = join(directory, 'future.db')
    await close(await open({ path }))
    const db = new DatabaseSync(path)
    try {
      db.prepare(
        'INSERT INTO "hozon_mokei-flow-runs_migration" (name, timestamp) VALUES (?, ?)',
      ).run('9-future', new Date().toISOString())
    } finally {
      db.close()
    }
    await expect(open({ path })).rejects.toBeInstanceOf(SchemaVersionError)
  })

  test('supports an in-memory database', async () => {
    const directory = await createTemporaryDirectory()
    vi.stubEnv('MOKEI_DATA_DIR', directory)
    const db = await open({ path: ':memory:' })
    await (await getFlowRunStore(db)).create(runRecord())
    expect(await (await getFlowRunStore(db)).get('run-one')).toEqual(runRecord())
    await close(db)
    await expect(access(join(directory, 'flow.db'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(':memory:')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
