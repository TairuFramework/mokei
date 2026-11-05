import { ProviderError, type ProviderErrorKind } from '@mokei/model-provider'
import type { AgentRetryEvent } from '@mokei/session'

const KIND_LABEL: Record<ProviderErrorKind, string> = {
  rate_limit: 'rate limited',
  overloaded: 'provider overloaded',
  server: 'provider error',
  network: 'connection failed',
  timeout: 'request timed out',
  auth: 'authentication failed',
  invalid_request: 'request rejected',
  context_length: 'conversation too long',
  unknown: 'provider error',
}

const KIND_HINT: Partial<Record<ProviderErrorKind, string>> = {
  rate_limit: 'wait a moment and try again',
  overloaded: 'try again shortly',
  auth: 'check the API key or credentials for this provider',
  context_length: 'start a new conversation or shorten the history',
  network: 'check the endpoint and your connection',
  timeout: 'try again, or raise the provider timeout',
}

/** One-line description of a provider failure, with a hint for what to do about it. */
export function describeProviderError(error: ProviderError): string {
  const status = error.status != null ? ` (${error.status})` : ''
  const hint = KIND_HINT[error.kind]
  return `${KIND_LABEL[error.kind]}${status}: ${error.message}${hint ? ` — ${hint}` : ''}`
}

function formatDelay(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  return `${Math.round(ms / 100) / 10}s`
}

/** The transcript line for a retry, such as `rate limited — retrying in 4s (1/2)`. */
export function retryNotice(event: AgentRetryEvent): string {
  const reason =
    event.error instanceof ProviderError
      ? `${KIND_LABEL[event.error.kind]}${event.error.status != null ? ` (${event.error.status})` : ''}`
      : event.error instanceof Error
        ? event.error.message
        : 'request failed'
  return `${reason} — retrying in ${formatDelay(event.retryInMs)} (${event.attempt}/${event.maxRetries})`
}
