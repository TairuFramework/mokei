import type { FlowRunSnapshot, InboxItem } from '@mokei/flow-client'

export function run(runID = 'run-1', state: FlowRunSnapshot['state'] = 'working'): FlowRunSnapshot {
  return { runID, label: runID, state, createdAt: 1, updatedAt: 2, plan: { tools: [] } }
}

export function item(id = 'item-1', runID = 'run-1'): InboxItem {
  return { id, runID, kind: 'approval', createdAt: 1, plan: { tools: [] } }
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
