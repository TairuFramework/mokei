import type { Deferred } from '@enkaku/async'
import type { ErrorResponse, RequestID, Response } from '@mokei/context-protocol'

import { RPCError } from './error.js'

export type ExchangeController = Deferred<unknown> & AbortController

export type StreamHandlers = {
  onProgress?: (value: unknown) => void
  onInputRequest?: (token: string, value: unknown) => void
  onSettle?: () => void
}

export type StreamFrame =
  | { type: 'progress'; value: unknown }
  | { type: 'input-request'; token: string; value: unknown }
  | { type: 'result'; value: unknown }
  | { type: 'error'; error: Error }

type OnceExchange = { kind: 'once'; controller: ExchangeController }
type StreamExchange = { kind: 'stream'; controller: ExchangeController; handlers: StreamHandlers }
type PendingExchange = OnceExchange | StreamExchange

/**
 * Owns the outbound id → pending-exchange map and routes inbound frames to it.
 * A `once` exchange settles on the first matching response (current behavior); a
 * `stream` exchange accepts interleaved frames and settles on a terminal one.
 */
export class ExchangeRegistry {
  #exchanges: Map<RequestID, PendingExchange> = new Map()

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

  routeResponse(id: RequestID, response: Response): void {
    const exchange = this.#exchanges.get(id)
    if (exchange == null) {
      return
    }
    this.#exchanges.delete(id)
    if ('error' in response) {
      exchange.controller.reject(RPCError.fromResponse(response as ErrorResponse))
    } else if ('result' in response) {
      exchange.controller.resolve(response.result)
    }
    if (exchange.kind === 'stream') {
      exchange.handlers.onSettle?.()
    }
  }

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
        this.#exchanges.delete(id)
        exchange.controller.resolve(frame.value)
        exchange.handlers.onSettle?.()
        break
      case 'error':
        this.#exchanges.delete(id)
        exchange.controller.reject(frame.error)
        exchange.handlers.onSettle?.()
        break
    }
  }

  cancel(id: RequestID, reason: Error): void {
    const exchange = this.#exchanges.get(id)
    if (exchange == null) {
      return
    }
    this.#exchanges.delete(id)
    exchange.controller.reject(reason)
    if (exchange.kind === 'stream') {
      exchange.handlers.onSettle?.()
    }
  }

  endAll(reason: Error): void {
    const exchanges = Array.from(this.#exchanges.values())
    this.#exchanges.clear()
    for (const exchange of exchanges) {
      exchange.controller.reject(reason)
      if (exchange.kind === 'stream') {
        exchange.handlers.onSettle?.()
      }
    }
  }
}
