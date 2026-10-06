import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { HozonDB } from '@hozon/db'
import { afterEach, expect, test } from 'vitest'

import {
  createFlowTraceStore,
  getFlowRunStore,
  getFlowTaskStore,
  openFlowDatabase,
} from '../src/index.js'
import { logRecord, runRecord, spanRecord, taskRecord } from './support/records.js'

const handles: Array<HozonDB> = []
const directories: Array<string> = []
async function open(path: string) {
  const handle = await openFlowDatabase({ path })
  handles.push(handle)
  return handle
}
afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
test('persists every store across reopening', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'flow-stores-'))
  directories.push(directory)
  const path = join(directory, 'flow.db')
  const first = await open(path)
  const runs = await getFlowRunStore(first)
  const tasks = await getFlowTaskStore(first)
  const traces = createFlowTraceStore(first)
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
  await first.close()
  handles.splice(handles.indexOf(first), 1)
  const raw = new DatabaseSync(path, { readOnly: true })
  try {
    expect(
      raw
        .prepare('SELECT created_at, updated_at, trace_id, task_id, revision FROM mokei_flow_runs')
        .get(),
    ).toEqual({
      created_at: 30,
      updated_at: 40,
      trace_id: 'trace-two',
      task_id: 'task-one',
      revision: 1,
    })
  } finally {
    raw.close()
  }
  const second = await open(path)
  const reopenedRuns = await getFlowRunStore(second)
  const reopenedTasks = await getFlowTaskStore(second)
  const reopenedTraces = createFlowTraceStore(second)
  expect(await reopenedRuns.get('run-one')).toEqual(run)
  expect(await reopenedTasks.get('task-one')).toEqual(task)
  expect(await reopenedTraces.getTrace('trace-one')).toEqual({ spans: [span], logs: [logRecord()] })
  expect(await reopenedRuns.list({ states: ['working'] })).toEqual([])
  expect(await reopenedRuns.list({ states: ['input_required'], updatedBefore: 41 })).toEqual([run])
  expect(await reopenedRuns.list({ updatedBefore: 40 })).toEqual([])
  expect(await reopenedTasks.list({ status: ['working'] })).toEqual([])
  expect(await reopenedTasks.list({ status: ['input_required'] })).toEqual([task])
  expect(await reopenedTraces.deleteBefore(60, [])).toEqual({ spans: 0, logs: 1 })
  expect(await reopenedTraces.deleteBefore(61, [])).toEqual({ spans: 1, logs: 0 })
})
