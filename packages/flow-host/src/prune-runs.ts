import type { TaskStore } from '@mokei/context-server'
import { getReporter } from '@sozai/log'

import type { RunStore } from './run-store.js'
import type { TraceStore } from './trace-store.js'
import { TERMINAL_STATES } from './transitions.js'

export async function pruneRuns(params: {
  runStore: RunStore
  taskStore: TaskStore
  traceStore: TraceStore
  before: number
}): Promise<{ runs: number; skipped: number; spans: number; logs: number }> {
  const { runStore, taskStore, traceStore, before } = params
  const report = getReporter(['mokei', 'flow-host', 'capture'], '@mokei/flow-host')
  const counts = { runs: 0, skipped: 0, spans: 0, logs: 0 }
  const candidates = await runStore.list({ states: [...TERMINAL_STATES], updatedBefore: before })

  for (const candidate of candidates) {
    try {
      const run = await runStore.get(candidate.runID)
      if (run === undefined || !TERMINAL_STATES.has(run.state) || !(run.updatedAt < before)) {
        counts.skipped++
        continue
      }
      if (run.taskID !== undefined) {
        const task = await taskStore.get(run.taskID)
        if (
          task !== undefined &&
          task.status !== 'completed' &&
          task.status !== 'failed' &&
          task.status !== 'cancelled'
        ) {
          counts.skipped++
          report(`Skipped pruning run ${run.runID}: task ${run.taskID} remains ${task.status}`)
          continue
        }
      }
      // Keep the run until its cascade finishes so a later pass can resume it.
      if (run.traceID !== undefined) {
        const deleted = await traceStore.deleteTraces([run.traceID])
        counts.spans += deleted.spans
        counts.logs += deleted.logs
      }
      if (run.taskID !== undefined) await taskStore.delete(run.taskID)
      await runStore.delete(run.runID)
      counts.runs++
    } catch (error) {
      report(`Failed to prune run ${candidate.runID}`, error)
    }
  }

  const remaining = await runStore.list({})
  const keepTraceIDs = remaining.flatMap((run) => (run.traceID === undefined ? [] : [run.traceID]))
  const swept = await traceStore.deleteBefore(before, keepTraceIDs)
  counts.spans += swept.spans
  counts.logs += swept.logs
  return counts
}
