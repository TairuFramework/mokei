import type { TaskStore } from '@mokei/context-server'
import { getMokeiLogger } from '@mokei/logger'

import { isAllowed } from './approval.js'
import type { ChangeRun } from './launch.js'
import { approvalItem, interruptedError } from './run-helpers.js'
import type { RunStore } from './run-store.js'
import type { InboxItem, RunRecord } from './types.js'

export async function recoverRuns(params: {
  withRun<T>(runID: string, work: () => T): T
  store: RunStore
  taskStore: TaskStore
  change: ChangeRun
  resume(record: RunRecord): void
  addApproval(item: InboxItem): void
  allow: Array<string>
  launchAllowed(runID: string): Promise<RunRecord>
  watch(runID: string, taskID: string): void
  cancelTask(runID: string, taskID: string): Promise<RunRecord>
}) {
  const runs = await params.store.list({
    states: ['awaiting_approval', 'working', 'input_required'],
  })
  const logger = getMokeiLogger('flow-host')
  for (let run of runs) {
    params.resume(run)
    await params.withRun(run.runID, async () => {
      try {
        if (run.state === 'awaiting_approval') {
          if (isAllowed(run.plan.tools, params.allow)) await params.launchAllowed(run.runID)
          else params.addApproval(approvalItem(run))
          return
        }
        if (run.state === 'working' && run.taskID === undefined) {
          const tasks = await params.taskStore.list({
            status: ['working', 'input_required', 'completed', 'failed', 'cancelled'],
          })
          const task = tasks.find((task) => task.requestMeta?.['dev.mokei/flow-run'] === run.runID)
          run = await params.change(run.runID, () =>
            task === undefined
              ? { state: 'failed', error: interruptedError() }
              : { taskID: task.taskID },
          )
        }
        if (run.taskID === undefined) return
        if (run.cancelRequested) await params.cancelTask(run.runID, run.taskID)
        else params.watch(run.runID, run.taskID)
      } catch (error) {
        logger.error('Run recovery failed for {runID}: {error}', { runID: run.runID, error })
        await params.change(run.runID, () => ({ state: 'failed', error: interruptedError(error) }))
      }
    })
  }
}
