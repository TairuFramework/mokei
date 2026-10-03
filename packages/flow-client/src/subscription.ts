import type { FlowControlError } from './errors.js'
import type { FlowEvent, FlowSubscription } from './types.js'

type Waiter = {
  resolve: (result: IteratorResult<FlowEvent>) => void
  reject: (error: unknown) => void
}

export type EventQueue = {
  subscription: FlowSubscription
  /** Delivers an event to the consumer, or buffers it; ignored once closed or failed. */
  push(event: FlowEvent): void
  /** Ends the subscription with `error`, delivered once after buffered events, then done. */
  fail(error: FlowControlError): void
  isOpen(): boolean
  /** The failure when it is all that is left to deliver (no buffered events), else undefined. */
  undeliveredFailure(): FlowControlError | undefined
}

export type EventQueueParams = {
  /** Called once when the subscription closes or fails, to release the underlying source. */
  teardown: () => void
  /** Aborting it closes the subscription: iteration ends as done. */
  signal?: AbortSignal
}

/**
 * Single-consumer subscription lifecycle shared by every `FlowControl` adapter: events are
 * buffered until read, a failure surfaces once after buffered events and further reads are done,
 * and `close` (or the signal aborting) ends iteration and discards what is left.
 */
export function createEventQueue(params: EventQueueParams): EventQueue {
  const { signal } = params
  const buffer: Array<FlowEvent> = []
  const waiters: Array<Waiter> = []
  let state: 'open' | 'closed' | 'failed' = 'open'
  let failure: FlowControlError | undefined

  const onAbort = () => close()
  signal?.addEventListener('abort', onAbort, { once: true })

  function teardown() {
    signal?.removeEventListener('abort', onAbort)
    params.teardown()
  }

  function close() {
    if (state === 'closed') return
    // A failed subscription is already torn down; closing it discards what it still holds.
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
    // Buffered events are still delivered before the failure surfaces; a pending waiter
    // implies an empty buffer, so it receives the failure and later reads are done.
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
        // Surface the failure once, then behave as a finished iterator.
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
    subscription: { [Symbol.asyncIterator]: () => iterator, close },
    push,
    fail,
    isOpen: () => state === 'open',
    undeliveredFailure: () => (buffer.length === 0 ? failure : undefined),
  }
}
