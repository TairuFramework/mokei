import {
  type BaggageEntry,
  formatBaggage,
  formatTraceparent,
  getActiveBaggage,
  getActiveSpan,
  getActiveTraceContext,
  type TraceContext,
} from '@enkaku/otel'

/** W3C trace-context keys carried in MCP request `_meta` (SEP-414). */
export type TraceMeta = {
  traceparent?: string
  tracestate?: string
  baggage?: string
}

/** Subset of `TraceMeta` carrying only the W3C `baggage` header. */
export type BaggageMeta = {
  baggage?: string
}

/**
 * Build the SEP-414 trace `_meta` keys from a trace context and optional serialized
 * tracestate. Pure: no global reads, so it is fully unit-testable. Returns an empty
 * object when there is no context to propagate.
 */
export function traceMetaFromContext(
  context: TraceContext | undefined,
  tracestate?: string,
): TraceMeta {
  if (context == null) {
    return {}
  }
  const meta: TraceMeta = {
    traceparent: formatTraceparent(context.traceID, context.spanID, context.traceFlags),
  }
  if (tracestate != null && tracestate !== '') {
    meta.tracestate = tracestate
  }
  return meta
}

/**
 * Build the SEP-414 `baggage` `_meta` key from active-baggage entries. Pure: no global
 * reads, so it is fully unit-testable. Returns an empty object when there is nothing to
 * propagate — including when every entry is dropped by `formatBaggage` (invalid token /
 * un-encodable value), which yields an empty string.
 */
export function baggageMetaFromEntries(entries: Array<BaggageEntry> | undefined): BaggageMeta {
  if (entries == null || entries.length === 0) {
    return {}
  }
  const baggage = formatBaggage(entries)
  return baggage === '' ? {} : { baggage }
}

/**
 * Read the currently-active OpenTelemetry trace context + baggage and serialize them into
 * SEP-414 `_meta` keys. No-op (empty object) when no OTel SDK is registered, so callers
 * pay nothing when tracing is off.
 */
export function currentTraceMeta(): TraceMeta {
  const tracestate = getActiveSpan()?.spanContext().traceState?.serialize()
  return {
    ...traceMetaFromContext(getActiveTraceContext(), tracestate),
    ...baggageMetaFromEntries(getActiveBaggage()),
  }
}
