import type { ContextClient } from '@mokei/context-client'
import type { Tool } from '@mokei/context-protocol'
import { AuthRequiredError, type HTTPTransport, transportFailureOf } from '@mokei/http-client'
import { assertRetryPolicy, type Disposer, getRetryDelay, type RetryPolicy } from '@sozai/async'

import { ContextUnavailableError, ReconnectExhaustedError } from './errors.js'

export type ReconnectOptions = {
  /** Attempts before giving up (default 5). */
  maxAttempts?: number
  /** First backoff delay, doubled after each failed attempt (default 250 ms, full jitter). */
  initialDelayMs?: number
  /** Backoff delay cap (default 5 000 ms). */
  maxDelayMs?: number
  /** How long a call waits at the gate during a reconnect (default 10 000 ms). */
  gateTimeoutMs?: number
}

export const DEFAULT_RECONNECT_OPTIONS: Required<ReconnectOptions> = {
  maxAttempts: 5,
  initialDelayMs: 250,
  maxDelayMs: 5_000,
  gateTimeoutMs: 10_000,
}

function withDefaults(options: ReconnectOptions): Required<ReconnectOptions> {
  return {
    maxAttempts: options.maxAttempts ?? DEFAULT_RECONNECT_OPTIONS.maxAttempts,
    initialDelayMs: options.initialDelayMs ?? DEFAULT_RECONNECT_OPTIONS.initialDelayMs,
    maxDelayMs: options.maxDelayMs ?? DEFAULT_RECONNECT_OPTIONS.maxDelayMs,
    gateTimeoutMs: options.gateTimeoutMs ?? DEFAULT_RECONNECT_OPTIONS.gateTimeoutMs,
  }
}

/** Resolves an `add*Context` `reconnect` param to options, or `undefined` when reconnect is off. */
export function resolveReconnectOptions(
  reconnect: boolean | ReconnectOptions | undefined,
): Required<ReconnectOptions> | undefined {
  if (reconnect == null || reconnect === false) return undefined
  return withDefaults(reconnect === true ? {} : reconnect)
}

/** Tells the host whether the network is reachable, so a reconnect waits instead of failing. */
export type ContextConnectivity = {
  isOnline(): boolean | Promise<boolean>
  subscribe?(listener: (online: boolean) => void): () => void
}

/** One generation of a context: a client and what tears it down. */
export type HostedContextParts = {
  client: ContextClient
  disposer: Disposer
  transport?: HTTPTransport
}

/** Builds a fresh, non-interactive generation of a context. */
export type ContextFactory = () => Promise<HostedContextParts>

export type ReconnectEvents = {
  'context:reconnecting': { key: string; attempt: number; error: Error }
  'context:reconnected': { key: string; attempts: number }
  'tools:changed': { key: string }
}

export type ReconnectHooks = {
  /**
   * Swaps the candidate in when the registration is still current. Returns `null` when it is
   * not (the controller then disposes the candidate), else whether the tool list changed.
   */
  commit(
    parts: HostedContextParts,
    tools: Array<Tool>,
    generation: number,
    attempt: number,
  ): { toolsChanged: boolean } | null
  /** The reconnect gave up: emit `context:failed`, then remove the context. */
  fail(error: Error): void
  /** Detaches and disposes the lost generation. Runs synchronously inside `lose()`. */
  quiesce(error: Error): void
  emit<N extends keyof ReconnectEvents>(name: N, payload: ReconnectEvents[N]): void
}

export type ReconnectControllerParams = {
  key: string
  options: ReconnectOptions
  factory: ContextFactory
  connectivity?: ContextConnectivity
  hooks: ReconnectHooks
}

export type WaitForGateParams = {
  signal?: AbortSignal
  /** Absolute time (`Date.now()` scale) after which the wait fails. */
  deadline: number
}

type Gate = {
  promise: Promise<void>
  resolve: () => void
  reject: (error: Error) => void
}

function createGate(): Gate {
  let resolve: () => void = () => {}
  let reject: (error: Error) => void = () => {}
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  // A gate nobody waits on must not surface as an unhandled rejection.
  promise.catch(() => {})
  return { promise, resolve, reject }
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause))
}

