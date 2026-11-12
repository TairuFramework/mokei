import { type ContextClient, TaskInterruptedError, transportFailureOf } from '@mokei/context-client'
import { TransportClosedError } from '@mokei/context-rpc'

import { ContextUnavailableError } from './errors.js'
import type { HostedContext } from './hosted-context.js'
import type { ReconnectController } from './reconnect.js'

/** Sends one gated request on `client`, with the time left (`undefined`: no deadline). */
export type GatedSend<R> = (client: ContextClient, timeout: number | undefined) => Promise<R>

export type GatedRequestParams<R> = {
  key: string
  registration: HostedContext
  controller: ReconnectController
  /** Whether `registration` is still the key's registration. */
  isRegistered: () => boolean
  options: { signal?: AbortSignal; timeout?: number }
  request: { send: GatedSend<R>; toolName?: string }
}

/** The request failed with the loss of its connection, not with anything the server said. */
export function isLossError(error: unknown): boolean {
  if (error instanceof TransportClosedError) return true
  const kind = transportFailureOf(error)?.kind
  return kind === 'network' || kind === 'session-expired'
}

/**
 * Runs a request on a context that can reconnect. One deadline is taken at entry (from
 * `timeout`; none without one): a reconnect is waited out at the gate within it, and the request
 * then runs with what is left. The registration is re-read before dispatch and must still be the
 * one the call started on. A read-only tool call (`toolName`) lost in flight with its
 * generation is retried once on the new client.
 */
export async function runGated<R>(params: GatedRequestParams<R>): Promise<R> {
  const { key, registration, controller, isRegistered, options, request } = params
  const { signal, timeout } = options
  const deadline = timeout == null ? Number.POSITIVE_INFINITY : Date.now() + timeout
  let retried = false
  for (;;) {
    if (signal?.aborted) throw signal.reason
    // Aborts are checked again on wake inside `waitForGate`, where an abort wins the race.
    await controller.waitForGate({ signal, deadline })
    if (signal?.aborted) throw signal.reason
    if (!isRegistered()) {
      throw new ContextUnavailableError({
        key,
        cause: new Error(`Context ${key} was removed while the request waited`),
      })
    }
    // Lost again between the gate opening and this wake: wait for the next gate, same deadline.
    if (controller.state === 'reconnecting') continue
    const client = registration.client
    const generation = controller.generation
    // Read from the generation the call is sent on: a retry trusts the lost one's listing.
    const readOnly =
      request.toolName != null &&
      registration.tools.find((ct) => ct.tool.name === request.toolName)?.tool.annotations
        ?.readOnlyHint === true
    // One clock read: the budget checked is the budget sent.
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      throw new ContextUnavailableError({
        key,
        cause: new Error(`Context ${key} reconnected after the request's deadline`),
      })
    }
    try {
      return await request.send(client, timeout == null ? undefined : remaining)
    } catch (error) {
      if (!isLossError(error)) {
        throw error
      }
      // The loss may surface on the call before the transport or client reports it. Ignored
      // when it was already reported or the context is not armed (never removes an unarmed
      // context).
      controller.lose(generation, error as Error)
      if (
        retried ||
        !readOnly ||
        signal?.aborted ||
        // The server accepted a task: running the call again would run it twice.
        error instanceof TaskInterruptedError ||
        controller.generation === generation ||
        deadline - Date.now() <= 0
      ) {
        throw error
      }
      retried = true
    }
  }
}
