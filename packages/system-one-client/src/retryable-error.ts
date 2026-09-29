import type { RetryDecision } from '@sozai/async'

import {
  SystemOneConnectionError,
  SystemOneOverloadedError,
  SystemOneRateLimitError,
} from './errors.js'

const RETRYABLE_CONNECTION_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529])

/** Decide whether a System One failure should be retried. */
export function retryableSystemOneError(error: unknown): RetryDecision {
  if (!(error instanceof SystemOneConnectionError)) return false

  const status = error.status
  if (status !== undefined && !RETRYABLE_CONNECTION_STATUSES.has(status)) return false

  if (error instanceof SystemOneRateLimitError || error instanceof SystemOneOverloadedError) {
    const retryAfterMs = error.retryAfterMs
    if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs)) {
      return { afterMs: retryAfterMs }
    }
  }

  return true
}
