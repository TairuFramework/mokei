import type { InputRequest, InputRequiredResult, InputResponse } from '@mokei/context-protocol'
import { isInputRequiredResult } from '@mokei/context-protocol'

export type { InputRequiredResult }
export { isInputRequiredResult }

/**
 * The multi round-trip driver (MRTR, SEP-2322).
 *
 * MRTR is a request-level retry loop, not a stream: a server answers `tools/call`, `prompts/get`
 * or `resources/read` with a terminal `input_required` result, the client fulfils the embedded
 * requests, and the client re-sends the *same* request with `inputResponses` and the echoed
 * `requestState`. Nothing here touches the RPC layer's exchange registry — every round is an
 * ordinary request.
 *
 * Every effect is injected. The module has no transport, no clock and no handler table of its own,
 * which is what lets the loop, the cap and the pacing be tested on their own.
 */

/** Default rounds a single call may take before the flow fails. Matches SDK v2's own default. */
export const DEFAULT_MAX_ROUNDS = 10

/**
 * The methods SEP-2322 allows to suspend. Everything else must answer terminally.
 *
 * A client-side copy of `@mokei/context-server`'s own `MRTR_METHODS`, not an import of it: the
 * client package must not depend on the server package, and this table is small and pinned to the
 * specification rather than to either package's internals, so the duplication is cheap and the
 * two cannot drift without a spec change prompting both.
 */
export const MRTR_METHODS: ReadonlySet<string> = new Set([
  'tools/call',
  'prompts/get',
  'resources/read',
])

/**
 * Pacing applied before retrying a `requestState`-only leg: one carrying no embedded requests, so
 * no handler work slows the loop down naturally. A server sends these to shed load or to report
 * that it is still working, and without the delay the client would spin against it.
 */
export const REQUEST_STATE_ONLY_PACING_MS = 250

/** The two fields a retry adds to the original request's params. */
export type InputRequiredRetryParams = {
  inputResponses?: Record<string, InputResponse>
  requestState?: string
}

/** Thrown when a single call still needs input after its round cap is spent. */
export class InputRequiredRoundsExceededError extends Error {
  method: string
  rounds: number
  lastResult: InputRequiredResult

  constructor(method: string, rounds: number, lastResult: InputRequiredResult) {
    super(`Multi round-trip request "${method}" still required input after ${rounds} rounds`)
    this.name = 'InputRequiredRoundsExceededError'
    this.method = method
    this.rounds = rounds
    this.lastResult = lastResult
  }
}

/** Thrown when `maxTotalTimeout` is spent before the flow reaches a complete result. */
export class InputRequiredTotalTimeoutError extends Error {
  constructor(maxTotalTimeout: number, elapsed: number) {
    super(
      `Multi round-trip request exceeded its maximum total timeout of ${maxTotalTimeout}ms after ${elapsed}ms`,
    )
    this.name = 'InputRequiredTotalTimeoutError'
  }
}

export type RunInputRequiredFlowParams = {
  /** The originating request's method, used only in error messages. */
  method: string
  /** The suspension the first wire leg came back with. */
  first: Omit<InputRequiredResult, 'resultType'>
  maxRounds: number
  /** Per-leg timeout, passed through to `retry` unchanged. */
  timeout?: number
  /** Budget for the whole flow, including the leg that produced `first`. */
  maxTotalTimeout?: number
  /** When the originating request was issued. Defaults to the moment the flow starts. */
  startedAt?: number
  signal?: AbortSignal
  /** Fulfils one embedded request. Rejecting fails the whole flow. */
  dispatch: (key: string, request: InputRequest, signal: AbortSignal) => Promise<InputResponse>
  /** Re-sends the originating request. Must return the raw result, suspended or complete. */
  retry: (params: InputRequiredRetryParams, timeout?: number) => Promise<unknown>
  /** Injected for tests; defaults to a real, abortable delay. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Injected for tests; defaults to `Date.now`. */
  now?: () => number
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason as Error)
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason as Error)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * A per-round abort linked to the caller's signal. Sibling dispatches share it, so the first
 * failure cancels the others rather than leaving a sampling call running for a round whose result
 * is already thrown away.
 */
function linkedRoundAbort(outer?: AbortSignal): {
  signal: AbortSignal
  abort: (reason?: unknown) => void
  dispose: () => void
} {
  const controller = new AbortController()
  const onOuterAbort = () => controller.abort(outer?.reason)
  outer?.addEventListener('abort', onOuterAbort, { once: true })
  if (outer?.aborted) {
    controller.abort(outer.reason)
  }
  return {
    signal: controller.signal,
    abort: (reason?: unknown) => controller.abort(reason),
    dispose: () => outer?.removeEventListener('abort', onOuterAbort),
  }
}

export async function runInputRequiredFlow(params: RunInputRequiredFlowParams): Promise<unknown> {
  const { method, maxRounds, timeout, maxTotalTimeout, signal, dispatch, retry } = params
  const sleep = params.sleep ?? defaultSleep
  const now = params.now ?? Date.now
  const startedAt = params.startedAt ?? now()

  let payload: Omit<InputRequiredResult, 'resultType'> = params.first
  let round = 0

  while (true) {
    round += 1
    if (round > maxRounds) {
      // `payload` is `Omit<InputRequiredResult, 'resultType'>`, so both its fields are optional at
      // the type level — but it always originates from a wire-validated `InputRequiredResult`
      // (`params.first`, or a prior round's checked `result`), so the schema's at-least-one
      // invariant already holds here at runtime.
      throw new InputRequiredRoundsExceededError(method, maxRounds, {
        resultType: 'input_required',
        ...payload,
      } as InputRequiredResult)
    }

    const entries = Object.entries(payload.inputRequests ?? {})
    let inputResponses: Record<string, InputResponse> | undefined
    if (entries.length > 0) {
      const roundAbort = linkedRoundAbort(signal)
      try {
        const fulfilled = await Promise.all(
          entries.map(async ([key, request]) => {
            try {
              return [key, await dispatch(key, request, roundAbort.signal)] as const
            } catch (cause) {
              roundAbort.abort(cause)
              throw cause
            }
          }),
        )
        inputResponses = Object.fromEntries(fulfilled)
      } finally {
        roundAbort.dispose()
      }
    } else {
      // Nothing to fulfil, so nothing paces the loop but this.
      await sleep(REQUEST_STATE_ONLY_PACING_MS, signal)
    }

    let legTimeout = timeout
    if (maxTotalTimeout != null) {
      const elapsed = now() - startedAt
      const remaining = maxTotalTimeout - elapsed
      if (remaining <= 0) {
        throw new InputRequiredTotalTimeoutError(maxTotalTimeout, elapsed)
      }
      legTimeout = timeout == null ? remaining : Math.min(timeout, remaining)
    }

    const result = await retry(
      {
        ...(inputResponses != null && { inputResponses }),
        ...(payload.requestState != null && { requestState: payload.requestState }),
      },
      legTimeout,
    )
    if (!isInputRequiredResult(result)) {
      return result
    }
    payload = {
      ...(result.inputRequests != null && { inputRequests: result.inputRequests }),
      ...(result.requestState != null && { requestState: result.requestState }),
    }
  }
}
