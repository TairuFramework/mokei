import {
  createEventQueue,
  type FlowControl,
  FlowControlError,
  type FlowEvent,
  type FlowSubscription,
  isFlowControlError,
} from '@mokei/flow-client'

import { describeFlowHostError, InboxItemNotFoundError, RunNotFoundError } from './errors.js'
import type { FlowHost, StartRunParams } from './types.js'

export type LocalFlowControlExtras = {
  trace?: FlowControl['runs']['trace']
  prompt?: FlowControl['inbox']['prompt']
}

function toFlowControlError(error: unknown): FlowControlError {
  if (isFlowControlError(error)) return error
  const description = describeFlowHostError(error)
  if (description != null) {
    return new FlowControlError({ ...description, cause: error })
  }
  return new FlowControlError({
    code: 'INTERNAL_ERROR',
    message: 'Flow request failed',
    cause: error,
  })
}

async function call<T>(work: () => T | Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    throw toFlowControlError(error)
  }
}

async function subscribe(host: FlowHost, signal?: AbortSignal): Promise<FlowSubscription> {
  signal?.throwIfAborted()
  const offs: Array<() => void> = []
  const queue = createEventQueue({
    signal,
    teardown: () => {
      for (const off of offs.splice(0)) off()
    },
  })
  // Listeners register synchronously, so the subscription is live once this resolves.
  offs.push(
    host.events.on('run:state', (data) => queue.push({ type: 'run:state', data })),
    host.events.on('inbox:added', (data) => queue.push({ type: 'inbox:added', data })),
    host.events.on('inbox:settled', (data) =>
      queue.push({ type: 'inbox:settled', data } satisfies FlowEvent),
    ),
  )
  return queue.subscription
}

/**
 * Adapts an in-process `FlowHost` to `FlowControl`. Every method rejects only with a
 * `FlowControlError`. `trace` and `prompt` exist only when supplied in `extras`.
 */
export function createLocalFlowControl(
  host: FlowHost,
  extras: LocalFlowControlExtras = {},
): FlowControl {
  const control: FlowControl = {
    flows: {
      list: () => call(() => host.flows()),
      check: (definition) =>
        call(async () => {
          const checked = await host.check(definition)
          const details = { warnings: checked.warnings, formatted: checked.formatted }
          return checked.issues
            ? { issues: [...checked.issues], ...details }
            : { value: checked.value, ...details }
        }),
    },
    runs: {
      start: (params) => call(() => host.start(params as StartRunParams)),
      get: (runID) =>
        call(async () => {
          const snapshot = await host.get(runID)
          if (snapshot == null) throw new RunNotFoundError({ runID })
          return snapshot
        }),
      list: (filter) => call(() => host.list(filter)),
      cancel: (runID) => call(() => host.cancel(runID)),
    },
    inbox: {
      list: (filter) => call(() => host.inbox.list(filter)),
      get: (id) =>
        call(() => {
          const item = host.inbox.get(id)
          if (item == null) throw new InboxItemNotFoundError({ itemID: id })
          return item
        }),
      answer: (id, content) => call(() => host.inbox.answer(id, content)),
      decline: (id, reason) => call(() => host.inbox.decline(id, reason)),
      cancel: (id) => call(() => host.inbox.cancel(id)),
    },
    subscribe: (signal) => subscribe(host, signal),
  }
  if (extras.trace != null) control.runs.trace = extras.trace
  if (extras.prompt != null) control.inbox.prompt = extras.prompt
  return control
}
