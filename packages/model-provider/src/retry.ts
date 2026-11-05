import { isRetryableProviderError, ProviderError } from './errors.js'
import type { MessagePart, StreamChatRequest, StreamChatResponse } from './index.js'

/** When and how often a failed chat request is sent again. */
export type RetryPolicy = {
  /** Retries after the first attempt (default: 2, so 3 attempts in all) */
  retries?: number
  /** Backoff base for the first retry, doubled for each one after (default: 500ms) */
  baseDelayMs?: number
  /** Upper bound for any wait, including one a provider asked for (default: 30s) */
  maxDelayMs?: number
  /** Which errors to retry (default: {@link isRetryableProviderError}) */
  shouldRetry?: (error: unknown, attempt: number) => boolean
}

export const DEFAULT_RETRY_POLICY: Readonly<Required<Omit<RetryPolicy, 'shouldRetry'>>> = {
  retries: 2,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
}

/** One failed attempt that is about to be retried. */
export type RetryInfo = {
  /** The retry about to run: 1 for the first retry */
  attempt: number
  /** Retries the policy allows in all */
  maxRetries: number
  /** The failure of the previous attempt */
  error: unknown
  /** How long until the retry starts, in milliseconds */
  retryInMs: number
}

export type RetryDelayParams = {
  /** The retry about to run: 1 for the first retry */
  attempt: number
  error: unknown
  policy?: RetryPolicy
  /** Random source in [0, 1), for tests (default: `Math.random`) */
  random?: () => number
}

/**
 * The wait before a retry: the provider's `retryAfterMs` when it gave one, otherwise
 * exponential backoff with full jitter; capped at `maxDelayMs` either way.
 */
export function retryDelay(params: RetryDelayParams): number {
  const base = params.policy?.baseDelayMs ?? DEFAULT_RETRY_POLICY.baseDelayMs
  const cap = params.policy?.maxDelayMs ?? DEFAULT_RETRY_POLICY.maxDelayMs
  if (params.error instanceof ProviderError && params.error.retryAfterMs != null) {
    return Math.min(cap, params.error.retryAfterMs)
  }
  const ceiling = Math.min(cap, base * 2 ** (params.attempt - 1))
  return Math.floor((params.random ?? Math.random)() * ceiling)
}

export type RetryStreamChatParams<TPart, TCall> = {
  /** Starts one attempt. Called again for each retry. */
  start: () => StreamChatRequest<TPart, TCall>
  /** `false` disables retries (default: {@link DEFAULT_RETRY_POLICY}) */
  policy?: RetryPolicy | false
  /** Ends the request, including a wait between attempts */
  signal?: AbortSignal
  /** Called before each wait, with the failure that caused it */
  onRetry?: (info: RetryInfo) => void
  /** Random source in [0, 1), for tests (default: `Math.random`) */
  random?: () => number
}

type Part<TPart, TCall> = MessagePart<TPart, TCall>

function isOutputPart(part: Part<unknown, unknown>): boolean {
  return part.type === 'text-delta' || part.type === 'reasoning-delta' || part.type === 'tool-call'
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('This operation was aborted', 'AbortError')
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortReason(signal))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortReason(signal))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

type Attempt<TPart, TCall> = {
  /** Parts read so far, replayed to the consumer when the attempt is used */
  buffered: Array<Part<TPart, TCall>>
  /** The rest of the stream, or `null` when it already ended or never opened */
  reader: ReadableStreamDefaultReader<Part<TPart, TCall>> | null
  /** Set when the attempt failed before producing output */
  error?: { value: unknown }
}

/**
 * Run a streaming chat request, sending it again when it fails before producing output.
 *
 * An attempt fails when its request rejects, or when its stream yields an `error` part or
 * throws before the first text, reasoning or tool-call part. Once an output part has arrived the
 * stream is committed and nothing is retried: the consumer has seen output, and replaying the
 * request would duplicate it. Parts read while deciding (such as `unsupported`) are replayed
 * to the consumer in order.
 *
 * Only errors the policy's `shouldRetry` accepts are retried. A failure that is not retried
 * surfaces as it would without this wrapper: a rejected request, or an `error` part.
 */
export function retryStreamChat<TPart, TCall>(
  params: RetryStreamChatParams<TPart, TCall>,
): StreamChatRequest<TPart, TCall> {
  const policy = params.policy === false ? { retries: 0 } : (params.policy ?? {})
  const maxRetries = Math.max(0, policy.retries ?? DEFAULT_RETRY_POLICY.retries)
  const shouldRetry = policy.shouldRetry ?? ((error: unknown) => isRetryableProviderError(error))

  const controller = new AbortController()
  const signal =
    params.signal == null ? controller.signal : AbortSignal.any([params.signal, controller.signal])
  let current: StreamChatRequest<TPart, TCall> | null = null
  signal.addEventListener('abort', () => current?.abort(signal.reason), { once: true })

  async function attempt(): Promise<Attempt<TPart, TCall>> {
    const request = params.start()
    current = request
    if (signal.aborted) request.abort(signal.reason)
    let stream: StreamChatResponse<TPart, TCall>
    try {
      stream = await request
    } catch (error) {
      return { buffered: [], reader: null, error: { value: error } }
    }
    const reader = stream.getReader()
    const buffered: Array<Part<TPart, TCall>> = []
    while (true) {
      let result: ReadableStreamReadResult<Part<TPart, TCall>>
      try {
        result = await reader.read()
      } catch (error) {
        return { buffered: [], reader: null, error: { value: error } }
      }
      if (result.done) return { buffered, reader: null }
      const part = result.value
      buffered.push(part)
      if (part.type === 'error') {
        // The reader stays open: if this error is not retried, the consumer still gets the rest.
        return { buffered, reader, error: { value: part.error } }
      }
      if (isOutputPart(part) || part.type === 'done') return { buffered, reader }
    }
  }

  async function run(): Promise<StreamChatResponse<TPart, TCall>> {
    for (let retry = 0; ; retry++) {
      const outcome = await attempt()
      if (outcome.error == null) return toStream(outcome)
      const error = outcome.error.value
      if (signal.aborted) {
        void outcome.reader?.cancel().catch(() => {})
        throw abortReason(signal)
      }
      if (retry >= maxRetries || !shouldRetry(error, retry + 1)) {
        // Not retried: surface the failure the way the provider did, as a part or a rejection.
        if (outcome.buffered.length > 0) return toStream(outcome)
        throw error
      }
      // Release the failed attempt before waiting.
      void outcome.reader?.cancel().catch(() => {})
      const retryInMs = retryDelay({ attempt: retry + 1, error, policy, random: params.random })
      params.onRetry?.({ attempt: retry + 1, maxRetries, error, retryInMs })
      await wait(retryInMs, signal)
    }
  }

  function toStream({ buffered, reader }: Attempt<TPart, TCall>) {
    return new ReadableStream<Part<TPart, TCall>>(
      {
        async pull(stream) {
          const next = buffered.shift()
          if (next !== undefined) {
            stream.enqueue(next)
            return
          }
          if (reader == null) {
            stream.close()
            return
          }
          const result = await reader.read()
          if (result.done) {
            stream.close()
          } else {
            stream.enqueue(result.value)
          }
        },
        cancel(reason) {
          return reader?.cancel(reason)
        },
      },
      { highWaterMark: 0 },
    )
  }

  return Object.assign(run(), {
    abort: (reason?: unknown) => controller.abort(reason),
    signal,
  }) as StreamChatRequest<TPart, TCall>
}
