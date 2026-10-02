import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

const temporaryDirectories: Array<string> = []
let mockedDataDirectory = ''

vi.mock('@tejika/env', () => ({
  getDataDir: vi.fn(() => mockedDataDirectory),
}))

const createTemporaryDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flow-host-node-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  )
})

describe('flow database', () => {
  test('creates parent directories and applies schema once', async () => {
    const directory = await createTemporaryDirectory()
    const path = join(directory, 'nested', 'flow.db')
    const { openFlowDatabase } = await import('../src/index.js')

    const first = openFlowDatabase({ path })
    expect(first.db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 1 })
    expect(first.db.prepare('PRAGMA journal_mode').get()).toMatchObject({ journal_mode: 'wal' })
    expect(first.db.prepare('PRAGMA busy_timeout').get()).toMatchObject({ timeout: 5000 })
    expect(first.db.prepare('PRAGMA foreign_keys').get()).toMatchObject({ foreign_keys: 1 })
    expect(
      first.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all(),
    ).toEqual([{ name: 'logs' }, { name: 'runs' }, { name: 'spans' }, { name: 'tasks' }])
    expect(
      first.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all(),
    ).toEqual([
      { name: 'logs_time' },
      { name: 'logs_trace' },
      { name: 'runs_created' },
      { name: 'runs_state' },
      { name: 'spans_end' },
      { name: 'spans_trace' },
      { name: 'tasks_status' },
    ])
    const runKeyIndex = first.db
      .prepare('PRAGMA index_list(runs)')
      .all()
      .find((index) => index.unique === 1)
    const taskKeyIndex = first.db
      .prepare('PRAGMA index_list(tasks)')
      .all()
      .find((index) => index.unique === 1)
    const spanKeyIndex = first.db
      .prepare('PRAGMA index_list(spans)')
      .all()
      .find((index) => index.unique === 1)
    expect(
      first.db
        .prepare(`PRAGMA index_info(${runKeyIndex?.name})`)
        .all()
        .map((column) => column.name),
    ).toEqual(['run_id'])
    expect(
      first.db
        .prepare(`PRAGMA index_info(${taskKeyIndex?.name})`)
        .all()
        .map((column) => column.name),
    ).toEqual(['task_id'])
    expect(
      first.db
        .prepare(`PRAGMA index_info(${spanKeyIndex?.name})`)
        .all()
        .map((column) => column.name),
    ).toEqual(['trace_id', 'span_id'])
    first.close()

    const second = openFlowDatabase({ path })
    expect(second.db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 1 })
    second.close()
  })

  test('uses the mokei data directory by default', async () => {
    mockedDataDirectory = await createTemporaryDirectory()
    const { openFlowDatabase } = await import('../src/index.js')
    const { db, close } = openFlowDatabase({})

    expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 1 })
    await access(join(mockedDataDirectory, 'mokei.db'))
    close()
  })

  test('rejects newer schema versions without changing the database', async () => {
    const directory = await createTemporaryDirectory()
    const path = join(directory, 'future.db')
    const { DatabaseSync } = await import('node:sqlite')
    const initial = new DatabaseSync(path)
    initial.exec('PRAGMA user_version = 2')
    initial.close()
    const { openFlowDatabase } = await import('../src/index.js')

    expect(() => openFlowDatabase({ path })).toThrow(/newer than supported version/i)
    const check = new DatabaseSync(path)
    expect(check.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 2 })
    check.close()
  })

  test('rolls back an unsuccessful migration', async () => {
    const directory = await createTemporaryDirectory()
    const path = join(directory, 'incompatible.db')
    const { DatabaseSync } = await import('node:sqlite')
    const initial = new DatabaseSync(path)
    initial.exec('CREATE TABLE tasks (incompatible TEXT)')
    initial.close()
    const { openFlowDatabase } = await import('../src/index.js')

    expect(() => openFlowDatabase({ path })).toThrow()
    const check = new DatabaseSync(path)
    expect(check.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 0 })
    expect(
      check.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runs'").get(),
    ).toBeUndefined()
    check.close()
  })

  test('supports an in-memory test database', async () => {
    const { openFlowDatabase } = await import('../src/index.js')
    const { db, close } = openFlowDatabase({ path: ':memory:' })

    expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 1 })
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runs'").get(),
    ).toEqual({
      name: 'runs',
    })
    close()
  })
})
