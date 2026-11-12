import type { RPCError } from '@mokei/context-rpc'

/**
 * Brand set by a local transport on an error's `data` to say the request never got a server
 * answer. A symbol key cannot be carried by JSON, so a server can never forge it.
 */
export const TRANSPORT_FAILURE: unique symbol = Symbol.for('dev.mokei/transport-failure')

export type TransportFailureKind =
  | 'network'
  | 'timeout'
  | 'auth-required'
  | 'http'
  | 'session-expired'

export type TransportFailure = { kind: TransportFailureKind; status?: number }

/** Marks `data` as a transport-level failure and returns it. */
export function brandTransportFailure<T extends Record<PropertyKey, unknown>>(
  data: T,
  failure: TransportFailure,
): T {
  ;(data as Record<PropertyKey, unknown>)[TRANSPORT_FAILURE] = failure
  return data
}

function readBrand(error: unknown): TransportFailure | undefined {
  // A brand on the error body itself (carried server errors keep their `data` untouched).
  const own = (error as Record<PropertyKey, unknown> | null | undefined)?.[TRANSPORT_FAILURE]
  if (own != null) {
    return own as TransportFailure
  }
  const data = (error as RPCError | null | undefined)?.data
  if (typeof data !== 'object' || data == null) {
    return undefined
  }
  return (data as Record<PropertyKey, unknown>)[TRANSPORT_FAILURE] as TransportFailure | undefined
}

/** Reads the transport failure brand off an error, or off its `cause` one level down. */
export function transportFailureOf(error: unknown): TransportFailure | undefined {
  const direct = readBrand(error)
  if (direct != null) {
    return direct
  }
  return error instanceof Error ? readBrand(error.cause) : undefined
}
