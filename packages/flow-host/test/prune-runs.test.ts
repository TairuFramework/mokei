import { configure, reset } from '@logtape/logtape'
import type { TaskRecord } from '@mokei/context-server'
import { createMemoryTaskStore } from '@mokei/context-server'
import { afterEach, expect, test, vi } from 'vitest'

import type { RunRecord, RunState, StoredLog, StoredSpan } from '../src/index.js'
import { createMemoryRunStore, createMemoryTraceStore, pruneRuns } from '../src/index.js'

function run(runID: string, state: RunState = 'completed', updatedAt = 99): RunRecord {
  return {
    runID,
    label: runID,
    state,
    createdAt: 1,
    updatedAt,
    revision: 0,
    plan: { tools: [] },
    request: { toolName: 'run_flow', arguments: {} },
    taskID: `task-${runID}`,
    traceID: `trace-${runID}`,
  }
}
function task(runID: string, status: TaskRecord['status'] = 'completed'): TaskRecord {
  return {
    taskID: `task-${runID}`,
    status,
    revision: 0,
    createdAt: '1970-01-01T00:00:00.001Z',
    lastUpdatedAt: '1970-01-01T00:00:00.099Z',
    ttlMs: null,
    toolName: 'run_flow',
    clientCapabilities: {},
    inputs: [],
  }
}
function span(traceID: string, endTime = 99): StoredSpan {
  return {
    traceID,
    spanID: 'span',
    name: 'flow.run',
    kind: 1,
    startTime: 1,
    endTime,
    status: { code: 0 },
    attributes: {},
    events: [],
    links: [],
  }
}
function log(traceID: string, timestamp = 99): StoredLog {
  return {
    traceID,
    spanID: 'span',
    timestamp,
    level: 'info',
    category: ['mokei', 'flow-host'],
    message: 'Run finished',
    properties: {},
  }
}
function stores() {
  return {
    runStore: createMemoryRunStore(),
    taskStore: createMemoryTaskStore(),
    traceStore: createMemoryTraceStore(),
    before: 100,
  }
}
async function captureReports() {
  const reports = vi.fn()
  await configure({
    sinks: { reports },
    loggers: [
      { category: ['mokei', 'flow-host', 'capture'], lowestLevel: 'error', sinks: ['reports'] },
      { category: ['logtape', 'meta'], lowestLevel: 'error', sinks: [] },
    ],
  })
  return reports
}
afterEach(async () => {
  vi.restoreAllMocks()
  await reset()
})

test('cascades old terminal runs in trace task run order', async () => {
  const params = stores()
  await params.runStore.create(run('old'))
  await params.taskStore.create(task('old'))
  await params.traceStore.addSpans([
    span('trace-old'),
    { ...span('trace-old', 101), spanID: 'late' },
  ])
  await params.traceStore.addLogs([log('trace-old', 101)])
  const order: Array<string> = []
  const deleteTraces = params.traceStore.deleteTraces.bind(params.traceStore)
  const deleteTask = params.taskStore.delete.bind(params.taskStore)
  const deleteRun = params.runStore.delete.bind(params.runStore)
  vi.spyOn(params.traceStore, 'deleteTraces').mockImplementation(async (traceIDs) => {
    order.push('trace')
    return deleteTraces(traceIDs)
  })
  vi.spyOn(params.taskStore, 'delete').mockImplementation(async (taskID) => {
    order.push('task')
    return deleteTask(taskID)
  })
  vi.spyOn(params.runStore, 'delete').mockImplementation(async (runID) => {
    order.push('run')
    return deleteRun(runID)
  })
  expect(await pruneRuns(params)).toEqual({ runs: 1, skipped: 0, spans: 2, logs: 1 })
  expect(order).toEqual(['trace', 'task', 'run'])
  expect(await params.runStore.get('old')).toBeUndefined()
  expect(await params.taskStore.get('task-old')).toBeUndefined()
  expect(await params.traceStore.getTrace('trace-old')).toEqual({ spans: [], logs: [] })
})

