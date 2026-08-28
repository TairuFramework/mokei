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
import { INTERNAL_ERROR, INVALID_REQUEST, SERVER_SHUTTING_DOWN } from '@mokei/context-protocol'
import { type Deferred, Disposer, defer, toPromise } from '@sozai/async'
import { EventEmitter } from '@sozai/event'
import type { Validator } from '@sozai/schema'

import { ContinuationStore } from './continuation.js'
import { errorResponse, RequestTimeoutError, RPCError, TransportClosedError } from './error.js'
import {
  type ExchangeController,
  ExchangeRegistry,
  type StreamFrame,
  type StreamHandlers,
} from './exchange.js'
import { RequestScheduler } from './scheduler.js'

function isRequestID(id: unknown): id is RequestID {
  return typeof id === 'string' || typeof id === 'number'
}

/**
 * Bounds how long an explicit `dispose()` waits, in `#flushHeldResponses`, for held
 * `subscriptions/listen` responses to write their graceful terminal result before the
 * transport closes. A real bound: a handler that never resolves `terminal` must not hang
 * disposal forever.
 */
const HELD_RESPONSE_FLUSH_DEADLINE_MS = 5000

/**
 * Marker a request handler returns to defer its JSON-RPC response indefinitely (SEP-1391
 * `subscriptions/listen`): the request is validated, dispatched and slot-scheduled like any
 * other, but instead of a result body the handler hands back a `terminal` promise. The
 * request then releases its concurrency slot while keeping its cancellation/duplicate-id
 * identity, and its response is written only when `terminal` resolves (on graceful teardown).
 *
 * `beforeTerminal`, if given, runs after `terminal` resolves and before the response is
 * written — the hook where a subclass flushes any final stream state.
 */
export type HeldResponse<Result> = {
  kind: 'held'
  terminal: Promise<Result>
  beforeTerminal?: () => Promise<void>
  /**
   * @internal Settles once this response is written (or torn down by cancel/dispose). Created by
   * {@link ContextRPC._holdResponse}, so a subclass can `await held.written.promise` before
   * `#holdRequest` runs. `ContextRPC` settles it.
   */
  written: Deferred<void>
}

/** Narrows a handler's return value to a {@link HeldResponse}. */
export function isHeldResponse(value: unknown): value is HeldResponse<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'held' &&
    (value as { terminal?: unknown }).terminal instanceof Promise
  )
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
  /**
   * Returns a suspended MRTR result to the caller instead of driving the retry rounds
   * (SEP-2322). Consumed by `@mokei/context-client`; `ContextRPC` itself ignores it.
   */
  allowInputRequired?: boolean
  /**
   * Bounds a whole MRTR flow, as opposed to `timeout`, which bounds one leg of it. Consumed by
   * `@mokei/context-client`; `ContextRPC` itself ignores it.
   */
  maxTotalTimeout?: number
}

/**
 * A public request method's parameters: the request's wire params, plus the transport
 * options that drive the exchange carrying them.
 *
 * The two are one object at the API surface and must be separated before the params
 * reach the wire — see {@link splitRequestOptions}. No MCP request declares a `signal`,
 * `timeout`, `allowInputRequired` or `maxTotalTimeout` param, so the merge is unambiguous.
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
  const { signal, timeout, allowInputRequired, maxTotalTimeout, ...wireParams } =
    params as WithRequestOptions<Record<string, unknown>>
  return [wireParams as Params, { signal, timeout, allowInputRequired, maxTotalTimeout }]
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

/** Detail carried by a transport's `streamEvents` `closed` event — see {@link StreamEventsTransport}. */
export type StreamClosedEvent = { requestID: RequestID; error?: Error }

/**
 * Optional transport capability (the HTTP client, later): fires `closed` when a per-request
 * stream body ends without a terminal response, naming the exchange that was left hanging so
 * `ContextRPC` can settle just that one instead of waiting forever. A transport without this
 * property behaves exactly as before — `ContextRPC` only subscribes when it is present.
 */
export type StreamEventsTransport = {
  streamEvents: EventEmitter<{ closed: StreamClosedEvent }>
}

