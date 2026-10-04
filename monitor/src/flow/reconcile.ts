import type { FlowEvent, FlowRunSnapshot, InboxItem, InboxOutcome } from '@mokei/flow-client'

export type InboxState = {
  items: Map<string, InboxItem>
  settled: Map<string, InboxOutcome>
}

export function applyRunEvent(runs: Map<string, FlowRunSnapshot>, event: FlowEvent) {
  if (event.type !== 'run:state') return runs
  const next = new Map(runs)
  next.set(event.data.runID, event.data)
  return next
}

export function applyInboxEvent(state: InboxState, event: FlowEvent): InboxState {
  if (event.type === 'run:state') return state
  const items = new Map(state.items)
  const settled = new Map(state.settled)
  if (event.type === 'inbox:settled') {
    items.delete(event.data.item.id)
    settled.set(event.data.item.id, event.data.outcome)
  } else if (!settled.has(event.data.id)) {
    items.set(event.data.id, event.data)
  }
  return { items, settled }
}

export function mergeInboxSnapshot(state: InboxState, snapshot: Array<InboxItem>): InboxState {
  const items = new Map(
    snapshot.filter((item) => !state.settled.has(item.id)).map((item) => [item.id, item]),
  )
  return { items, settled: new Map(state.settled) }
}

export function createGenerationGuard() {
  let generation = 0
  return {
    next: () => ++generation,
    isCurrent: (value: number) => value === generation,
  }
}
