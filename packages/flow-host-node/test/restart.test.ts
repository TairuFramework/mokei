import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getLogStore } from '@hozon/store-log'
import { getTelemetryStore } from '@hozon/store-telemetry'
import { openMokeiDatabase, setupMokeiTelemetry } from '@mokei/app-node'
import type { FlowHost } from '@mokei/flow-host'
import { createFlowHost } from '@mokei/flow-host'
import { Session } from '@mokei/session'
import { getLogger } from '@sozai/log'
import { expect, test, vi } from 'vitest'

import {
  createFlowTraceStore,
  FLOW_REPORT_CATEGORY,
  flowStoreDefinitions,
  getFlowRunStore,
  getFlowTaskStore,
} from '../src/index.js'
import { inputFlow, predictor } from './support/input-flow.js'

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected stored value')
  return value
}

test('recovers waiting input from a reopened sqlite database', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'flow-restart-'))
  const path = join(directory, 'mokei.db')
  let database = await openMokeiDatabase({ path, stores: flowStoreDefinitions })
  // Telemetry outlives the simulated restart, as the daemon's database does on disk.
  const telemetryDatabase = await openMokeiDatabase({ path: ':memory:' })
  const traceStore = createFlowTraceStore(telemetryDatabase)
  const telemetry = setupMokeiTelemetry({
    logStore: await getLogStore(telemetryDatabase),
    telemetryStore: await getTelemetryStore(telemetryDatabase),
    logs: { file: false },
    reportCategories: [FLOW_REPORT_CATEGORY],
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

    await database.close()
    database = await openMokeiDatabase({ path, stores: flowStoreDefinitions })
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
      await telemetryDatabase.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }
})
