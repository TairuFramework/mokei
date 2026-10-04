import type { ContextClient } from '@mokei/context-client'
import type { DetailedTask } from '@mokei/context-protocol'
import { getMokeiLogger } from '@mokei/logger'

import { isTaskNotFound } from './run-helpers.js'

export function createWatchers(params: {
  withRun<T>(runID: string, work: () => T): T
  client: ContextClient
  pollMs: number
  apply(runID: string, task: DetailedTask, reconciled: () => void): Promise<boolean>
  interrupted(runID: string): Promise<void>
}) {
  const logger = getMokeiLogger('flow-host')
  const watchers = new Map<
    string,
    {
      controller: AbortController
      initial: Promise<void>
      reject(error: unknown): void
      loop: Promise<void>
    }
  >()
  let stopped = false
  let stopping: Promise<void> | undefined
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
  async function loop(
    runID: string,
    taskID: string,
    signal: AbortSignal,
    ready: () => void,
    rejectInitial: (error: unknown) => void,
  ) {
    let failures = 0
    let readSnapshot = false
    while (!signal.aborted) {
      let delay = params.pollMs
      try {
        const task = await params.client.tasks.get(taskID)
        readSnapshot = true
        if (signal.aborted) return
        const terminal = await params.apply(runID, task, ready)
        ready()
        if (signal.aborted || terminal) return
        failures = 0
      } catch (error) {
        if (signal.aborted) return
        logger.warn('Task poll failed for {runID}: {error}', { runID, error })
        if (isTaskNotFound(error)) {
          await params.interrupted(runID)
          ready()
          return
        }
        // Recovery owns readiness failure cleanup. Ordinary launches retain polling retries.
        if (!readSnapshot) rejectInitial(error)
        failures += 1
        delay = Math.min(5000, Math.max(1, params.pollMs) * 2 ** Math.min(failures, 20))
      }
      await sleep(delay, signal)
    }
  }
  return {
    watch(runID: string, taskID: string): Promise<void> {
      const existing = watchers.get(runID)
      if (existing !== undefined && !stopped) return existing.initial
      const initial = Promise.withResolvers<void>()
      // Launch callers do not await readiness. Recovery still receives its rejection.
      void initial.promise.catch(() => undefined)
      if (stopped) {
        initial.reject(new Error('Task watcher stopped'))
        return initial.promise
      }
      const controller = new AbortController()
      // Defer execution until both readiness and the loop are registered for shutdown.
      const work = Promise.resolve()
        .then(() => {
          return params.withRun(runID, () => {
            return loop(runID, taskID, controller.signal, initial.resolve, initial.reject)
          })
        })
        .catch((error) => {
          initial.reject(error)
          logger.error('Task watcher failed for {runID}: {error}', { runID, error })
        })
        .finally(() => {
          if (watchers.get(runID)?.controller === controller) watchers.delete(runID)
        })
      watchers.set(runID, {
        controller,
        initial: initial.promise,
        reject: initial.reject,
        loop: work,
      })
      return initial.promise
    },
    stop(): Promise<void> {
      if (stopping !== undefined) return stopping
      stopped = true
      const pending = Array.from(watchers.values())
      for (const watcher of pending) {
        watcher.controller.abort()
        watcher.reject(new Error('Task watcher stopped'))
      }
      stopping = Promise.allSettled(pending.map((watcher) => watcher.loop)).then(() => {
        watchers.clear()
      })
      return stopping
    },
  }
}