/** An attempt failure that a retry cannot fix without a sign-in. */
function isAuthFailure(error: unknown): boolean {
  if (error instanceof AuthRequiredError) return true
  const failure = transportFailureOf(error)
  return failure?.kind === 'auth-required' || (failure?.kind === 'http' && failure.status === 401)
}

/** Resolves after `ms`, or as soon as `signal` aborts. Never rejects. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Per-registration reconnect state for one context: whether it is armed, the current
 * generation, the call gate and the attempt loop. The host owns the registration; the
 * controller tells it when to swap (`commit`), give up (`fail`) or tear down (`quiesce`).
 */
export class ReconnectController {
  #key: string
  #options: Required<ReconnectOptions>
  #policy: RetryPolicy
  #factory: ContextFactory
  #connectivity?: ContextConnectivity
  #hooks: ReconnectHooks

  #state: 'connected' | 'reconnecting' = 'connected'
  #generation = 0
  #armed = false
  #aborted = false
  #gate: Gate | undefined
  #loop: AbortController | undefined
  #candidate: HostedContextParts | undefined

  constructor(params: ReconnectControllerParams) {
    this.#key = params.key
    this.#options = withDefaults(params.options)
    this.#policy = {
      maxAttempts: this.#options.maxAttempts,
      backoff: {
        initialMs: this.#options.initialDelayMs,
        multiplier: 2,
        maxMs: this.#options.maxDelayMs,
        jitter: true,
      },
    }
    // Invalid options fail the add, not the first reconnect.
    assertRetryPolicy(this.#policy)
    this.#factory = params.factory
    this.#connectivity = params.connectivity
    this.#hooks = params.hooks
  }

  get state(): 'connected' | 'reconnecting' {
    return this.#state
  }

  get generation(): number {
    return this.#generation
  }

  get armed(): boolean {
    return this.#armed
  }

  get gateTimeoutMs(): number {
    return this.#options.gateTimeoutMs
  }

