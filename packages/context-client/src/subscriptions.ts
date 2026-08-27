import type { ServerNotification, SubscriptionFilter } from '@mokei/context-protocol'
import { type Deferred, defer } from '@sozai/async'

/** JSON-RPC method of the `acknowledged` control frame (2026-07-28). */
export const ACKNOWLEDGED_METHOD = 'notifications/subscriptions/acknowledged'

/** Default reconnect backoff base (first attempt waits this long). */
export const DEFAULT_BACKOFF_BASE_MS = 1_000
/** Default reconnect backoff cap. */
export const DEFAULT_BACKOFF_CAP_MS = 30_000

/** Notification frame carried on a `subscriptions/listen` stream. */
export type SubscriptionNotification = ServerNotification

/**
 * How a listen stream settled. Mirrors `context-rpc`'s `StreamSettle` so the driver stays
 * decoupled from the transport: Task 16's real `openListen` maps one to the other verbatim.
 * - `result`: a terminal `subscriptions/listen` result arrived (graceful teardown).
 * - `error`: a terminal error, or a protocol/schema failure.
 * - `cancel`: the exchange was aborted locally.
 * - `closed`: the transport dropped and the exchange was ended.
 */
export type ListenSettleReason = 'result' | 'error' | 'cancel' | 'closed'
export type ListenSettle = { reason: ListenSettleReason; error?: Error }

/** Sink the driver feeds while a listen stream is live. */
export type ListenHandlers = {
  onNotification: (notification: SubscriptionNotification) => void
  onSettle: (settle: ListenSettle) => void
}

/** Handle returned by {@link OpenListen}. */
export type ListenHandle = {
  /** Terminal promise for the exchange (settles/rejects on teardown). */
  exchange: Promise<unknown>
  /** Abort the exchange (open-before-retire, timeout, cancellation). Idempotent. */
  abort: (reason?: Error) => void
}

/**
 * Injected seam that opens one `subscriptions/listen` exchange carrying `filter`, routing
 * frames to `handlers`. Task 16 backs it with `_registerStreamExchange`; tests supply a fake.
 */
export type OpenListen = (filter: SubscriptionFilter, handlers: ListenHandlers) => ListenHandle

/** Emitted before each reconnect attempt. */
export type SubscriptionRetry = { attempt: number; error: Error; retryInMs: number }

export type SubscriptionDriverParams = {
  openListen: OpenListen
  /** Base filter (listChanged opt-ins); `resourceSubscriptions` is managed by the driver. */
  filter?: SubscriptionFilter
  /** Notification sink for delivered (non-`acknowledged`) frames. */
  onNotification?: (notification: SubscriptionNotification) => void
  /** Error sink for protocol errors and non-retryable reconnect failures. */
  onError?: (error: Error) => void
  /** Called before each reconnect attempt. */
  onRetry?: (retry: SubscriptionRetry) => void
  /** Backoff base delay (ms). Defaults to {@link DEFAULT_BACKOFF_BASE_MS}. */
  backoffBaseMs?: number
  /** Backoff cap delay (ms). Defaults to {@link DEFAULT_BACKOFF_CAP_MS}. */
  backoffCapMs?: number
  /**
   * Bounds how long a candidate open (a mutation or a reconnect) waits for its `acknowledged`
   * frame before failing, applied whenever a mutation passes no `timeout` of its own. Without it
   * a silent server that opens the stream but never acks wedges the single mutation queue
   * forever — a reconnect candidate especially, since no caller supplies its timeout. Unset means
   * unbounded (the pre-hardening behavior); Task 16 wires a real value at the `ContextClient`
   * layer.
   */
  ackTimeoutMs?: number
  /** Clock seam for backoff; injected in tests. Defaults to a real timer. */
  delay?: (ms: number) => Promise<void>
}

export type MutationOptions = { uri: string; signal?: AbortSignal; timeout?: number }

/** Protocol-level failure on a listen stream (never retried). */
export class SubscriptionProtocolError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'SubscriptionProtocolError'
  }
}

/** A listen stream settled abnormally. `retryable` gates auto-reconnect. */
export class SubscriptionStreamError extends Error {
  retryable: boolean
  constructor(message: string, retryable: boolean, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'SubscriptionStreamError'
    this.retryable = retryable
  }
}

