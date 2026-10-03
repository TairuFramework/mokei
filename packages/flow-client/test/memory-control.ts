import {
  type FlowCheckResult,
  type FlowControl,
  FlowControlError,
  type FlowEvent,
  type FlowRunSnapshot,
  type FlowSubscription,
  type FlowSummary,
  type InboxItem,
  type InboxOutcome,
  type PromptAction,
  TERMINAL_RUN_STATES,
} from '../src/index.js'

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

type Waiter = {
  resolve: (result: IteratorResult<FlowEvent>) => void
  reject: (error: unknown) => void
}

type MemorySubscription = FlowSubscription & {
  push(event: FlowEvent): void
  fail(error: FlowControlError): void
  isOpen(): boolean
}

function createSubscription(onEnd: () => void, signal?: AbortSignal): MemorySubscription {
  const buffer: Array<FlowEvent> = []
  const waiters: Array<Waiter> = []
  let state: 'open' | 'closed' | 'failed' = 'open'
  let failure: FlowControlError | undefined

  const onAbort = () => close()
  signal?.addEventListener('abort', onAbort, { once: true })

  function teardown() {
    signal?.removeEventListener('abort', onAbort)
    onEnd()
  }

  function close() {
    if (state === 'closed') return
    if (state === 'open') teardown()
    state = 'closed'
    buffer.length = 0
    failure = undefined
    for (const waiter of waiters.splice(0)) waiter.resolve({ done: true, value: undefined })
  }

  function fail(error: FlowControlError) {
    if (state !== 'open') return
    state = 'failed'
    failure = error
    teardown()
    const pending = waiters.splice(0)
    if (pending.length > 0) failure = undefined
    for (const waiter of pending) waiter.reject(error)
  }

  function push(event: FlowEvent) {
    if (state !== 'open') return
    const waiter = waiters.shift()
    if (waiter == null) buffer.push(event)
    else waiter.resolve({ done: false, value: event })
  }

  const iterator: AsyncIterator<FlowEvent> = {
    next() {
      const event = buffer.shift()
      if (event != null) return Promise.resolve({ done: false, value: event })
      if (failure != null) {
        const error = failure
        failure = undefined
        return Promise.reject(error)
      }
      if (state !== 'open') return Promise.resolve({ done: true, value: undefined })
      return new Promise((resolve, reject) => {
        waiters.push({ resolve, reject })
      })
    },
    return() {
      close()
      return Promise.resolve({ done: true, value: undefined })
    },
  }

  return {
    [Symbol.asyncIterator]: () => iterator,
    close,
    push,
    fail,
    isOpen: () => state === 'open',
  }
}

/**
 * In-memory `FlowControl` test double reproducing the remote adapter's semantics: subscriptions
 * are live once `subscribe` resolves, `disconnect()` ends them with `DISCONNECTED` (delivered once
 * after buffered events, then done), an abort after `subscribe` resolved ends iteration, and
 * `setUnavailable` makes reads throw `FLOW_UNAVAILABLE` with `data.status.state`.
 */
export function createMemoryControl(options: MemoryControlOptions = {}): MemoryControl {
  const runs = new Map<string, FlowRunSnapshot>()
  const items = new Map<string, InboxItem>()
  const subscriptions = new Set<MemorySubscription>()
  let unavailable: UnavailableState | undefined
  let nextRun = 1

  function emit(event: FlowEvent) {
    for (const subscription of subscriptions) subscription.push(event)
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
      const subscription = createSubscription(() => subscriptions.delete(subscription), signal)
      subscriptions.add(subscription)
      return subscription
    },
  }

  return {
    control,
    setRun,
    addItem,
    settle,
    disconnect: () => {
      for (const subscription of [...subscriptions]) {
        subscription.fail(
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
