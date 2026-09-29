import {
  retryableSystemOneError,
  SystemOneConnectionError,
  SystemOneError,
  SystemOneOverloadedError,
  SystemOneRateLimitError,
} from '@mokei/system-one-client'
import { MAX_DELAY_MS, type RetryDecision } from '@sozai/async'
import type { ErrorMetadata } from '@sozai/flow-graph'

function getRetryAfterMs(error: SystemOneConnectionError): number | undefined {
  if (error instanceof SystemOneRateLimitError || error instanceof SystemOneOverloadedError) {
    return error.retryAfterMs
  }
  return undefined
}

/** Decide whether a System One failure should be retried by the flow engine. */
export function retryableDecision(error: unknown): RetryDecision {
  return retryableSystemOneError(error)
}

/** Describe a decision failure using only bounded, non-sensitive metadata. */
export function describeDecisionError(error: unknown): ErrorMetadata {
  if (
    error instanceof Error &&
    error.name === 'InvalidDecisionStateError' &&
    'code' in error &&
    error.code === 'invalid_state'
  ) {
    return { type: 'invalid_state', code: 'invalid_state' }
  }

  if (error instanceof SystemOneError) {
    const metadata: ErrorMetadata = { type: error.name }
    if (error instanceof SystemOneConnectionError && error.status !== undefined) {
      metadata.status = error.status
    }
    if (error instanceof SystemOneConnectionError) {
      const retryAfterMs = getRetryAfterMs(error)
      if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs)) {
        metadata.retryAfterMs = Math.min(MAX_DELAY_MS, Math.max(0, retryAfterMs))
      }
    }
    return metadata
  }

  return { type: error instanceof Error ? error.name : 'Error' }
}
