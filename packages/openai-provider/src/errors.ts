import {
  type ErrorBodyFields,
  ProviderError,
  type ProviderErrorKind,
  toProviderError,
} from '@mokei/model-provider'

export const PROVIDER_NAME = 'openai'

/** The `error` object OpenAI-compatible servers put in error bodies and in stream payloads. */
export type OpenAIErrorObject = {
  message?: string
  type?: string
  code?: string | number | null
  param?: string | null
}

function errorObject(data: unknown): OpenAIErrorObject | string | undefined {
  if (typeof data === 'string') return data
  if (typeof data !== 'object' || data == null) return undefined
  const error = (data as { error?: unknown }).error
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error != null) return error as OpenAIErrorObject
  return undefined
}

function codeOf(error: OpenAIErrorObject): string | undefined {
  if (error.code != null && error.code !== '') return String(error.code)
  return error.type ?? undefined
}

/** Read an OpenAI-compatible error body (`{ error: { message, type, code } }`, or text). */
export function readErrorBody(data: unknown): ErrorBodyFields {
  const error = errorObject(data)
  if (error == null) return {}
  if (typeof error === 'string') return { message: error }
  const code = codeOf(error)
  // A spent quota answers 429 but never clears by waiting.
  const quota = code === 'insufficient_quota' || error.type === 'insufficient_quota'
  return { code, message: error.message, retryable: quota ? false : undefined }
}

/** Classify a failed OpenAI request; aborts and unknown errors are returned unchanged. */
export function toOpenAIError(error: unknown): unknown {
  return toProviderError({ provider: PROVIDER_NAME, error, readBody: readErrorBody })
}

function kindFromCode(code: string | undefined): ProviderErrorKind {
  if (code == null) return 'unknown'
  if (/context_length|too_many_tokens|context_window/i.test(code)) return 'context_length'
  if (/insufficient_quota/i.test(code)) return 'rate_limit'
  if (/rate_limit/i.test(code)) return 'rate_limit'
  if (/overloaded|capacity/i.test(code)) return 'overloaded'
  if (/server_error|internal|api_error/i.test(code)) return 'server'
  if (/auth|api_key|permission/i.test(code)) return 'auth'
  if (/invalid/i.test(code)) return 'invalid_request'
  return 'unknown'
}

/**
 * The error carried by a stream payload (`{ error: { … } }`), as a {@link ProviderError}, or
 * `undefined` when the payload is not an error.
 */
export function streamPayloadError(payload: unknown): ProviderError | undefined {
  const error = errorObject(payload)
  if (error == null || typeof payload === 'string') return undefined
  const fields: OpenAIErrorObject = typeof error === 'string' ? { message: error } : error
  const code = codeOf(fields)
  const kind = kindFromCode(code)
  return new ProviderError({
    message: `${PROVIDER_NAME} stream error: ${fields.message ?? code ?? 'unknown error'}`,
    kind,
    provider: PROVIDER_NAME,
    retryable: code === 'insufficient_quota' ? false : undefined,
    code,
    cause: payload,
  })
}
