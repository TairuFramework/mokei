import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'

import {
  createSQLiteRunStore,
  createSQLiteTaskStore,
  createSQLiteTraceStore,
  openFlowDatabase,
} from '../src/index.js'
import { logRecord, runRecord, spanRecord, taskRecord } from './support/records.js'

const handles: Array<ReturnType<typeof openFlowDatabase>> = []
const directories: Array<string> = []
function open(path: string) {
  const handle = openFlowDatabase({ path })
  handles.push(handle)
  return handle
}
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
test.each(['traces', 'before'])(
  'rolls back a failed telemetry deletion transaction (%s)',
  async (method) => {
    const { db } = open(':memory:')
    const store = createSQLiteTraceStore(db)
    await store.addSpans([spanRecord()])
    await store.addLogs([logRecord()])
    db.exec(
      "CREATE TRIGGER reject_log_delete BEFORE DELETE ON logs BEGIN SELECT RAISE(ABORT, 'log deletion failed'); END",
    )
    await expect(
      method === 'traces' ? store.deleteTraces(['trace-one']) : store.deleteBefore(100, []),
    ).rejects.toThrow('log deletion failed')
    expect(await store.getTrace('trace-one')).toEqual({
      spans: [spanRecord()],
      logs: [logRecord()],
    })
    db.exec('DROP TRIGGER reject_log_delete')
    expect(await store.deleteBefore(100, [])).toEqual({ spans: 1, logs: 1 })
  },
)
test('persists every store across reopening', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'flow-stores-'))
  directories.push(directory)
  const path = join(directory, 'flow.db')
  const first = open(path)
  const runs = createSQLiteRunStore(first.db)
  const tasks = createSQLiteTaskStore(first.db)
  const traces = createSQLiteTraceStore(first.db)
  await runs.create(runRecord())
  await tasks.create(taskRecord())
  await traces.addSpans([spanRecord()])
  await traces.addLogs([logRecord()])
  const run = await runs.update(
    'run-one',
    {
      state: 'input_required',
      createdAt: 30,
      updatedAt: 40,
      traceID: 'trace-two',
      taskID: 'task-one',
    },
    { revision: 0 },
  )
  const task = await tasks.update('task-one', { status: 'input_required' }, { revision: 0 })
  const span = spanRecord({ startTime: 50.25, endTime: 60.75, name: 'updated' })
  await traces.addSpans([span])
  first.close()
  handles.splice(handles.indexOf(first), 1)
  const second = open(path)
  const reopenedRuns = createSQLiteRunStore(second.db)
  const reopenedTasks = createSQLiteTaskStore(second.db)
  const reopenedTraces = createSQLiteTraceStore(second.db)
  expect(await reopenedRuns.get('run-one')).toEqual(run)
  expect(await reopenedTasks.get('task-one')).toEqual(task)
  expect(await reopenedTraces.getTrace('trace-one')).toEqual({ spans: [span], logs: [logRecord()] })
  expect(await reopenedRuns.list({ states: ['working'] })).toEqual([])
  expect(await reopenedRuns.list({ states: ['input_required'], updatedBefore: 41 })).toEqual([run])
  expect(await reopenedRuns.list({ updatedBefore: 40 })).toEqual([])
  expect(await reopenedTasks.list({ status: ['working'] })).toEqual([])
  expect(await reopenedTasks.list({ status: ['input_required'] })).toEqual([task])
  expect(
    second.db.prepare('SELECT created_at, updated_at, trace_id, task_id, revision FROM runs').get(),
  ).toEqual({
    created_at: 30,
    updated_at: 40,
    trace_id: 'trace-two',
    task_id: 'task-one',
    revision: 1,
  })
  expect(await reopenedTraces.deleteBefore(60, [])).toEqual({ spans: 0, logs: 1 })
  expect(await reopenedTraces.deleteBefore(61, [])).toEqual({ spans: 1, logs: 0 })
})
