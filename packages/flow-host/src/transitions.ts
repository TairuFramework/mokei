import { isTerminalRunState } from '@mokei/flow-client'

import { RunNotFoundError } from './errors.js'
import type { RunStore } from './run-store.js'
import { RunStoreConflictError } from './run-store.js'
import type { RunRecord } from './types.js'

export async function transition(
  store: RunStore,
  runID: string,
  compute: (record: RunRecord) => Partial<RunRecord> | undefined,
  options?: { now?: () => number },
): Promise<{ record: RunRecord; changed: boolean; stateChanged: boolean }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await store.get(runID)
    if (current == null) throw new RunNotFoundError({ runID })
    if (isTerminalRunState(current.state))
      return { record: current, changed: false, stateChanged: false }
    const patch = compute(current)
    if (patch == null) return { record: current, changed: false, stateChanged: false }
    try {
      const record = await store.update(
        runID,
        { ...patch, updatedAt: (options?.now ?? Date.now)() },
        { revision: current.revision },
      )
      return { record, changed: true, stateChanged: record.state !== current.state }
    } catch (error) {
      if (!(error instanceof RunStoreConflictError) || attempt === 4) throw error
    }
  }
  throw new Error('Unreachable transition retry state')
}

export function createRunQueue(): { run<T>(runID: string, work: () => Promise<T>): Promise<T> } {
  const queues = new Map<string, Promise<unknown>>()
  return {
    run<T>(runID: string, work: () => Promise<T>): Promise<T> {
      const previous = queues.get(runID) ?? Promise.resolve()
      const current = previous.catch(() => undefined).then(work)
      queues.set(runID, current)
      void current
        .finally(() => {
          if (queues.get(runID) === current) queues.delete(runID)
        })
        .catch(() => undefined)
      return current
    },
  }
}
