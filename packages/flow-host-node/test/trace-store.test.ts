import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { HozonDB } from '@hozon/db'
import { getTraceIndexStore, openMokeiDatabase } from '@mokei/app-node'
import type { TraceSummary } from '@mokei/host-protocol'
import { afterEach, expect, test } from 'vitest'

import { createFlowTraceStore } from '../src/trace-store.js'
import { logRecord, spanRecord } from './support/records.js'

const handles: Array<HozonDB> = []
const directories: Array<string> = []
afterEach(async () => {
  for (const db of handles.splice(0)) await db.close()
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

function summary(traceID: string, active = false, endTime = 3): TraceSummary {
  return {
    traceID,
    rootSpanID: 'root',
    kind: 'flow',
    name: 'example',
    active,
    outcome: active ? null : 'ok',
    startTime: 1,
    endTime,
    attributes: {},
    spanCount: 1,
    errorCount: 0,
    droppedCount: 0,
    revision: 1,
  }
}

async function setup(path = ':memory:') {
  const db = await openMokeiDatabase({ path })
  handles.push(db)
  const index = await getTraceIndexStore(db)
  const store = createFlowTraceStore(db, { index: getTraceIndexStore })
  return { db, index, store }
}

test('lists active trace IDs from the index and defaults to none without an index', async () => {
  const { db, index, store } = await setup()
  await index.upsert([summary('active', true), summary('ended')])
  expect(await store.listActiveTraceIDs()).toEqual(['active'])
  expect(await createFlowTraceStore(db).listActiveTraceIDs()).toEqual([])
})

test.each(['deleteTraces', 'deleteBefore'] as const)(
  '%s removes matching summary rows',
  async (method) => {
    const { index, store } = await setup()
    await index.upsert([
      summary('trace-one'),
      summary('kept'),
      { ...summary('boundary', false, 10), startTime: 10 },
    ])
    await store.addSpans([spanRecord(), spanRecord({ traceID: 'kept' })])
    await store.addLogs([logRecord(), logRecord({ traceID: 'kept' })])
    const deleted =
      method === 'deleteTraces'
        ? await store.deleteTraces(['trace-one'])
        : await store.deleteBefore(10, ['kept'])
    expect(deleted).toEqual({ spans: 1, logs: 1 })
    expect(await index.get('trace-one')).toBeUndefined()
    expect(await index.get('kept')).toBeDefined()
    expect(await index.get('boundary')).toBeDefined()
    expect(await store.getTrace('trace-one')).toEqual({ spans: [], logs: [] })
    expect((await store.getTrace('kept')).spans).toHaveLength(1)
  },
)

test.each(['deleteTraces', 'deleteBefore'] as const)(
  '%s rolls back telemetry when summary deletion fails',
  async (method) => {
    const directory = await mkdtemp(join(tmpdir(), 'flow-index-rollback-'))
    directories.push(directory)
    const path = join(directory, 'mokei.db')
    const { index, store } = await setup(path)
    await index.upsert([summary('trace-one')])
    await store.addSpans([spanRecord()])
    await store.addLogs([logRecord()])
    const db = new DatabaseSync(path)
    try {
      db.exec(`CREATE TRIGGER fail_summary_delete BEFORE DELETE ON mokei_traces
      BEGIN SELECT RAISE(ABORT, 'summary delete failed'); END`)
    } finally {
      db.close()
    }
    const deletion =
      method === 'deleteTraces' ? store.deleteTraces(['trace-one']) : store.deleteBefore(10, [])
    await expect(deletion).rejects.toThrow('summary delete failed')
    expect(await index.get('trace-one')).toBeDefined()
    expect(await store.getTrace('trace-one')).toEqual({
      spans: [spanRecord()],
      logs: [logRecord()],
    })
  },
)
