import type { FetchLike } from './transport.js'

/**
 * Internal `RequestInit` field carrying a time-to-headers budget in milliseconds. The transport
 * tags its MCP POST and schema-refresh requests; the base fetch applies the timer per network
 * call, so an interactive sign-in inside a `fetchMiddleware` is never under it. A middleware keeps
 * the tag by spreading `init`.
 */
export const REQUEST_TIMEOUT: unique symbol = Symbol('dev.mokei/request-timeout')

export type TimedRequestInit = RequestInit & { [REQUEST_TIMEOUT]?: number }

/** Thrown by the base fetch when a tagged request gets no response headers in time. */
export class RequestTimeoutError extends Error {
  #timeout: number

  constructor(timeout: number) {
    super(`Request timed out after ${timeout}ms`)
    this.name = 'RequestTimeoutError'
    this.#timeout = timeout
  }

  /** The budget that elapsed, in milliseconds. */
  get timeout(): number {
    return this.#timeout
  }
}

/** The timeout tag of `init`, if any. */
export function requestTimeoutOf(init: RequestInit | undefined): number | undefined {
  return (init as TimedRequestInit | undefined)?.[REQUEST_TIMEOUT]
}

/**
 * A signal aborted by any of `signals`, or with `timeoutReason` once `timeoutMs` elapses.
 * `clearTimer` stops only the timer: the link to `signals` stays, so a later cancellation still
 * reaches a streaming body. Built on `AbortController` and `setTimeout` alone (no
 * `AbortSignal.any` / `AbortSignal.timeout`, which React Native runtimes may lack).
 */
export function linkSignals(
  signals: Array<AbortSignal | null | undefined>,
  timeoutMs?: number,
  timeoutReason?: unknown,
): { signal: AbortSignal; clearTimer: () => void } {
  const controller = new AbortController()
  for (const signal of signals) {
    if (signal == null) continue
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  if (timeoutMs != null && !controller.signal.aborted) {
    timer = setTimeout(() => controller.abort(timeoutReason), timeoutMs)
  }
  return { signal: controller.signal, clearTimer: () => clearTimeout(timer) }
}

/**
 * Wraps `fetch` so a request tagged with {@link REQUEST_TIMEOUT} fails with
 * {@link RequestTimeoutError} when headers take longer than the tag. Untagged requests pass
 * through unchanged.
 */
export function withRequestTimeout(fetch: FetchLike): FetchLike {
  return async (url, init) => {
    const timeout = requestTimeoutOf(init)
    if (timeout == null) return fetch(url, init)
    const { [REQUEST_TIMEOUT]: _tag, ...rest } = init as TimedRequestInit
    const timeoutError = new RequestTimeoutError(timeout)
    const linked = linkSignals([rest.signal], timeout, timeoutError)
    try {
      return await fetch(url, { ...rest, signal: linked.signal })
    } catch (error) {
      if (linked.signal.reason === timeoutError) throw timeoutError
      throw error
    } finally {
      linked.clearTimer()
    }
  }
}