type Generation = {
  readonly number: number
  readonly filter: SubscriptionFilter
  acknowledged: boolean
  retired: boolean
  abort: (reason?: Error) => void
  readonly ack: Deferred<void>
  readonly handlers: ListenHandlers
}

const noop = () => {}

function realDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Client-side resource-subscription state machine (SEP-2575, 2026-07-28).
 *
 * Models the desired subscription filter as a single long-lived `subscriptions/listen`
 * stream that is re-opened (a new **generation**) whenever the filter changes or the stream
 * drops. Invariants:
 *
 * - **Open-before-retire.** A mutation opens a new candidate carrying the updated filter and
 *   only aborts the previous exchange once the candidate's `acknowledged` frame arrives —
 *   never a window with no active listen.
 * - **Generation gating.** Each generation closes over its number; a frame from a superseded
 *   (retired) generation is dropped.
 * - **Ack-first contract.** A candidate's first frame MUST be `acknowledged`; any other first
 *   frame is a protocol error routed via the error sink, not a silent drop.
 * - **Single queue.** Mutations (subscribe/unsubscribe) and reconnects serialize on one queue,
 *   so each settles on its own generation's ack and a reconnect never overtakes an
 *   unacknowledged candidate.
 * - **Capped backoff.** Reconnects back off from 1s, doubling, capped at 30s.
 */
export class SubscriptionDriver {
  #openListen: OpenListen
  #baseFilter: SubscriptionFilter
  #onError?: (error: Error) => void
  #onRetry?: (retry: SubscriptionRetry) => void
  #backoffBaseMs: number
  #backoffCapMs: number
  #ackTimeoutMs?: number
  #delay: (ms: number) => Promise<void>
  #listeners: Set<(notification: SubscriptionNotification) => void> = new Set()

  #desiredResources: Set<string> = new Set()
  #activeGeneration: Generation | null = null
  // The candidate currently being opened and awaited by `#openAndPromote` (a mutation or a
  // reconnect), before it is promoted to `#activeGeneration`. Tracked so `dispose()` can tear
  // down an in-flight candidate that has opened but not yet acknowledged — otherwise a silent
  // server leaves its ack promise pending forever, hanging the mutation and its queue.
  #pendingGeneration: Generation | null = null
  #generationCounter = 0
  #reconnectAttempt = 0
  #mutationTail: Promise<void> = Promise.resolve()
  #disposed = false

  constructor(params: SubscriptionDriverParams) {
    this.#openListen = params.openListen
    this.#baseFilter = params.filter ?? {}
    this.#onError = params.onError
    this.#onRetry = params.onRetry
    this.#backoffBaseMs = params.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS
    this.#backoffCapMs = params.backoffCapMs ?? DEFAULT_BACKOFF_CAP_MS
    this.#ackTimeoutMs = params.ackTimeoutMs
    this.#delay = params.delay ?? realDelay
    if (params.onNotification != null) {
      this.#listeners.add(params.onNotification)
    }
  }

  /** Add a notification listener; returns an unsubscribe function. */
  onNotification(callback: (notification: SubscriptionNotification) => void): () => void {
    this.#listeners.add(callback)
    return () => {
      this.#listeners.delete(callback)
    }
  }

