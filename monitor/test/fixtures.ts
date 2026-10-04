import type { FlowRunSnapshot, InboxItem } from '@mokei/flow-client'
import type { StoredSpan } from '@mokei/host-protocol'

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

export function span(spanID: string, parentSpanID?: string): StoredSpan {
  return {
    spanID,
    parentSpanID,
    traceID: 'trace-1',
    name: spanID,
    kind: 0,
    startTime: 50,
    endTime: 75,
    status: { code: 1 },
    attributes: { tool: 'search' },
    events: [{ name: 'found', time: 60, attributes: { count: 2 } }],
    links: [],
  }
}
