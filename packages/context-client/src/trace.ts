import {
  formatTraceparent,
  getActiveSpan,
  getActiveTraceContext,
  type TraceContext,
} from '@enkaku/otel'

/** W3C trace-context keys carried in MCP request `_meta` (SEP-414). */
export type TraceMeta = {
  traceparent?: string
  tracestate?: string
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
 * Read the currently-active OpenTelemetry trace context and serialize it into SEP-414
 * `_meta` keys. No-op (empty object) when no OTel SDK is registered, so callers pay
 * nothing when tracing is off.
 */
export function currentTraceMeta(): TraceMeta {
  const tracestate = getActiveSpan()?.spanContext().traceState?.serialize()
  return traceMetaFromContext(getActiveTraceContext(), tracestate)
}
