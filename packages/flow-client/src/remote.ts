import type { Client } from '@enkaku/client'
import type { HostEvent, Protocol } from '@mokei/host-protocol'
import type { FromSchema } from '@sozai/schema'

import { FlowControlError, type FlowControlErrorCode, isFlowControlError } from './errors.js'
import type { FlowControl, FlowEvent, FlowSubscription } from './types.js'

type CheckParam = FromSchema<Protocol['flows.check']['param']>
type AnswerParam = FromSchema<Protocol['inbox.answer']['param']>

const HANDLER_CODES: ReadonlySet<FlowControlErrorCode> = new Set<FlowControlErrorCode>([
  'FLOW_UNAVAILABLE',
  'FLOW_INVALID',
  'FLOW_NOT_FOUND',
  'RUN_NOT_FOUND',
  'INBOX_ITEM_NOT_FOUND',
  'INBOX_ANSWER_INVALID',
  'PROMPT_UNSUPPORTED',
  'PROMPT_IN_PROGRESS',
  'INTERNAL_ERROR',
])

const FLOW_EVENT_TYPES: ReadonlySet<string> = new Set(['run:state', 'inbox:added', 'inbox:settled'])

function createDisconnectedError(cause?: unknown): FlowControlError {
  return new FlowControlError({
    code: 'DISCONNECTED',
    message: 'Lost connection to the flow daemon',
    cause,
  })
}

/**
 * Normalizes a rejected daemon call. Error replies carry a `code` (Enkaku `RequestError`); a
 * rejection without one means the call never got a reply (transport disposed or replaced, client
 * aborted), so it is a lost connection.
 */
function toFlowControlError(error: unknown): FlowControlError {
  if (isFlowControlError(error)) return error
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code, message, data } = error as { code: unknown; message?: unknown; data?: unknown }
    const msg = typeof message === 'string' ? message : 'Flow request failed'
    if (typeof code === 'string' && HANDLER_CODES.has(code as FlowControlErrorCode)) {
      return new FlowControlError({
        code: code as FlowControlErrorCode,
        message: msg,
        data:
          typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : undefined,
        cause: error,
      })
    }
    return new FlowControlError({ code: 'INTERNAL_ERROR', message: msg, cause: error })
  }
  return createDisconnectedError(error)
}

/** Rethrows the caller's abort reason unchanged, everything else as a `FlowControlError`. */
function normalize(error: unknown, signal?: AbortSignal): never {
  if (signal?.aborted) throw signal.reason
  throw toFlowControlError(error)
}

async function call<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  try {
    return await work()
  } catch (error) {
    normalize(error, signal)
  }
}

/** Rejects with the signal's reason as soon as it aborts, without waiting for `promise`. */
function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal == null) return promise
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

type Waiter = {
  resolve: (result: IteratorResult<FlowEvent>) => void
  reject: (error: unknown) => void
}

async function subscribe(
  client: Client<Protocol>,
  signal?: AbortSignal,
): Promise<FlowSubscription> {
  signal?.throwIfAborted()

  const buffer: Array<FlowEvent> = []
  const waiters: Array<Waiter> = []
  let state: 'open' | 'closed' | 'failed' = 'open'
  let failure: FlowControlError | undefined

  const stream = client.createStream('events')
  const offReplaced = client.events.on('transportReplaced', () => {
    fail(createDisconnectedError())
  })
  const onAbort = () => close()
  signal?.addEventListener('abort', onAbort, { once: true })

  function teardown() {
    offReplaced()
    signal?.removeEventListener('abort', onAbort)
    stream.close()
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

  function push(event: HostEvent) {
    if (state !== 'open' || !FLOW_EVENT_TYPES.has(event.type)) return
    const flowEvent = { type: event.type, data: (event as { data: unknown }).data } as FlowEvent
    const waiter = waiters.shift()
    if (waiter == null) buffer.push(flowEvent)
    else waiter.resolve({ done: false, value: flowEvent })
  }

  // Start reading at once so events emitted before the barrier resolves are buffered.
  void (async () => {
    const reader = stream.readable.getReader()
    try {
      while (true) {
        const next = await reader.read()
        if (next.done) break
        push(next.value)
      }
      // The stream ended without the caller closing it: the daemon or transport went away.
      fail(createDisconnectedError())
    } catch (error) {
      fail(createDisconnectedError(error))
    } finally {
      reader.releaseLock()
    }
  })()

  try {
    // The daemon serves requests in order on one connection, so the events listener is
    // registered once `info` returns.
    await raceAbort(client.request('info', { signal }), signal)
  } catch (error) {
    close()
    normalize(error, signal)
  }
  if (failure != null && buffer.length === 0) {
    // Lost the connection while waiting for the barrier: nothing can be delivered.
    throw failure
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
    [Symbol.asyncIterator]: () => iterator,
    close,
  }
}

/**
 * Adapts the flow daemon's Enkaku client to `FlowControl`. Every method rejects only with a
 * `FlowControlError`, or with the caller's abort reason when its signal aborts.
 */
export function createRemoteFlowControl(client: Client<Protocol>): FlowControl {
  return {
    flows: {
      list: () => call(() => client.request('flows.list')),
      check: (definition) =>
        call(() => client.request('flows.check', { param: { definition } as CheckParam })),
    },
    runs: {
      start: (params) => call(() => client.request('runs.start', { param: params })),
      get: (runID) => call(() => client.request('runs.get', { param: { runID } })),
      list: (filter) => call(() => client.request('runs.list', { param: filter ?? {} })),
      cancel: (runID) => call(() => client.request('runs.cancel', { param: { runID } })),
      trace: (runID) => call(() => client.request('runs.trace', { param: { runID } })),
    },
    inbox: {
      list: (filter) => call(() => client.request('inbox.list', { param: filter ?? {} })),
      get: (id) => call(() => client.request('inbox.get', { param: { id } })),
      answer: (id, content) =>
        call(async () => {
          const param = (content === undefined ? { id } : { id, content }) as AnswerParam
          await client.request('inbox.answer', { param })
        }),
      decline: (id, reason) =>
        call(async () => {
          await client.request('inbox.decline', {
            param: reason === undefined ? { id } : { id, reason },
          })
        }),
      cancel: (id) =>
        call(async () => {
          await client.request('inbox.cancel', { param: { id } })
        }),
      prompt: (id, signal) =>
        call(async () => {
          const config = signal === undefined ? { param: { id } } : { param: { id }, signal }
          const result = await client.request('inbox.prompt', config)
          return result.action
        }, signal),
    },
    subscribe: (signal) => subscribe(client, signal),
  }
}
