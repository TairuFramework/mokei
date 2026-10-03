import {
  type FlowCheckResult,
  type FlowControl,
  FlowControlError,
  type FlowEvent,
  type FlowRunSnapshot,
  type FlowSummary,
  type InboxItem,
  type InboxOutcome,
  type PromptAction,
  TERMINAL_RUN_STATES,
} from '../src/index.js'
import { createEventQueue, type EventQueue } from '../src/subscription.js'

export type UnavailableState = 'starting' | 'failed'

export type MemoryControlOptions = {
  flows?: Array<FlowSummary>
  check?: (definition: unknown) => FlowCheckResult
  prompt?: (id: string, signal?: AbortSignal) => Promise<PromptAction>
}

export type MemoryControl = {
  control: FlowControl
  setRun(snapshot: FlowRunSnapshot): void
  addItem(item: InboxItem): void
  settle(id: string, outcome?: InboxOutcome): void
  disconnect(): void
  setUnavailable(state: UnavailableState | undefined): void
  /** Number of subscriptions not yet closed, failed or ended. */
  openSubscriptions(): number
}

/**
 * In-memory `FlowControl` test double. Subscriptions use the same event queue as the remote
 * adapter, reproducing the remote adapter's semantics: subscriptions
 * are live once `subscribe` resolves, `disconnect()` ends them with `DISCONNECTED` (delivered once
 * after buffered events, then done), an abort after `subscribe` resolved ends iteration, and
 * `setUnavailable` makes reads throw `FLOW_UNAVAILABLE` with `data.status.state`.
 */
export function createMemoryControl(options: MemoryControlOptions = {}): MemoryControl {
  const runs = new Map<string, FlowRunSnapshot>()
  const items = new Map<string, InboxItem>()
  const subscriptions = new Set<EventQueue>()
  let unavailable: UnavailableState | undefined
  let nextRun = 1

  function emit(event: FlowEvent) {
    for (const queue of subscriptions) queue.push(event)
  }

  function ensureAvailable() {
    if (unavailable == null) return
    const status =
      unavailable === 'failed'
        ? { state: 'failed', error: { type: 'Error', message: 'Flow service failed' } }
        : { state: unavailable }
    throw new FlowControlError({
      code: 'FLOW_UNAVAILABLE',
      message: `Flow service is ${unavailable}`,
      data: { status },
    })
  }

  function getRun(runID: string): FlowRunSnapshot {
    const run = runs.get(runID)
    if (run == null) {
      throw new FlowControlError({ code: 'RUN_NOT_FOUND', message: `Run not found: ${runID}` })
    }
    return run
  }

  function getItem(id: string): InboxItem {
    const item = items.get(id)
    if (item == null) {
      throw new FlowControlError({
        code: 'INBOX_ITEM_NOT_FOUND',
        message: `Inbox item not found: ${id}`,
      })
    }
    return item
  }

  function setRun(snapshot: FlowRunSnapshot) {
    runs.set(snapshot.runID, snapshot)
    emit({ type: 'run:state', data: snapshot })
  }

  function addItem(item: InboxItem) {
    items.set(item.id, item)
    emit({ type: 'inbox:added', data: item })
  }

  function settle(id: string, outcome: InboxOutcome = 'answered') {
    const item = getItem(id)
    items.delete(id)
    emit({ type: 'inbox:settled', data: { item, outcome } })
  }

  async function available<T>(work: () => T): Promise<T> {
    ensureAvailable()
    return work()
  }

  const control: FlowControl = {
    flows: {
      list: () => available(() => options.flows ?? []),
      check: (definition) =>
        available(
          () =>
            options.check?.(definition) ?? {
              value: {},
              warnings: [],
              formatted: 'Flow is valid',
            },
        ),
    },
    runs: {
      start: (params) =>
        available(() => {
          const now = Date.now()
          const snapshot: FlowRunSnapshot = {
            runID: `run-${nextRun++}`,
            label: params.label ?? 'flow',
            state: 'working',
            createdAt: now,
            updatedAt: now,
            plan: { tools: [] },
          }
          setRun(snapshot)
          return snapshot
        }),
      get: (runID) => available(() => getRun(runID)),
      list: (filter) =>
        available(() => {
          const states = (filter as { states?: Array<string> } | undefined)?.states
          return [...runs.values()].filter((run) => states == null || states.includes(run.state))
        }),
      cancel: (runID) =>
        available(() => {
          const run = getRun(runID)
          if (TERMINAL_RUN_STATES.includes(run.state)) return run
          for (const item of [...items.values()]) {
            if (item.runID === runID) settle(item.id, 'withdrawn')
          }
          const cancelled: FlowRunSnapshot = { ...run, state: 'cancelled', updatedAt: Date.now() }
          setRun(cancelled)
          return cancelled
        }),
    },
    inbox: {
      list: (filter) =>
        available(() =>
          [...items.values()].filter(
            (item) => filter?.runID == null || item.runID === filter.runID,
          ),
        ),
      get: (id) => available(() => getItem(id)),
      answer: (id) => available(() => settle(id, 'answered')),
      decline: (id) => available(() => settle(id, 'declined')),
      cancel: (id) => available(() => settle(id, 'cancelled')),
      ...(options.prompt == null ? {} : { prompt: options.prompt }),
    },
    subscribe: async (signal) => {
      signal?.throwIfAborted()
      const queue = createEventQueue({ signal, teardown: () => subscriptions.delete(queue) })
      subscriptions.add(queue)
      return queue.subscription
    },
  }

  return {
    control,
    setRun,
    addItem,
    settle,
    disconnect: () => {
      for (const queue of [...subscriptions]) {
        queue.fail(
          new FlowControlError({
            code: 'DISCONNECTED',
            message: 'Lost connection to the flow daemon',
          }),
        )
      }
    },
    setUnavailable: (state) => {
      unavailable = state
    },
    openSubscriptions: () => subscriptions.size,
  }
}
