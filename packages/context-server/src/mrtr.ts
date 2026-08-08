import type { InputRequest, InputResponse } from '@mokei/context-protocol'

/**
 * Server-side multi round-trip request support (MRTR, SEP-2322).
 *
 * A `2026-07-28` handler suspends by *returning* an `input_required` result and is re-invoked when
 * the client re-sends the same request carrying `inputResponses` and the echoed `requestState`.
 * This module owns the two halves of that seam the server must run before and after the handler:
 * lifting the retry fields off the wire params, and resolving the opaque state through the
 * configured hooks.
 */

/**
 * Hooks protecting the integrity of `requestState`.
 *
 * `requestState` round-trips through the client and re-enters the server as attacker-controlled
 * input. SEP-2322 requires a server that lets it influence authorization, resource access or
 * business logic to protect its integrity and to reject state that fails verification. mokei ships
 * no crypto and imposes no key management: with no `verify`, the raw string reaches the handler and
 * is untrusted; with one, the seam refuses state the hook rejects before the handler runs.
 */
export type RequestStateHooks = {
  /** Encodes a handler's payload into the opaque string sent to the client. */
  mint?: (payload: unknown) => string
  /** Decodes and authenticates a returning string. Throwing rejects the request. */
  verify?: (raw: string) => unknown
}

export type LiftedRetryParams = {
  inputResponses?: Record<string, InputResponse>
  requestState?: string
}

/**
 * Splits the MRTR retry fields out of a request's params, so a handler sees exactly the shape it
 * sees on `2025-11-25`.
 *
 * Returns the original reference untouched when there is nothing to lift — the common case is a
 * round-one request, and copying every params object for it would be waste.
 */
export function liftRetryParams(params: unknown): { params: unknown; lifted: LiftedRetryParams } {
  if (params == null || typeof params !== 'object') {
    return { params, lifted: {} }
  }
  const record = params as Record<string, unknown>
  const hasResponses = 'inputResponses' in record
  const hasState = 'requestState' in record
  if (!hasResponses && !hasState) {
    return { params, lifted: {} }
  }
  const { inputResponses, requestState, ...rest } = record
  return {
    params: rest,
    lifted: {
      ...(hasResponses && { inputResponses: inputResponses as Record<string, InputResponse> }),
      ...(hasState && { requestState: requestState as string }),
    },
  }
}

/** Runs the `verify` hook over a returning `requestState`, or passes the raw string through. */
export function resolveRequestState(
  raw: string | undefined,
  hooks: RequestStateHooks | undefined,
): unknown {
  if (raw === undefined) {
    return undefined
  }
  return hooks?.verify == null ? raw : hooks.verify(raw)
}

/** The methods SEP-2322 allows to suspend. Everything else must answer terminally. */
export const MRTR_METHODS: ReadonlySet<string> = new Set([
  'tools/call',
  'prompts/get',
  'resources/read',
])

export type InputRequiredResult = {
  resultType: 'input_required'
  inputRequests?: Record<string, InputRequest>
  requestState?: string
}

/**
 * Builds the suspended result a handler returns to ask the client for input (MRTR, SEP-2322).
 *
 * Enforces SEP-2322's at-least-one rule here rather than letting the wire validator catch it: a
 * suspension that asks for nothing and carries no state tells the client neither what to do nor
 * what to echo, and failing at the call site names the handler that built it.
 */
export function inputRequired(params: {
  inputRequests?: Record<string, InputRequest>
  requestState?: string
}): InputRequiredResult {
  const hasRequests = params.inputRequests != null && Object.keys(params.inputRequests).length > 0
  if (!hasRequests && params.requestState === undefined) {
    throw new Error(
      'An input_required result must carry at least one of inputRequests or requestState',
    )
  }
  return {
    resultType: 'input_required',
    ...(hasRequests && { inputRequests: params.inputRequests }),
    ...(params.requestState !== undefined && { requestState: params.requestState }),
  }
}

/** A discriminator check over a handler's return value. */
export function isInputRequiredResult(value: unknown): value is InputRequiredResult {
  return (
    value != null &&
    typeof value === 'object' &&
    (value as { resultType?: unknown }).resultType === 'input_required'
  )
}