export type RPCParams<T extends RPCTypes> = {
  /**
   * Timeout applied to a request that passes none of its own. Unset means unbounded, which
   * is the historical behavior: a blanket default would cut off a long-running `tools/call`.
   */
  defaultRequestTimeout?: number
  /** Request handlers allowed to run at once (default 100). */
  maxConcurrentRequests?: number
  /** Requests allowed to wait for a slot before further requests are refused (default 1000). */
  maxQueuedRequests?: number
  /**
   * Called for an inbound frame that could neither be validated nor routed to anything —
   * an invalid notification, or a malformed frame naming an id nobody is waiting on — and
   * for request handlers that failed. Without it such frames vanish silently.
   */
  onError?: (error: Error) => void
  /**
   * Diverts an inbound notification into an existing stream exchange instead of
   * `_handleNotification` — used by `subscriptions/listen` (SEP-1391), where server
   * notifications carry a subscriptionId that maps back to the listen request's stream
   * exchange. Returning `null` leaves the notification to the normal handling path.
   */
  routeStreamNotification?: (
    notification: ProgressNotification | T['HandleNotification'],
  ) => { id: RequestID; frame: StreamFrame } | null
  transport: TransportType<T['MessageIn'], T['MessageOut']> & Partial<StreamEventsTransport>
  validateMessageIn: Validator<T['MessageIn']>
}

/**
 * Message ordering:
 * - notifications and responses are handled in wire order, synchronously in the read loop;
 * - requests *start* in wire order and complete out of order;
 * - a request never delays a notification — which is what lets `notifications/cancelled`
 *   reach a handler that is still running.
 */
