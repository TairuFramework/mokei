import type { ContextClient } from '@mokei/context-client'
import type { DetailedTask } from '@mokei/context-protocol'
import { getMokeiLogger } from '@mokei/logger'

import { isTaskNotFound } from './run-helpers.js'

export function createWatchers(params: {
  withRun<T>(runID: string, work: () => T): T
  client: ContextClient
  pollMs: number
  apply(runID: string, task: DetailedTask): Promise<boolean>
  interrupted(runID: string): Promise<void>
}) {
  const logger = getMokeiLogger('flow-host')
  const watchers = new Map<string, AbortController>()
  const pending = new Set<Promise<void>>()
  let stopped = false
  function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', finish)
        resolve()
      }
      const timer = setTimeout(finish, ms)
      signal.addEventListener('abort', finish, { once: true })
      if (signal.aborted) finish()
    })
  }
  async function loop(runID: string, taskID: string, signal: AbortSignal) {
    let failures = 0
    while (!signal.aborted) {
      let delay = params.pollMs
      try {
        const task = await params.client.tasks.get(taskID)
        if (signal.aborted || (await params.apply(runID, task))) return
        failures = 0
      } catch (error) {
        if (signal.aborted) return
        logger.warn('Task poll failed for {runID}: {error}', { runID, error })
        if (isTaskNotFound(error)) {
          await params.interrupted(runID)
          return
        }
        failures += 1
        delay = Math.min(5000, Math.max(1, params.pollMs) * 2 ** Math.min(failures, 20))
      }
      await sleep(delay, signal)
    }
  }
  return {
    watch(runID: string, taskID: string) {
      if (stopped || watchers.has(runID)) return
      const controller = new AbortController()
      watchers.set(runID, controller)
      const work = params
        .withRun(runID, () => {
          return loop(runID, taskID, controller.signal).catch((error) => {
            logger.error('Task watcher failed for {runID}: {error}', { runID, error })
          })
        })
        .finally(() => {
          pending.delete(work)
          if (watchers.get(runID) === controller) watchers.delete(runID)
        })
      pending.add(work)
    },
    async stop() {
      stopped = true
      for (const controller of watchers.values()) controller.abort()
      await Promise.allSettled(pending)
      watchers.clear()
    },
  }
}
