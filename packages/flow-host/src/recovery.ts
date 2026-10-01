import type { TaskStore } from '@mokei/context-server'

import type { ChangeRun } from './launch.js'
import type { RunStore } from './run-store.js'
import type { InboxItem, RunRecord } from './types.js'

export async function recoverRuns(params: {
  store: RunStore
  taskStore: TaskStore
  change: ChangeRun
  resume(record: RunRecord): void
  addApproval(item: InboxItem): void
  watch(runID: string, taskID: string): void
  cancelTask(runID: string, taskID: string): Promise<RunRecord>
}) {
  const runs = await params.store.list({
    states: ['awaiting_approval', 'working', 'input_required'],
  })
  const unlinked = runs.some((run) => run.state === 'working' && run.taskID === undefined)
  const tasks = unlinked
    ? await params.taskStore.list({
        status: ['working', 'input_required', 'completed', 'failed', 'cancelled'],
      })
    : []
  for (let run of runs) {
    params.resume(run)
    if (run.state === 'awaiting_approval') {
      params.addApproval({
        id: `${run.runID}:approval`,
        runID: run.runID,
        kind: 'approval',
        plan: structuredClone(run.plan),
        createdAt: run.createdAt,
      })
      continue
    }
    if (run.state === 'working' && run.taskID === undefined) {
      const task = tasks.find((task) => task.requestMeta?.['dev.mokei/flow-run'] === run.runID)
      run = await params.change(run.runID, () =>
        task === undefined
          ? { state: 'failed', error: { type: 'Interrupted', message: 'Task not found' } }
          : { taskID: task.taskID },
      )
    }
    if (run.taskID === undefined) continue
    if (run.cancelRequested) await params.cancelTask(run.runID, run.taskID)
    else params.watch(run.runID, run.taskID)
  }
}
