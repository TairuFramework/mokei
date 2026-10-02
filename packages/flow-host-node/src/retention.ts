import type { TaskStore } from '@mokei/context-server'
import type { RunStore, TraceStore } from '@mokei/flow-host'
import { pruneRuns } from '@mokei/flow-host'
import { getReporter } from '@sozai/log'

export function startRetention(params: {
  runStore: RunStore
  taskStore: TaskStore
  traceStore: TraceStore
  days: number
  intervalMs?: number
}): { stop(): Promise<void> } {
  const { runStore, taskStore, traceStore, days, intervalMs = 86400000 } = params
  const report = getReporter(['mokei', 'flow-host', 'capture'], '@mokei/flow-host')
  let running: Promise<void> | undefined
  let stopped = false
  let stopping: Promise<void> | undefined

  function run() {
    if (stopped || running !== undefined) return
    running = pruneRuns({ runStore, taskStore, traceStore, before: Date.now() - days * 86400000 })
      .then(() => {})
      .catch((error: unknown) => {
        report('Failed to prune retained runs', error)
      })
      .finally(() => {
        running = undefined
      })
  }

  run()
  const timer = setInterval(run, intervalMs)
  timer.unref()

  return {
    stop() {
      if (stopping === undefined) {
        stopped = true
        clearInterval(timer)
        stopping = running ?? Promise.resolve()
      }
      return stopping
    },
  }
}