export class ContextRPC<T extends RPCTypes> extends Disposer {
  #closed = false
  #disposing = false
  #defaultRequestTimeout?: number
  #events: EventEmitter<T['Events']>
  #requestID = 0
  #exchanges: ExchangeRegistry = new ExchangeRegistry()
  #continuations: ContinuationStore = new ContinuationStore()
  #scheduler: RequestScheduler
  // Requests whose handler returned a held response, awaiting their `terminal` resolution.
  // Keyed by id; the scheduler holds the matching detached controller. `settled` resolves once
  // the entry is removed (terminal written, terminal rejected, or the request was cancelled) —
  // `#flushHeldResponses` awaits it on disposal.
  #heldRequests: Map<RequestID, { signal: AbortSignal; settled: Promise<void> }> = new Map()
  // In-flight `#writeResponse` calls, tracked so disposal can await them before the transport
  // tears down — otherwise a response write racing `#dispose()` (e.g. the synchronous
  // SERVER_SHUTTING_DOWN rejection written from the read loop) can be cut off mid-flight and
  // the peer sees EOF instead of the frame. Every added promise is removed on settle via
  // `.finally()`, and it never rejects — `#writeResponse` already swallows write errors.
  #pendingWrites: Set<Promise<void>> = new Set()
  #transport: TransportType<T['MessageIn'], T['MessageOut']> & Partial<StreamEventsTransport>
  #validateMessageIn: Validator<T['MessageIn']>
  #onError?: (error: Error) => void
  #routeStreamNotification?: (
    notification: ProgressNotification | T['HandleNotification'],
  ) => { id: RequestID; frame: StreamFrame } | null
  // Unsubscribes from `transport.streamEvents` — set only when the transport exposes that
  // optional capability, called once from `#close` so the listener never outlives the RPC.
  #unsubscribeStreamEvents?: () => void

  constructor(params: RPCParams<T>) {
    super({ dispose: () => this.#dispose() })
    this.#events = new EventEmitter<T['Events']>()
    this.#scheduler = new RequestScheduler({
      maxConcurrentRequests: params.maxConcurrentRequests,
      maxQueuedRequests: params.maxQueuedRequests,
    })
    this.#defaultRequestTimeout = params.defaultRequestTimeout
    this.#transport = params.transport
    this.#validateMessageIn = params.validateMessageIn
    this.#onError = params.onError
    this.#routeStreamNotification = params.routeStreamNotification
    if (params.transport.streamEvents != null) {
      this.#unsubscribeStreamEvents = params.transport.streamEvents.on(
        'closed',
        ({ requestID, error }) => {
          this.#exchanges.close(requestID, error ?? new TransportClosedError('stream closed'))
        },
      )
    }
  }

  /**
   * Reports an error to the consumer's handler without letting it back into the RPC layer:
   * a callback that throws must not suppress the response this request still owes its peer.
   */
  #reportError(error: Error): void {
    try {
      this.#onError?.(error)
    } catch {
      // A consumer's error handler is not allowed to break message handling.
    }
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
        let result: Response | null | Promise<Response | null> = null
        try {
          result = this._handleMessage(next.value)
        } catch {
          // _handleMessage is defensive; never let a handler error kill the loop.
          result = null
        }
        if (result == null) {
          continue
        }
        if (result instanceof Promise) {
          // Deliberately not awaited: awaiting here is what made every mokei server handle
          // one request at a time, and made `notifications/cancelled` unreadable until the
          // request it names had already settled.
          void this.#settleRequest(result)
        } else {
          await this.#writeResponse(result)
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

  async #settleRequest(pending: Promise<Response | null>): Promise<void> {
    let response: Response | null = null
    try {
      response = await pending
    } catch {
      // The request branch of `_handleMessage` turns handler failures into error responses;
      // a rejection here is a defect in that branch, not something to kill the loop over.
      return
    }
    if (response != null) {
      await this.#writeResponse(response)
    }
  }

  async #writeResponse(response: Response): Promise<void> {
    const write = (async () => {
      try {
        await this._write(response as T['MessageOut'])
      } catch {
        // A failed response write is not fatal; transport death surfaces on next read.
      }
    })()
    const tracked = write.finally(() => {
      this.#pendingWrites.delete(tracked)
    })
    this.#pendingWrites.add(tracked)
    await tracked
  }

  /**
   * Awaits every response write currently in flight. Snapshots to an array first: iterating a
   * `Set` that a concurrent `.finally()` mutates mid-loop is not safe to do directly, and new
   * writes started after the snapshot are not this call's concern — a later caller waits for
   * those.
   */
  async #flushPendingWrites(): Promise<void> {
    if (this.#pendingWrites.size === 0) {
      return
    }
    await Promise.allSettled(Array.from(this.#pendingWrites))
  }

  #close(reason?: Error): void {
    if (this.#closed) {
      return
    }
    this.#closed = true
    this.#unsubscribeStreamEvents?.()
    this.#endPendingRequests(reason ?? new TransportClosedError())
    this._onTransportClosed(reason)
  }

  #endPendingRequests(reason: Error): void {
    this.#exchanges.endAll(reason)
    this.#continuations.clearAll(reason)
    // Outbound exchanges are not the only thing a closed transport strands: a handler still
    // running has nobody left to answer, so it is told the connection is gone. Covers both
    // `#dispose()` and a peer EOF, which both funnel through `#close()`.
    this.#scheduler.abortAll(reason)
  }

  async #dispose(): Promise<void> {
    this.#disposing = true
    const reason = new TransportClosedError('Transport disposed')
    // Explicit dispose only: gives a subclass a chance to resolve any held
    // `subscriptions/listen` terminals so their graceful result can still be written. A peer
    // EOF runs `#close()` directly and never reaches this hook.
    await this.#flushBeforeClose(reason)
    this.#close(reason)
    // Backstop: a response write can start just after `#flushBeforeClose` checked
    // `#pendingWrites` (most commonly the synchronous SERVER_SHUTTING_DOWN rejection the
    // read loop writes for a request rejected while disposing) and so miss that flush's own
    // await. Catching it here, as the last step before the transport tears down, is what
    // keeps that write from being cut off mid-flight. Bounded by the same deadline as
    // `#flushBeforeClose` so disposal as a whole stays bounded.
    await this.#awaitPendingWritesWithDeadline()
    await this.#transport.dispose()
  }

  /**
   * @internal Called once on an explicit `dispose()`, before the transport closes and before
   * held responses are flushed — the hook where a server subclass resolves any held
   * `subscriptions/listen` terminals so their graceful result gets a chance to be written before
   * the transport goes away. Default no-op. Not called on a peer EOF, which stays abrupt.
   */
  _beforeTransportClose(_reason: Error): void | Promise<void> {}

  /**
   * Pre-close teardown under one deadline ({@link HELD_RESPONSE_FLUSH_DEADLINE_MS}):
   * `_beforeTransportClose` (which may await terminal writes, e.g. `hub.endAllGracefully()`), then a
   * backstop wait for any still-held terminal to settle and write. The hook is inside the deadline
   * so a graceful teardown can't make disposal unbounded; anything unfinished at the deadline is
   * left for `#close`'s `abortAll`. Best-effort — errors are reported, never block disposal.
   */
  async #flushBeforeClose(reason: Error): Promise<void> {
    const flush = (async () => {
      // Caught separately so a throwing hook does not skip the held-response flush.
      try {
        await this._beforeTransportClose(reason)
      } catch (cause) {
        this.#reportError(cause instanceof Error ? cause : new Error(String(cause)))
      }
      if (this.#heldRequests.size > 0) {
        try {
          await Promise.all(Array.from(this.#heldRequests.values(), (held) => held.settled))
        } catch (cause) {
          this.#reportError(cause instanceof Error ? cause : new Error(String(cause)))
        }
      }
      // Also let any response write already in flight land — most commonly the synchronous
      // SERVER_SHUTTING_DOWN rejection the read loop writes for a request that arrived after
      // `#disposing` flipped true, which races this very flush. `#dispose`'s own backstop
      // await (after `#close()`) catches anything that starts too late to be seen here.
      await this.#flushPendingWrites()
    })()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        flush,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, HELD_RESPONSE_FLUSH_DEADLINE_MS)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Bounded backstop wait for any response write still in flight, used by `#dispose` as the
   * last step before the transport tears down. A fresh {@link HELD_RESPONSE_FLUSH_DEADLINE_MS}
   * bound, separate from `#flushBeforeClose`'s — keeping this step bounded on its own is what
   * keeps disposal as a whole bounded, since it runs after that flush's own deadline race has
   * already resolved.
   */
  async #awaitPendingWritesWithDeadline(): Promise<void> {
    if (this.#pendingWrites.size === 0) {
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        this.#flushPendingWrites(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, HELD_RESPONSE_FLUSH_DEADLINE_MS)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
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
      if (isRequestID(id) && this.#exchanges.has(id)) {
        // A frame carrying an id and no method is a response. Dropping it left its caller's
        // promise pending forever, with nothing to time it out.
        this.#exchanges.fail(id, new RPCError(INTERNAL_ERROR, 'Invalid response'))
        return null
      }
      this.#reportError(new RPCError(INVALID_REQUEST, 'Invalid message'))
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
        this.#scheduler.cancel(cancelled.params.requestId)
        return null
      }
      if (this.#routeStreamNotification != null) {
        let routed: { id: RequestID; frame: StreamFrame } | null = null
        try {
          routed = this.#routeStreamNotification(notification)
        } catch (cause) {
          this.#reportError(cause instanceof Error ? cause : new Error(String(cause)))
          return null
        }
        if (routed != null) {
          this.#exchanges.routeStreamFrame(routed.id, routed.frame)
          return null
        }
      }
      void this._handleNotification(notification)
      return null
    }

    if (validated.value.method == null) {
      // Message is a response — route to its pending exchange.
      this.#exchanges.routeResponse(id, validated.value as Response)
      return null
    }

    // Message is a request — reject it if we have begun disposing; the read loop stays live
    // during the held-response flush, but a disposing server must not start new work.
    if (this.#disposing) {
      return new RPCError(SERVER_SHUTTING_DOWN, 'Server is shutting down').toResponse(id)
    }
    // Message is a request — the scheduler owns its signal and decides when it runs.
    return this.#scheduler.schedule(id, (signal) => {
      return toPromise(() => {
        return this._handleRequest(validated.value as T['HandleRequest'], signal)
      }).then(
        (result) => {
          if (signal.aborted) {
            return null
          }
          if (isHeldResponse(result)) {
            // The response is deferred: register it, then free the concurrency slot while
            // keeping the request's identity. Nothing is written now — `#holdRequest` writes
            // when `terminal` resolves. The scheduler's own `reclaim` (on this `null`) is a
            // no-op for an id already moved out of `#running` by `detach`.
            this.#holdRequest(id, result, signal)
            this.#scheduler.detach(id)
            return null
          }
          return result == null
            ? new RPCError(INTERNAL_ERROR, 'No result').toResponse(id)
            : { jsonrpc: '2.0' as const, id, result }
        },
        (cause) => {
          if (signal.aborted) {
            // A cancelled request answers nothing, and its handler's abort rejection is the
            // expected outcome rather than an error the consumer needs to hear about.
            return null
          }
          this.#reportError(cause instanceof Error ? cause : new Error(String(cause)))
          return errorResponse(id, cause)
        },
      )
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

  /**
   * @internal Returns from `_handleRequest` to defer this request's JSON-RPC response until
   * `terminal` resolves, releasing the concurrency slot meanwhile. The resolved `terminal` is
   * used as the response `result` verbatim — `ContextRPC` does not wrap it, so a subclass must
   * hand back an already-wrapped server result. See {@link HeldResponse}.
   */
  _holdResponse<Result>(params: {
    terminal: Promise<Result>
    beforeTerminal?: () => Promise<void>
  }): HeldResponse<Result> {
    return {
      kind: 'held',
      terminal: params.terminal,
      beforeTerminal: params.beforeTerminal,
      // Created before the caller registers/awaits, so there is no window to miss it.
      written: defer<void>(),
    }
  }

  /**
   * Tracks a held request and settles the cancel-vs-terminal race. Exactly one of two outcomes
   * runs, whichever settles first (a local `done` flag guards it): `terminal` resolves — the
   * response is written (after `beforeTerminal`) — or the request's signal aborts (cancel/
   * dispose) — nothing is written. Either way `#removeHeld` is the single cleanup path removing
   * both records, and `settled` (stored alongside `signal` in `#heldRequests`) resolves once it
   * has run — `#flushHeldResponses` awaits it on disposal.
   */
  #holdRequest(id: RequestID, held: HeldResponse<unknown>, signal: AbortSignal): void {
    // Settling the deferred `_holdResponse` created is what a subclass's `complete()` awaits.
    const settled = held.written
    let done = false
    const onAbort = () => {
      if (done) {
        return
      }
      // Cancel won the race: a cancelled request answers nothing.
      done = true
      this.#removeHeld(id)
      settled.resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    this.#heldRequests.set(id, { signal, settled: settled.promise })

    held.terminal.then(
      async (result) => {
        if (done) {
          return
        }
        // Terminal won the race; claim it before the first `await` so a later cancel is ignored.
        done = true
        signal.removeEventListener('abort', onAbort)
        try {
          await held.beforeTerminal?.()
        } catch (cause) {
          this.#reportError(cause instanceof Error ? cause : new Error(String(cause)))
        }
        await this.#writeResponse({ jsonrpc: '2.0', id, result } as Response)
        this.#removeHeld(id)
        settled.resolve()
      },
      (cause) => {
        if (done) {
          return
        }
        // A rejected terminal has no result to write; surface it and clean up.
        done = true
        signal.removeEventListener('abort', onAbort)
        this.#reportError(cause instanceof Error ? cause : new Error(String(cause)))
        this.#removeHeld(id)
        settled.resolve()
      },
    )
  }

  /** The single cleanup path for a held request: removes both the RPC and scheduler records. */
  #removeHeld(id: RequestID): void {
    this.#heldRequests.delete(id)
    this.#scheduler.completeDetached(id)
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

    const timeout = options?.timeout ?? this.#defaultRequestTimeout
    if (timeout != null) {
      const timer = setTimeout(() => {
        if (!this.#exchanges.has(id)) {
          return
        }
        this.#exchanges.cancel(id, new RequestTimeoutError(`Request timed out after ${timeout}ms`))
        this.notify('cancelled', { requestId: id }).catch(() => {})
      }, timeout)
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
      onSettle: (settle) => {
        this.#continuations.clearForExchange(id, new Error(`Exchange settled (${settle.reason})`))
        handlers?.onSettle?.(settle)
      },
    })
    if (options?.signal != null) {
      this.#linkSignal(controller, options.signal)
    }
    return this.#startExchange(id, controller, method, params)
  }
}
