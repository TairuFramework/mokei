import {
  type ErrorBodyFields,
  isContextLengthMessage,
  ProviderError,
  type ProviderErrorKind,
  toProviderError,
} from '@mokei/model-provider'

export const PROVIDER_NAME = 'anthropic'

/** The `error` object of an Anthropic error body or stream `error` event. */
export type AnthropicErrorObject = { type?: string; message?: string }

/**
 * Kinds for Anthropic error types. `invalid_request_error` is left to the status and message,
 * so a "prompt is too long" error is still classified as `context_length`.
 */
const KIND_BY_TYPE: Record<string, ProviderErrorKind> = {
  rate_limit_error: 'rate_limit',
  overloaded_error: 'overloaded',
  api_error: 'server',
  authentication_error: 'auth',
  permission_error: 'auth',
  not_found_error: 'invalid_request',
  request_too_large: 'invalid_request',
  timeout_error: 'timeout',
}

function errorObject(data: unknown): AnthropicErrorObject | undefined {
  if (typeof data !== 'object' || data == null) return undefined
  const error = (data as { error?: unknown }).error
  return typeof error === 'object' && error != null ? (error as AnthropicErrorObject) : undefined
}

/** Read an Anthropic error body (`{ type: 'error', error: { type, message } }`, or text). */
export function readErrorBody(data: unknown): ErrorBodyFields {
  if (typeof data === 'string') return { message: data }
  const error = errorObject(data)
  if (error == null) return {}
  return {
    code: error.type,
    message: error.message,
    kind: error.type == null ? undefined : KIND_BY_TYPE[error.type],
  }
}

/** Classify a failed Anthropic request; aborts and unknown errors are returned unchanged. */
export function toAnthropicError(error: unknown): unknown {
  return toProviderError({ provider: PROVIDER_NAME, error, readBody: readErrorBody })
}

/** The {@link ProviderError} for a stream `error` event. */
export function streamEventError(error: AnthropicErrorObject, cause: unknown): ProviderError {
  const kind =
    (error.type == null ? undefined : KIND_BY_TYPE[error.type]) ??
    (isContextLengthMessage(error.message) ? 'context_length' : 'unknown')
  return new ProviderError({
    message: `${error.type ?? 'error'}: ${error.message ?? 'unknown error'}`,
    kind,
    provider: PROVIDER_NAME,
    code: error.type,
    cause,
  })
}
