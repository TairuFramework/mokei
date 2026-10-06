import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LogStore } from '@hozon/store-log'
import { getLogStore } from '@hozon/store-log'
import type { TelemetryStore } from '@hozon/store-telemetry'
import { getTelemetryStore } from '@hozon/store-telemetry'
import type { FlowHost } from '@mokei/flow-host'
import { createFlowHost } from '@mokei/flow-host'
import { Session } from '@mokei/session'
import { getLogger } from '@sozai/log'
import { expect, test, vi } from 'vitest'

import {
  createFlowTraceStore,
  getFlowRunStore,
  getFlowTaskStore,
  openFlowDatabase,
  setupFlowTelemetry,
} from '../src/index.js'
import { inputFlow, predictor } from './support/input-flow.js'

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected stored value')
  return value
}

test('recovers waiting input from a reopened sqlite database', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'flow-restart-'))
  const path = join(directory, 'flow.db')
  let database = await openFlowDatabase({ path })
  let traceStore = createFlowTraceStore(database)
  let logStore = await getLogStore(database)
  let telemetryStore = await getTelemetryStore(database)
  const forwardingLogs: LogStore = {
    addLogs: (logs) => logStore.addLogs(logs),
    queryLogs: (params) => logStore.queryLogs(params),
    getTraceLogs: (traceID) => logStore.getTraceLogs(traceID),
    deleteByTrace: (traceIDs) => logStore.deleteByTrace(traceIDs),
    deleteBefore: (time, params) => logStore.deleteBefore(time, params),
  }
  const forwardingTelemetry: TelemetryStore = {
    addSpans: (spans) => telemetryStore.addSpans(spans),
    getSpans: (traceID) => telemetryStore.getSpans(traceID),
    deleteByTrace: (traceIDs) => telemetryStore.deleteByTrace(traceIDs),
    deleteBefore: (time, params) => telemetryStore.deleteBefore(time, params),
  }
  const telemetry = setupFlowTelemetry({
    logStore: forwardingLogs,
    telemetryStore: forwardingTelemetry,
    logs: { file: false },
  })
  let session = new Session({ elicit: true })
  let host: FlowHost | undefined
  try {
    const firstRuns = await getFlowRunStore(database)
    const firstTasks = await getFlowTaskStore(database)
    host = await createFlowHost({
      session,
      flows: [inputFlow],
      predictor,
      runStore: firstRuns,
      taskStore: firstTasks,
      pollMs: 10,
    })
    const { runID } = await host.start({ flow: 'input' })
    const firstHost = host
    await vi.waitFor(async () => expect((await firstHost.get(runID))?.state).toBe('input_required'))
    const item = required(host.inbox.list({ runID })[0])
    const stored = required(await firstRuns.get(runID))
    const taskID = required(stored.taskID)
    const traceID = required(stored.traceID)
    const traceparent = required(stored.traceparent)
    expect(traceparent.split('-')[1]).toBe(traceID)
    expect((await firstTasks.get(taskID))?.requestMeta?.traceparent).toBe(traceparent)
    await host.dispose()
    await session.dispose()
    expect(await firstTasks.get(taskID)).toMatchObject({ status: 'input_required', ttlMs: null })

    // Swap the delegate before closing the old database so delayed exports never see it closed.
    const previous = database
    database = await openFlowDatabase({ path })
    traceStore = createFlowTraceStore(database)
    logStore = await getLogStore(database)
    telemetryStore = await getTelemetryStore(database)
    await previous.close()
    const secondRuns = await getFlowRunStore(database)
    const secondTasks = await getFlowTaskStore(database)
    session = new Session({ elicit: true })
    const recovered = vi.fn(() => getLogger(['restart']).info('Recovered input'))
    const secondHost = await createFlowHost({
      session,
      flows: [inputFlow],
      predictor,
      runStore: secondRuns,
      taskStore: secondTasks,
      pollMs: 10,
      listeners: { 'inbox:added': recovered },
    })
    host = secondHost
    expect(secondHost.inbox.list({ runID })).toHaveLength(1)
    expect((await secondHost.get(runID))?.traceID).toBe(traceID)
    expect(secondHost.inbox.list({ runID })).toHaveLength(1)
    expect(secondHost.inbox.list({ runID })[0]?.id).toBe(item.id)
    expect((await secondRuns.get(runID))?.taskID).toBe(taskID)
    expect(recovered).toHaveBeenCalledOnce()
    await secondHost.inbox.answer(item.id, { value: 'Ada' })
    await vi.waitFor(async () => {
      expect(await secondHost.get(runID)).toMatchObject({
        state: 'completed',
        result: { outcome: 'done', output: { answer: { value: 'Ada' } } },
      })
    })
    expect((await secondRuns.get(runID))?.taskID).toBe(taskID)
    expect(
      (
        await secondTasks.list({
          status: ['working', 'input_required', 'completed', 'failed', 'cancelled'],
        })
      ).map((task) => task.taskID),
    ).toEqual([taskID])
    expect(secondHost.inbox.list({ runID })).toEqual([])
    await secondHost.dispose()
    await session.dispose()
    await telemetry.dispose()
    const captured = await traceStore.getTrace(traceID)
    const runSpan = required(captured.spans.find((span) => span.name === 'flow.run'))
    const resumeSpan = required(captured.spans.find((span) => span.name === 'flow.run.resume'))
    expect(runSpan.traceID).toBe(traceID)
    expect(resumeSpan.traceID).toBe(traceID)
    expect(resumeSpan.parentSpanID).toBe(traceparent.split('-')[2])
    expect(captured.logs.filter((log) => log.message === 'Recovered input')).toEqual([
      expect.objectContaining({ traceID }),
    ])
  } finally {
    try {
      await host?.dispose()
      await session.dispose()
      await telemetry.dispose()
    } finally {
      await database.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }
})
