import {
  type ErrorBodyFields,
  isContextLengthMessage,
  ProviderError,
  toProviderError,
} from '@mokei/model-provider'

export const PROVIDER_NAME = 'ollama'

function errorMessage(data: unknown): string | undefined {
  if (typeof data === 'string') return data
  if (typeof data !== 'object' || data == null) return undefined
  const error = (data as { error?: unknown }).error
  return typeof error === 'string' ? error : undefined
}

/** Read an Ollama error body (`{ error: "message" }`, or text). */
export function readErrorBody(data: unknown): ErrorBodyFields {
  const message = errorMessage(data)
  return message == null ? {} : { message }
}

/** Classify a failed Ollama request; aborts and unknown errors are returned unchanged. */
export function toOllamaError(error: unknown): unknown {
  return toProviderError({ provider: PROVIDER_NAME, error, readBody: readErrorBody })
}

/**
 * The error carried by a streamed line (`{ "error": "…" }`), or `undefined` when the line is
 * not an error. Ollama gives no code, so only a context overflow is told apart; anything else
 * is `unknown` and not retried.
 */
export function streamLineError(line: unknown): ProviderError | undefined {
  if (typeof line !== 'object' || line == null) return undefined
  const message = errorMessage(line)
  if (message == null) return undefined
  return new ProviderError({
    message: `${PROVIDER_NAME} stream error: ${message}`,
    kind: isContextLengthMessage(message) ? 'context_length' : 'unknown',
    provider: PROVIDER_NAME,
    cause: line,
  })
}
