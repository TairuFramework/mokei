import type { TransportType } from '@enkaku/transport'
import type {
  AnyMessage,
  CancelledNotification,
  Notification,
  ProgressNotification,
  Request,
  RequestID,
  Response,
} from '@mokei/context-protocol'
import { INTERNAL_ERROR, INVALID_REQUEST } from '@mokei/context-protocol'
import { Disposer, defer, toPromise } from '@sozai/async'
import { EventEmitter } from '@sozai/event'
import type { Validator } from '@sozai/schema'

import { ContinuationStore } from './continuation.js'
import { errorResponse, RequestTimeoutError, RPCError, TransportClosedError } from './error.js'
import { type ExchangeController, ExchangeRegistry, type StreamHandlers } from './exchange.js'

function isRequestID(id: unknown): id is RequestID {
  return typeof id === 'string' || typeof id === 'number'
}

type RequestDefinition = {
  Params: unknown | undefined
  Result: unknown | undefined
}

export type RequestOptions = {
  /** Aborts the request, rejecting its promise and notifying the peer. */
  signal?: AbortSignal
  /** Rejects the request with a RequestTimeoutError after this many ms. */
  timeout?: number
}

/**
 * A public request method's parameters: the request's wire params, plus the transport
 * options that drive the exchange carrying them.
 *
 * The two are one object at the API surface and must be separated before the params
 * reach the wire — see {@link splitRequestOptions}. No MCP request declares a `signal`
 * or `timeout` param, so the merge is unambiguous.
 */
export type WithRequestOptions<Params> = Params & RequestOptions

/**
 * Splits a public parameters object into the params sent on the wire and the transport
 * options kept local to this process.
 *
 * `ContextRPC.request` passes its `params` straight to the peer, so an `AbortSignal` or
 * timeout left in that object would be serialized as a request param. Every public
 * method that accepts {@link WithRequestOptions} must split here first.
 */
export function splitRequestOptions<Params>(
  params: WithRequestOptions<Params>,
): [Params, RequestOptions] {
  const { signal, timeout, ...wireParams } = params as WithRequestOptions<Record<string, unknown>>
  return [wireParams as Params, { signal, timeout }]
}

export type RPCTypes = {
  Events: Record<string, unknown>
  MessageIn: AnyMessage
  MessageOut: AnyMessage
  HandleNotification: Notification
  HandleRequest: Request
  SendNotifications: Record<string, Notification>
  SendRequests: Record<string, RequestDefinition>
  SendResult: unknown
}

export type RPCParams<T extends RPCTypes> = {
  transport: TransportType<T['MessageIn'], T['MessageOut']>
  validateMessageIn: Validator<T['MessageIn']>
}

export class ContextRPC<T extends RPCTypes> extends Disposer {
  #closed = false
  #events: EventEmitter<T['Events']>
  #receivedRequests: Record<RequestID, AbortController> = {}
  #requestID = 0
  #exchanges: ExchangeRegistry = new ExchangeRegistry()
  #continuations: ContinuationStore = new ContinuationStore()
  #transport: TransportType<T['MessageIn'], T['MessageOut']>
  #validateMessageIn: Validator<T['MessageIn']>

  constructor(params: RPCParams<T>) {
    super({ dispose: () => this.#dispose() })
    this.#events = new EventEmitter<T['Events']>()
    this.#transport = params.transport
    this.#validateMessageIn = params.validateMessageIn
  }

  get events(): EventEmitter<T['Events']> {
    return this.#events
  }

  _getNextRequestID(): RequestID {
    return this.#requestID++
  }

  async _read(): Promise<ReadableStreamReadResult<T['MessageIn']>> {
    return await this.#transport.read()
  }

  async _write(message: T['MessageOut']): Promise<void> {
    await this.#transport.write(message)
  }

  _handle(): void {
    void this.#readLoop()
  }

  async #readLoop(): Promise<void> {
    try {
      while (true) {
        const next = await this._read()
        if (next.done) {
          break
        }
        let response: Response | null = null
        try {
          response = await this._handleMessage(next.value)
        } catch {
          // _handleMessage is defensive; never let a handler error kill the loop.
          response = null
        }
        if (response != null) {
          try {
            await this._write(response)
          } catch {
            // A failed response write is not fatal; transport death surfaces on next read.
          }
        }
      }
      this.#close()
    } catch (cause) {
      this.#close(
        cause instanceof Error
          ? cause
          : new TransportClosedError('Transport read failed', { cause }),
      )
    }
  }