test('keeps boundary and non-terminal runs', async () => {
  const params = stores()
  const states: Array<RunState> = [
    'awaiting_approval',
    'denied',
    'working',
    'input_required',
    'completed',
    'failed',
    'cancelled',
  ]
  for (const state of states) {
    await params.runStore.create(run(state, state))
    await params.runStore.create(run(`boundary-${state}`, state, 100))
    await params.runStore.create(run(`new-${state}`, state, 101))
  }
  expect(await pruneRuns(params)).toEqual({ runs: 4, skipped: 0, spans: 0, logs: 0 })
  expect((await params.runStore.list({ updatedBefore: 100 })).map(({ runID }) => runID)).toEqual([
    'awaiting_approval',
    'working',
    'input_required',
  ])
  for (const state of states) {
    expect(await params.runStore.get(`boundary-${state}`)).toBeDefined()
    expect(await params.runStore.get(`new-${state}`)).toBeDefined()
  }
})

test('skips terminal runs whose tasks remain active', async () => {
  const reports = await captureReports()
  const params = stores()
  for (const status of ['working', 'input_required'] as const) {
    await params.runStore.create(run(status))
    await params.taskStore.create(task(status, status))
    await params.traceStore.addSpans([span(`trace-${status}`)])
  }
  expect(await pruneRuns(params)).toEqual({ runs: 0, skipped: 2, spans: 0, logs: 0 })
  expect(reports).toHaveBeenCalledTimes(2)
  for (const status of ['working', 'input_required'] as const) {
    expect(await params.runStore.get(status)).toBeDefined()
    expect(await params.taskStore.get(`task-${status}`)).toBeDefined()
    expect((await params.traceStore.getTrace(`trace-${status}`)).spans).toHaveLength(1)
  }
})

test('rechecks candidates before deletion', async () => {
  const params = stores()
  for (const id of ['gone', 'active', 'refreshed']) {
    await params.runStore.create(run(id))
    await params.taskStore.create(task(id))
    // Recent telemetry avoids the separate orphan sweep for the disappeared run.
    await params.traceStore.addSpans([span(`trace-${id}`, 101)])
  }
  const list = params.runStore.list.bind(params.runStore)
  vi.spyOn(params.runStore, 'list').mockImplementationOnce(async (filter) => {
    const selected = await list(filter)
    await params.runStore.delete('gone')
    await params.runStore.update('active', { state: 'working' }, { revision: 0 })
    await params.runStore.update('refreshed', { updatedAt: 100 }, { revision: 0 })
    return selected
  })
  const getTask = vi.spyOn(params.taskStore, 'get')
  const deleteTrace = vi.spyOn(params.traceStore, 'deleteTraces')
  expect(await pruneRuns(params)).toEqual({ runs: 0, skipped: 3, spans: 0, logs: 0 })
  expect(getTask).not.toHaveBeenCalled()
  expect(deleteTrace).not.toHaveBeenCalled()
  expect(await params.runStore.get('active')).toMatchObject({ state: 'working' })
  expect(await params.runStore.get('refreshed')).toMatchObject({ updatedAt: 100 })
  for (const id of ['gone', 'active', 'refreshed']) {
    expect(await params.taskStore.get(`task-${id}`)).toBeDefined()
    expect((await params.traceStore.getTrace(`trace-${id}`)).spans).toHaveLength(1)
  }
})

test('sweeps orphan and late exports but keeps all surviving run traces', async () => {
  const params = stores()
  await captureReports()
  for (const record of [
    run('pruned'),
    run('skipped'),
    run('active', 'working'),
    run('boundary', 'failed', 100),
  ]) {
    await params.runStore.create(record)
  }
  await params.taskStore.create(task('skipped', 'working'))
  const traceIDs = [
    'trace-pruned',
    'trace-skipped',
    'trace-active',
    'trace-boundary',
    'orphan',
    'recent',
  ]
  await params.traceStore.addSpans(traceIDs.map((id) => span(id, id === 'recent' ? 100 : 99)))
  await params.traceStore.addLogs(traceIDs.map((id) => log(id, id === 'recent' ? 100 : 99)))
  const sweep = params.traceStore.deleteBefore.bind(params.traceStore)
  vi.spyOn(params.traceStore, 'deleteBefore').mockImplementationOnce(async (before, kept) => {
    // An export arriving after the cascade is swept in the same pass.
    await params.traceStore.addSpans([span('trace-pruned')])
    await params.traceStore.addLogs([log('trace-pruned')])
    return sweep(before, kept)
  })
  expect(await pruneRuns(params)).toEqual({ runs: 1, skipped: 1, spans: 3, logs: 3 })
  for (const id of ['trace-pruned', 'orphan']) {
    expect(await params.traceStore.getTrace(id)).toEqual({ spans: [], logs: [] })
  }
  for (const id of ['trace-skipped', 'trace-active', 'trace-boundary', 'recent']) {
    const trace = await params.traceStore.getTrace(id)
    expect(trace.spans).toHaveLength(1)
    expect(trace.logs).toHaveLength(1)
  }
})

