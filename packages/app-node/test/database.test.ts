import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { HozonDB, StoreDefinition } from '@hozon/db'
import { getLogStore } from '@hozon/store-log'
import { getTelemetryStore } from '@hozon/store-telemetry'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { openMokeiDatabase } from '../src/index.js'

const handles: Array<HozonDB> = []
let directory: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mokei-db-'))
  vi.stubEnv('MOKEI_DATABASE_PATH', undefined)
  vi.stubEnv('MOKEI_DATA_DIR', directory)
})
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const db of handles.splice(0)) await db.close()
  await rm(directory, { recursive: true, force: true })
})
async function open(params: Parameters<typeof openMokeiDatabase>[0] = {}) {
  const db = await openMokeiDatabase(params)
  handles.push(db)
  return db
}
async function close(db: HozonDB) {
  await db.close()
  handles.splice(handles.indexOf(db), 1)
}

test('uses mokei.db in the mokei data directory by default', async () => {
  await close(await open())
  await access(join(directory, 'mokei.db'))
})

test('honours MOKEI_DATABASE_PATH and lets an explicit path win', async () => {
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

test('registers log, telemetry and trace index stores and extra stores', async () => {
  const extra: StoreDefinition<unknown, unknown> = {
    name: 'test-items',
    migrations: () => ({
      '0-init': {
        async up(db) {
          await db.schema.createTable('test_items').addColumn('id', 'integer').execute()
        },
      },
    }),
    createAPI: () => ({}),
  }
  const path = join(directory, 'nested', 'mokei.db')
  await close(await open({ path, stores: [extra] }))
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining(['mokei_logs', 'mokei_spans', 'mokei_traces', 'mokei_test_items']),
    )
  } finally {
    db.close()
  }
})

test('supports an in-memory database', async () => {
  const db = await open({ path: ':memory:' })
  expect(await (await getLogStore(db)).getTraceLogs('empty')).toEqual([])
  expect(await (await getTelemetryStore(db)).getSpans('empty')).toEqual([])
  await close(db)
  await expect(access(join(directory, 'mokei.db'))).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(access(':memory:')).rejects.toMatchObject({ code: 'ENOENT' })
})