  #close(reason?: Error): void {
    if (this.#closed) {
      return
    }
    this.#closed = true
    this.#endPendingRequests(reason ?? new TransportClosedError())
    this._onTransportClosed(reason)
  }

  #endPendingRequests(reason: Error): void {
    this.#exchanges.endAll(reason)
    this.#continuations.clearAll(reason)
  }

  async #dispose(): Promise<void> {
    this.#close(new TransportClosedError('Transport disposed'))
    await this.#transport.dispose()
  }

  /** @internal Called once when the read loop terminates. Subclasses may override to surface it. */
  _onTransportClosed(_reason?: Error): void {}

  _handleMessage(message: T['MessageIn']): Response | null | Promise<Response | null> {
    const validated = this.#validateMessageIn(message)
    if (validated.issues != null) {
      // Message is invalid for the protocol
      const id = message.id
      if (message.method != null && isRequestID(id)) {
        // Send an error response if incoming message is a request
        return new RPCError(INVALID_REQUEST, 'Invalid request').toResponse(id)
      }
      // TODO: call optional error handler
      return null
    }

    // Message is valid for protocol
    const id = validated.value.id as RequestID | undefined
    if (id == null) {
      // Message is a notification
      const notification = validated.value as
        | CancelledNotification
        | ProgressNotification
        | T['HandleNotification']
      if (notification.method === 'notifications/cancelled') {
        const cancelled = notification as CancelledNotification
        const controller = this.#receivedRequests[cancelled.params.requestId]
        if (controller != null) {
          controller.abort()
          delete this.#receivedRequests[cancelled.params.requestId]
        }
      } else {
        void this._handleNotification(notification)
      }
      return null
    }

    if (validated.value.method == null) {
      // Message is a response — route to its pending exchange.
      this.#exchanges.routeResponse(id, validated.value as Response)
      return null
    }

    if (validated.value.method === 'ping') {
      // Handle ping request
      return { jsonrpc: '2.0', id, result: {} }
    }

    // Message is a request
    const controller = new AbortController()
    this.#receivedRequests[id] = controller
    return toPromise(() => {
      return this._handleRequest(validated.value as T['HandleRequest'], controller.signal)
    })
      .then(
        (result) => {
          if (this.#receivedRequests[id] == null || this.#receivedRequests[id].signal.aborted) {
            return null
          }
          return result == null
            ? new RPCError(INTERNAL_ERROR, 'No result').toResponse(id)
            : { jsonrpc: '2.0' as const, id, result }
        },
        (cause) => {
          // TODO: call optional error handler
          return this.#receivedRequests[id] == null || this.#receivedRequests[id].signal.aborted
            ? null
            : errorResponse(id, cause)
        },
      )
      .finally(() => {
        delete this.#receivedRequests[id]
      })
  }

  // TODO: handle cancel notification, delegate to handler for other notifications
  _handleNotification(
    _notification: ProgressNotification | T['HandleNotification'],
  ): void | Promise<void> {}

  _handleRequest(
    _request: T['HandleRequest'],
    _signal: AbortSignal,
  ): T['SendResult'] | Promise<T['SendResult']> {
    throw new Error('_handleRequest() method must be implemented')
  }

  async notify<Event extends keyof T['SendNotifications'] & string>(
    event: Event,
    params: T['SendNotifications'][Event]['params'],
  ): Promise<void> {
    await this._write({ jsonrpc: '2.0', method: `notifications/${event}`, params })
  }

  #startExchange(
    id: RequestID,
    controller: ExchangeController,
    method: string,
    params: unknown,
  ): Promise<unknown> {
    controller.signal.addEventListener('abort', () => {
      if (!this.#exchanges.has(id)) {
        return
      }
      this.#exchanges.cancel(id, new Error('Cancelled'))
      this.notify('cancelled', { requestId: id }).catch(() => {})
    })

    this._write({ jsonrpc: '2.0', id, method, params } as T['MessageOut']).catch((error) => {
      if (!this.#exchanges.has(id)) {
        return
      }
      this.#exchanges.cancel(id, error)
    })

    return controller.promise
  }

  /** Aborts `controller` when `signal` fires, detaching once the exchange settles. */
  #linkSignal(controller: ExchangeController, signal: AbortSignal): void {
    const onAbort = () => {
      controller.abort()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    const detach = () => {
      signal.removeEventListener('abort', onAbort)
    }
    controller.promise.then(detach, detach)
  }

  request<Method extends keyof T['SendRequests']>(
    method: Method,
    params: T['SendRequests'][Method]['Params'],
    options?: RequestOptions,
  ): Promise<T['SendRequests'][Method]['Result']> {
    // A signal already aborted at call time sends nothing on the wire.
    if (options?.signal?.aborted) {
      return Promise.reject(options.signal.reason as Error)
    }

    const id = this._getNextRequestID()
    const controller = Object.assign(new AbortController(), defer())
    this.#exchanges.registerOnce(id, controller)

    if (options?.timeout != null) {
      const timer = setTimeout(() => {
        if (!this.#exchanges.has(id)) {
          return
        }
        this.#exchanges.cancel(
          id,
          new RequestTimeoutError(`Request timed out after ${options.timeout}ms`),
        )
        this.notify('cancelled', { requestId: id }).catch(() => {})
      }, options.timeout)
      controller.promise.then(
        () => clearTimeout(timer),
        () => clearTimeout(timer),
      )
    }

    if (options?.signal != null) {
      this.#linkSignal(controller, options.signal)
    }

    return this.#startExchange(id, controller, method as string, params) as Promise<
      T['SendRequests'][Method]['Result']
    >
  }

  /**
   * @internal Register a streaming exchange (MRTR, SEP-2322): a request answered by
   * interleaved frames. No wire path produces stream frames yet; exercised by tests.
   */
  _registerStreamExchange(
    method: string,
    params: unknown,
    handlers?: StreamHandlers,
    options?: RequestOptions,
  ): Promise<unknown> {
    if (options?.signal?.aborted) {
      return Promise.reject(options.signal.reason as Error)
    }
    const id = this._getNextRequestID()
    const controller = Object.assign(new AbortController(), defer())
    this.#exchanges.registerStream(id, controller, {
      ...handlers,
      onSettle: () => {
        this.#continuations.clearForExchange(id, new Error('Exchange settled'))
        handlers?.onSettle?.()
      },
    })
    if (options?.signal != null) {
      this.#linkSignal(controller, options.signal)
    }
    return this.#startExchange(id, controller, method, params)
  }
}