test('continues after a cascade failure and finishes on the next pass', async () => {
  const reports = await captureReports()
  const params = stores()
  const failedRunID = 'failed-cascade'
  for (const id of [failedRunID, 'success']) {
    await params.runStore.create(run(id))
    await params.taskStore.create(task(id))
    await params.traceStore.addSpans([span(`trace-${id}`)])
    await params.traceStore.addLogs([log(`trace-${id}`)])
  }
  vi.spyOn(params.taskStore, 'delete').mockRejectedValueOnce(new Error('Task deletion failed'))
  const first = await pruneRuns(params)
  expect(first.runs).toBe(1)
  expect(first.spans).toBe(2)
  expect(first.logs).toBe(2)
  expect(await params.runStore.get(failedRunID)).toBeDefined()
  expect(await params.taskStore.get(`task-${failedRunID}`)).toBeDefined()
  expect(await params.runStore.get('success')).toBeUndefined()
  expect(reports).toHaveBeenCalledTimes(1)
  const second = await pruneRuns(params)
  expect(second.runs).toBe(1)
  expect(second.spans).toBe(0)
  expect(second.logs).toBe(0)
  expect(await params.runStore.get(failedRunID)).toBeUndefined()
  expect(await params.taskStore.get(`task-${failedRunID}`)).toBeUndefined()
})

test('prunes all terminal task statuses and tolerates missing task and trace records', async () => {
  const params = stores()
  for (const status of ['completed', 'failed', 'cancelled'] as const) {
    await params.runStore.create(run(status))
    await params.taskStore.create(task(status, status))
  }
  await params.runStore.create(run('missing'))
  await params.runStore.create({ ...run('unlinked'), taskID: undefined, traceID: undefined })
  expect(await pruneRuns(params)).toEqual({ runs: 5, skipped: 0, spans: 0, logs: 0 })
  expect(await params.runStore.list({})).toEqual([])
  expect(await params.taskStore.list({ status: ['completed', 'failed', 'cancelled'] })).toEqual([])
})

test.each(['selection', 'remaining', 'sweep'] as const)('rejects %s failures', async (stage) => {
  const params = stores()
  const failure = new Error(`${stage} failed`)
  if (stage === 'sweep') {
    vi.spyOn(params.traceStore, 'deleteBefore').mockRejectedValueOnce(failure)
  } else {
    const list = vi.spyOn(params.runStore, 'list')
    if (stage === 'remaining') list.mockResolvedValueOnce([])
    list.mockRejectedValueOnce(failure)
  }
  await expect(pruneRuns(params)).rejects.toBe(failure)
})

test('pruneRuns keeps traces that are active in the index', async () => {
  const params = stores()
  await params.runStore.create(run('indexed'))
  await params.taskStore.create(task('indexed'))
  await params.traceStore.addSpans([span('trace-indexed'), span('active-orphan'), span('orphan')])
  await params.traceStore.addLogs([log('trace-indexed'), log('active-orphan'), log('orphan')])
  params.traceStore.listActiveTraceIDs = async () => ['trace-indexed', 'active-orphan']
  expect(await pruneRuns(params)).toEqual({ runs: 0, skipped: 1, spans: 1, logs: 1 })
  expect(await params.runStore.get('indexed')).toBeDefined()
  expect(await params.taskStore.get('task-indexed')).toBeDefined()
  for (const traceID of ['trace-indexed', 'active-orphan']) {
    expect((await params.traceStore.getTrace(traceID)).spans).toHaveLength(1)
    expect((await params.traceStore.getTrace(traceID)).logs).toHaveLength(1)
  }
  expect(await params.traceStore.getTrace('orphan')).toEqual({ spans: [], logs: [] })
  expect(await createMemoryTraceStore().listActiveTraceIDs()).toEqual([])
})
