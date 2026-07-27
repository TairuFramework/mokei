import { INTERNAL_ERROR, type RequestID, type Response } from '@mokei/context-protocol'
import type { Deferred } from '@sozai/async'

import { isErrorResponse, RPCError } from './error.js'

export type ExchangeController = Deferred<unknown> & AbortController

/**
 * Why an exchange stopped, as reported to `onSettle`:
 * - `result`: a terminal result was received
 * - `error`: a terminal error was received, or the peer sent a malformed response
 * - `cancel`: the exchange was cancelled locally (abort, timeout)
 * - `closed`: the transport went away and every exchange was ended
 */
export type SettleReason = 'result' | 'error' | 'cancel' | 'closed'

export type StreamHandlers = {
  onProgress?: (value: unknown) => void
  onInputRequest?: (token: string, value: unknown) => void
  onSettle?: (reason: SettleReason) => void
}

export type StreamFrame =
  | { type: 'progress'; value: unknown }
  | { type: 'input-request'; token: string; value: unknown }
  | { type: 'result'; value: unknown }
  | { type: 'error'; error: Error }

type OnceExchange = { kind: 'once'; controller: ExchangeController }
type StreamExchange = { kind: 'stream'; controller: ExchangeController; handlers: StreamHandlers }
type PendingExchange = OnceExchange | StreamExchange

type Outcome = { ok: true; value: unknown } | { ok: false; error: Error }

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * Owns the outbound id → pending-exchange map and routes inbound frames to it.
 * A `once` exchange settles on the first matching response (current behavior); a
 * `stream` exchange accepts interleaved frames and settles on a terminal one.
 */
export class ExchangeRegistry {
  #exchanges: Map<RequestID, PendingExchange> = new Map()

  /** Removes the exchange, settles its controller and notifies stream handlers. */
  #settle(id: RequestID, exchange: PendingExchange, reason: SettleReason, outcome: Outcome): void {
    this.#exchanges.delete(id)
    if (outcome.ok) {
      exchange.controller.resolve(outcome.value)
    } else {
      exchange.controller.reject(outcome.error)
    }
    if (exchange.kind === 'stream') {
      exchange.handlers.onSettle?.(reason)
    }
  }

  has(id: RequestID): boolean {
    return this.#exchanges.has(id)
  }

  registerOnce(id: RequestID, controller: ExchangeController): void {
    this.#exchanges.set(id, { kind: 'once', controller })
  }

  registerStream(
    id: RequestID,
    controller: ExchangeController,
    handlers: StreamHandlers = {},
  ): void {
    this.#exchanges.set(id, { kind: 'stream', controller, handlers })
  }

  /**
   * Routes a JSON-RPC response, settling either arm. A response carrying neither a
   * usable `result` nor a well-formed `error` is malformed: rather than leaving the
   * exchange pending forever, it is settled as an internal error.
   */
  routeResponse(id: RequestID, response: Response): void {
    const exchange = this.#exchanges.get(id)
    if (exchange == null) {
      return
    }
    if (isErrorResponse(response)) {
      this.#settle(id, exchange, 'error', { ok: false, error: RPCError.fromResponse(response) })
    } else if ('result' in response) {
      this.#settle(id, exchange, 'result', { ok: true, value: response.result })
    } else {
      this.#settle(id, exchange, 'error', {
        ok: false,
        error: new RPCError(INTERNAL_ERROR, 'Malformed response'),
      })
    }
  }

  /**
   * Routes a stream frame to a `stream` exchange. Frames for an unknown id, for a
   * `once` exchange, or of an unknown type are dropped without settling — only the
   * `result` and `error` frames are terminal.
   */
  routeStreamFrame(id: RequestID, frame: StreamFrame): void {
    const exchange = this.#exchanges.get(id)
    if (exchange == null || exchange.kind !== 'stream') {
      return
    }
    switch (frame.type) {
      case 'progress':
        exchange.handlers.onProgress?.(frame.value)
        break
      case 'input-request':
        exchange.handlers.onInputRequest?.(frame.token, frame.value)
        break
      case 'result':
        this.#settle(id, exchange, 'result', { ok: true, value: frame.value })
        break
      case 'error':
        this.#settle(id, exchange, 'error', { ok: false, error: toError(frame.error) })
        break
    }
  }

  cancel(id: RequestID, reason: Error): void {
    const exchange = this.#exchanges.get(id)
    if (exchange == null) {
      return
    }
    this.#settle(id, exchange, 'cancel', { ok: false, error: reason })
  }

  endAll(reason: Error): void {
    for (const [id, exchange] of Array.from(this.#exchanges.entries())) {
      this.#settle(id, exchange, 'closed', { ok: false, error: reason })
    }
  }
}