  /** Enables reconnect; called once `setup()` commits tools on the current registration. */
  arm(): void {
    if (!this.#aborted) this.#armed = true
  }

  /**
   * Reports that `generation`'s client is gone. Ignored unless armed and connected on that
   * generation (a second report for a lost generation, or one during a reconnect, is a no-op).
   */
  lose(generation: number, error: Error): void {
    if (
      !this.#armed ||
      this.#aborted ||
      this.#state !== 'connected' ||
      generation !== this.#generation
    ) {
      return
    }
    this.#generation += 1
    this.#state = 'reconnecting'
    this.#gate = createGate()
    this.#hooks.quiesce(error)
    const loop = new AbortController()
    this.#loop = loop
    void this.#run(this.#generation, error, loop.signal)
  }

  /**
   * Waits until the context is connected. Fails with the signal's reason on abort, and with
   * {@link ContextUnavailableError} on timeout (`min(gateTimeoutMs, deadline)`) or when the
   * context is removed or gives up.
   */
  async waitForGate(params: WaitForGateParams): Promise<void> {
    const { signal, deadline } = params
    if (signal?.aborted) throw signal.reason
    const gate = this.#gate
    if (this.#state === 'connected' || gate == null) return
    const timeoutMs = Math.max(0, Math.min(this.#options.gateTimeoutMs, deadline - Date.now()))
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: (() => void) | undefined
    try {
      await new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new ContextUnavailableError({
              key: this.#key,
              cause: new Error(`Context ${this.#key} did not reconnect within ${timeoutMs}ms`),
            }),
          )
        }, timeoutMs)
        if (signal != null) {
          onAbort = () => reject(signal.reason)
          signal.addEventListener('abort', onAbort, { once: true })
        }
        gate.promise.then(resolve, reject)
      })
    } finally {
      clearTimeout(timer)
      if (onAbort != null) signal?.removeEventListener('abort', onAbort)
    }
    // The abort wins a race with the gate opening.
    if (signal?.aborted) throw signal.reason
  }

  /** Stops for good: ends the loop, disposes any candidate and fails gate waiters. */
  abort(reason: Error): void {
    if (this.#aborted) return
    this.#aborted = true
    this.#armed = false
    this.#generation += 1
    this.#loop?.abort(reason)
    this.#loop = undefined
    this.#disposeCandidate(this.#candidate)
    this.#gate?.reject(new ContextUnavailableError({ key: this.#key, cause: reason }))
  }

  #owns(generation: number): boolean {
    return !this.#aborted && this.#generation === generation
  }

  #disposeCandidate(parts: HostedContextParts | undefined): void {
    if (parts == null) return
    if (this.#candidate === parts) this.#candidate = undefined
    void parts.disposer.dispose().catch(() => {})
  }

  async #run(generation: number, lossError: Error, signal: AbortSignal): Promise<void> {
    let lastError = lossError
    for (let attempt = 1; ; attempt++) {
      this.#hooks.emit('context:reconnecting', { key: this.#key, attempt, error: lastError })
      await this.#waitOnline(attempt, signal)
      if (!this.#owns(generation)) return

      let parts: HostedContextParts | undefined
      try {
        parts = await this.#factory()
        if (!this.#owns(generation)) {
          this.#disposeCandidate(parts)
          return
        }
        this.#candidate = parts
        const { tools } = await parts.client.listTools()
        if (!this.#owns(generation)) {
          this.#disposeCandidate(parts)
          return
        }
        const committed = this.#hooks.commit(parts, tools, generation, attempt)
        if (committed == null) {
          this.#disposeCandidate(parts)
          return
        }
        this.#candidate = undefined
        this.#state = 'connected'
        this.#loop = undefined
        const gate = this.#gate
        this.#gate = undefined
        gate?.resolve()
        this.#hooks.emit('context:reconnected', { key: this.#key, attempts: attempt })
        // `context:reconnected` listeners run synchronously and may have removed the context.
        if (committed.toolsChanged && this.#owns(generation)) {
          this.#hooks.emit('tools:changed', { key: this.#key })
        }
        return
      } catch (cause) {
        this.#disposeCandidate(parts)
        if (!this.#owns(generation)) return
        lastError = toError(cause)
        if (isAuthFailure(cause)) {
          this.#giveUp(lastError)
          return
        }
        if (attempt >= this.#options.maxAttempts) {
          this.#giveUp(
            new ReconnectExhaustedError({ key: this.#key, attempts: attempt, cause: lastError }),
          )
          return
        }
      }
      await pause(getRetryDelay(this.#policy, attempt), signal)
      if (!this.#owns(generation)) return
    }
  }

  #giveUp(error: Error): void {
    this.#aborted = true
    this.#armed = false
    this.#generation += 1
    this.#loop = undefined
    this.#gate?.reject(new ContextUnavailableError({ key: this.#key, cause: error }))
    this.#hooks.fail(error)
  }

  async #isOnline(): Promise<boolean> {
    if (this.#connectivity == null) return true
    try {
      return (await this.#connectivity.isOnline()) !== false
    } catch {
      return true
    }
  }

  /** Waits until connectivity reports online, without limit. Returns early on abort. */
  async #waitOnline(attempt: number, signal: AbortSignal): Promise<void> {
    const connectivity = this.#connectivity
    if (connectivity == null || signal.aborted) return
    if (connectivity.subscribe == null) {
      while (!signal.aborted && !(await this.#isOnline())) {
        await pause(getRetryDelay(this.#policy, attempt), signal)
      }
      return
    }
    let unsubscribe: (() => void) | undefined
    try {
      await new Promise<void>((resolve) => {
        const onAbort = () => resolve()
        signal.addEventListener('abort', onAbort, { once: true })
        const done = () => {
          signal.removeEventListener('abort', onAbort)
          resolve()
        }
        try {
          unsubscribe = connectivity.subscribe?.((online) => {
            if (online) done()
          })
        } catch {
          // A throwing hook counts as online.
          done()
          return
        }
        // Checked after subscribing so a change in between is not missed.
        void this.#isOnline().then((online) => {
          if (online) done()
        })
      })
    } finally {
      try {
        unsubscribe?.()
      } catch {
        // Best-effort.
      }
    }
  }
}
