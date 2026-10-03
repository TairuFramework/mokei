import type { Client } from '@enkaku/client'
import type { HostEvent, Protocol } from '@mokei/host-protocol'
import type { FromSchema } from '@sozai/schema'

import { raceAbort } from './abort.js'
import { FlowControlError, type FlowControlErrorCode, isFlowControlError } from './errors.js'
import { createEventQueue } from './subscription.js'
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

async function subscribe(
  client: Client<Protocol>,
  signal?: AbortSignal,
): Promise<FlowSubscription> {
  signal?.throwIfAborted()

  const stream = client.createStream('events')
  const queue = createEventQueue({
    signal,
    teardown: () => {
      offReplaced()
      stream.close()
    },
  })
  const offReplaced = client.events.on('transportReplaced', () => {
    queue.fail(createDisconnectedError())
  })

  // Start reading at once so events emitted before the barrier resolves are buffered.
  void (async () => {
    const reader = stream.readable.getReader()
    try {
      while (true) {
        const next = await reader.read()
        if (next.done) break
        const event = next.value as HostEvent
        if (FLOW_EVENT_TYPES.has(event.type)) {
          queue.push({ type: event.type, data: (event as { data: unknown }).data } as FlowEvent)
        }
      }
      // The stream ended without the caller closing it: the daemon or transport went away.
      queue.fail(createDisconnectedError())
    } catch (error) {
      queue.fail(createDisconnectedError(error))
    } finally {
      reader.releaseLock()
    }
  })()

  try {
    // The daemon serves requests in order on one connection, so the events listener is
    // registered once `info` returns.
    await raceAbort(client.request('info', { signal }), signal)
  } catch (error) {
    queue.subscription.close()
    normalize(error, signal)
  }
  const failure = queue.undeliveredFailure()
  if (failure != null) {
    // Lost the connection while waiting for the barrier: nothing can be delivered.
    throw failure
  }

  return queue.subscription
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
