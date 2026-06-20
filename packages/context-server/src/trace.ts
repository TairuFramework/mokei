import {
  type BaggageEntry,
  type Context,
  extractW3CTraceContext,
  parseBaggage,
  withActiveBaggage,
  withActiveContext,
} from '@enkaku/otel'

/** Build the active OTel context from a request's SEP-414 `_meta` trace keys. */
export function activeContextFromMeta(
  meta: Record<string, unknown> | undefined,
): Context | undefined {
  return meta == null ? undefined : extractW3CTraceContext(meta)
}

/** Parse the SEP-414 `baggage` `_meta` key into entries (empty when absent). */
export function baggageEntriesFromMeta(
  meta: Record<string, unknown> | undefined,
): Array<BaggageEntry> {
  const baggage = meta?.baggage
  return typeof baggage === 'string' ? parseBaggage(baggage) : []
}

/**
 * Run `fn` under the W3C trace context + baggage carried in a request's `_meta`
 * (SEP-414 inbound). Trace context is the outer activation; baggage layers on top
 * so it shares the same active context. No-op wrapping when `_meta` carries neither,
 * so handlers pay nothing when tracing is off.
 */
export function withRequestMeta<T>(meta: Record<string, unknown> | undefined, fn: () => T): T {
  const ctx = activeContextFromMeta(meta)
  const entries = baggageEntriesFromMeta(meta)
  const run = entries.length === 0 ? fn : () => withActiveBaggage(entries, fn)
  return ctx == null ? run() : withActiveContext(ctx, run)
}