  /** Subscribe to a resource URI. Resolves once the new filter is acknowledged. */
  subscribeResource(params: MutationOptions): Promise<void> {
    return this.#enqueueMutation((current) => {
      const next = new Set(current)
      next.add(params.uri)
      return next
    }, params)
  }

  /** Unsubscribe from a resource URI. Resolves once the new filter is acknowledged. */
  unsubscribeResource(params: MutationOptions): Promise<void> {
    return this.#enqueueMutation((current) => {
      const next = new Set(current)
      next.delete(params.uri)
      return next
    }, params)
  }

  /**
   * Open the base listen stream (the current desired filter with no change to the resource set),
   * resolving once it is acknowledged. Used by the consumer's auto-open after setup to establish
   * the listChanged stream before any resource subscription. Serializes on the same queue as the
   * mutations, so an auto-open never races an in-flight subscribe.
   */
  open(options?: { signal?: AbortSignal; timeout?: number }): Promise<void> {
    return this.#enqueue(() => {
      if (this.#disposed) {
        return Promise.reject(new Error('SubscriptionDriver disposed'))
      }
      return this.#openAndPromote(this.#desiredResources, options)
    })
  }

  /**
   * Stop the driver: tear down the in-flight candidate and the active stream, and suppress
   * further reconnects.
   *
   * Failing the pending candidate (if any) is what keeps disposal from hanging: its
   * `#openAndPromote` is awaiting an ack that a silent server may never send, and rejecting that
   * ack both aborts the candidate's exchange and unblocks the single mutation queue, so every
   * queued mutation behind it runs its own disposed-check and rejects rather than waiting forever.
   */
  dispose(): void {
    this.#disposed = true
    const pending = this.#pendingGeneration
    this.#pendingGeneration = null
    if (pending != null) {
      this.#failGeneration(pending, new Error('SubscriptionDriver disposed'))
    }
    const active = this.#activeGeneration
    this.#activeGeneration = null
    if (active != null && !active.retired) {
      active.retired = true
      active.abort(new Error('SubscriptionDriver disposed'))
    }
  }

  // --- internals -------------------------------------------------------------

  #enqueueMutation(
    apply: (current: Set<string>) => Set<string>,
    options: { signal?: AbortSignal; timeout?: number },
  ): Promise<void> {
    return this.#enqueue(() => {
      if (this.#disposed) {
        return Promise.reject(new Error('SubscriptionDriver disposed'))
      }
      const target = apply(this.#desiredResources)
      return this.#openAndPromote(target, options)
    })
  }

  /** Append a task to the single serialization queue and return its own settlement. */
  #enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.#mutationTail.then(task, task)
    // The tail must never reject, or later tasks would be skipped.
    this.#mutationTail = run.then(noop, noop)
    return run
  }

  #filterFor(resources: Set<string>): SubscriptionFilter {
    return { ...this.#baseFilter, resourceSubscriptions: Array.from(resources).sort() }
  }

  /**
   * Open a candidate listen for `target`, await its ack, promote it, then retire the previous
   * generation. Throws if the candidate fails before acknowledgement.
   */
  async #openAndPromote(
    target: Set<string>,
    options?: { signal?: AbortSignal; timeout?: number },
  ): Promise<void> {
    const generation = this.#allocateGeneration(this.#filterFor(target), options)
    // Publish the candidate so `dispose()` can tear it down while it is awaiting its ack.
    this.#pendingGeneration = generation
    const handle = this.#openListen(generation.filter, generation.handlers)
    // The terminal promise is surfaced through `onSettle`; guard against unhandled rejection.
    handle.exchange.catch(noop)
    generation.abort = handle.abort

    try {
      await generation.ack.promise
    } finally {
      if (this.#pendingGeneration === generation) {
        this.#pendingGeneration = null
      }
    }

    // The candidate may have been retired (transport dropped, or the driver disposed) in the
    // window between its ack resolving and this promotion running: never promote a dead stream.
    if (this.#disposed || generation.retired) {
      if (!generation.retired) {
        generation.retired = true
        generation.abort(new Error('SubscriptionDriver disposed'))
      }
      throw new SubscriptionStreamError('Candidate retired before promotion', true)
    }

    // Promotion: install the candidate, commit the desired set, then retire the old stream.
    const previous = this.#activeGeneration
    this.#activeGeneration = generation
    this.#desiredResources = target
    if (previous != null && !previous.retired) {
      previous.retired = true
      previous.abort(new Error('Superseded by a newer subscription filter'))
    }
  }

  #allocateGeneration(
    filter: SubscriptionFilter,
    options?: { signal?: AbortSignal; timeout?: number },
  ): Generation {
    const number = ++this.#generationCounter
    const ack = defer<void>()
    const generation: Generation = {
      number,
      filter,
      acknowledged: false,
      retired: false,
      abort: noop,
      ack,
      handlers: {
        onNotification: (n) => this.#onFrame(generation, n),
        onSettle: (s) => this.#onSettle(generation, s),
      },
    }

    const signal = options?.signal
    if (signal != null) {
      if (signal.aborted) {
        this.#failGeneration(generation, toError(signal.reason))
      } else {
        const onAbort = () => this.#failGeneration(generation, toError(signal.reason))
        signal.addEventListener('abort', onAbort, { once: true })
        ack.promise.then(
          () => signal.removeEventListener('abort', onAbort),
          () => signal.removeEventListener('abort', onAbort),
        )
      }
    }

    // A mutation's own `timeout` wins; otherwise the driver-wide ack timeout bounds the wait so a
    // silent server cannot wedge the queue (a reconnect candidate carries no caller timeout).
    const timeout = options?.timeout ?? this.#ackTimeoutMs
    if (timeout != null && timeout > 0) {
      const timer = setTimeout(() => {
        this.#failGeneration(
          generation,
          new Error(`Subscription acknowledgement timed out after ${timeout}ms`),
        )
      }, timeout)
      ack.promise.then(
        () => clearTimeout(timer),
        () => clearTimeout(timer),
      )
    }

    return generation
  }

  /** Fail a candidate before ack (timeout, local signal): reject, retire, tear down. */
  #failGeneration(generation: Generation, error: Error): void {
    if (generation.acknowledged || generation.retired) {
      return
    }
    generation.retired = true
    generation.ack.reject(error)
    generation.abort(error)
  }

  #onFrame(generation: Generation, notification: SubscriptionNotification): void {
    if (generation.retired) {
      // Superseded generation: drop.
      return
    }
    if (!generation.acknowledged) {
      if (isAcknowledged(notification)) {
        generation.acknowledged = true
        generation.ack.resolve()
      } else {
        // Ack-first contract: the first frame must be `acknowledged`.
        const error = new SubscriptionProtocolError(
          'First subscription frame was not an acknowledgement',
        )
        generation.retired = true
        this.#reportError(error)
        generation.ack.reject(error)
        generation.abort(error)
      }
      return
    }
    // Acknowledged, live generation: deliver (the ack control frame is never forwarded).
    this.#emit(notification)
  }

  #onSettle(generation: Generation, settle: ListenSettle): void {
    if (generation.retired) {
      // Already handled (promotion retirement, protocol error, timeout, or dispose).
      return
    }
    generation.retired = true

    if (!generation.acknowledged) {
      // Candidate died before acknowledgement.
      generation.ack.reject(settleErrorBeforeAck(settle))
      return
    }

    // A live, acknowledged stream settled.
    if (this.#activeGeneration === generation) {
      this.#activeGeneration = null
      if (settle.reason === 'closed') {
        // Transport dropped: reconnect (do not retry graceful result, cancel, or error).
        this.#scheduleReconnect(settle.error ?? new SubscriptionStreamError('Stream closed', true))
      }
    }
  }

  #scheduleReconnect(cause: Error): void {
    if (this.#disposed) {
      return
    }
    this.#reconnectAttempt += 1
    const attempt = this.#reconnectAttempt
    const retryInMs = Math.min(this.#backoffCapMs, this.#backoffBaseMs * 2 ** (attempt - 1))
    this.#onRetry?.({ attempt, error: cause, retryInMs })
    this.#delay(retryInMs).then(() => {
      if (this.#disposed) {
        return
      }
      void this.#enqueue(() => this.#runReconnect())
    }, noop)
  }

  async #runReconnect(): Promise<void> {
    if (this.#disposed) {
      return
    }
    const active = this.#activeGeneration
    if (active?.acknowledged && !active.retired) {
      // A user mutation already re-established the stream; nothing to do.
      this.#reconnectAttempt = 0
      return
    }
    try {
      await this.#openAndPromote(this.#desiredResources)
      this.#reconnectAttempt = 0
    } catch (error) {
      const err = toError(error)
      if (isRetryable(err)) {
        this.#scheduleReconnect(err)
      } else {
        // Non-retryable (protocol/schema/terminal): stop and surface.
        this.#reconnectAttempt = 0
        this.#reportError(err)
      }
    }
  }

  #emit(notification: SubscriptionNotification): void {
    for (const listener of this.#listeners) {
      try {
        listener(notification)
      } catch (error) {
        this.#reportError(toError(error))
      }
    }
  }

  #reportError(error: Error): void {
    this.#onError?.(error)
  }
}

function isAcknowledged(notification: SubscriptionNotification): boolean {
  return (notification as { method?: unknown }).method === ACKNOWLEDGED_METHOD
}

function isRetryable(error: Error): boolean {
  return error instanceof SubscriptionStreamError && error.retryable
}

function settleErrorBeforeAck(settle: ListenSettle): Error {
  if (settle.reason === 'closed') {
    return new SubscriptionStreamError('Stream closed before acknowledgement', true, {
      cause: settle.error,
    })
  }
  return (
    settle.error ??
    new SubscriptionStreamError(`Stream settled (${settle.reason}) before acknowledgement`, false)
  )
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
