import type {
  OpenSpan,
  StoredSpan,
  TraceCall,
  TraceLog,
  TraceSummary,
  TracesGetResult,
} from '@mokei/host-protocol'

export function mergeSummaries(
  current: Map<string, TraceSummary>,
  incoming: Array<TraceSummary>,
): Map<string, TraceSummary> {
  const next = new Map(current)
  for (const summary of incoming) {
    const previous = next.get(summary.traceID)
    if (previous == null || summary.revision > previous.revision) next.set(summary.traceID, summary)
  }
  return next
}

export type TraceState = {
  summary?: TraceSummary
  spans: Map<string, StoredSpan | OpenSpan>
  logs: Map<string, TraceLog>
  logsTruncated: boolean
  /** Calls into this trace from other traces, by span ID. */
  calls: Map<string, TraceCall>
  callsTruncated: boolean
}

export function emptyTraceState(): TraceState {
  return {
    spans: new Map(),
    logs: new Map(),
    logsTruncated: false,
    calls: new Map(),
    callsTruncated: false,
  }
}

/** `span` as a call into `traceID` from another trace, or `undefined` when it is not one. */
export function toCall(span: StoredSpan | OpenSpan, traceID: string): TraceCall | undefined {
  if (span.traceID === traceID || span.attributes['mokei.context.trace_id'] !== traceID) return
  const ended = 'endTime' in span
  return {
    traceID: span.traceID,
    spanID: span.spanID,
    name: span.name,
    startTime: span.startTime,
    ...(ended ? { endTime: span.endTime } : {}),
    // Status code 2 is OpenTelemetry's ERROR.
    outcome: ended ? (span.status.code === 2 ? 'error' : 'ok') : null,
  }
}

export function applyCall(state: TraceState, call: TraceCall): TraceState {
  const previous = state.calls.get(call.spanID)
  if (previous?.endTime != null && call.endTime == null) return state
  const calls = new Map(state.calls)
  calls.set(call.spanID, call)
  return { ...state, calls }
}

export function applySpan(state: TraceState, span: StoredSpan | OpenSpan): TraceState {
  const previous = state.spans.get(span.spanID)
  if (previous != null && 'endTime' in previous && !('endTime' in span)) return state
  const spans = new Map(state.spans)
  spans.set(span.spanID, span)
  return { ...state, spans }
}

export function applyLog(state: TraceState, log: TraceLog): TraceState {
  if (state.logs.has(log.logID)) return state
  const logs = new Map(state.logs)
  logs.set(log.logID, log)
  return { ...state, logs }
}

export function applySnapshot(state: TraceState, result: TracesGetResult): TraceState {
  let next: TraceState = {
    ...state,
    summary:
      state.summary != null && state.summary.revision >= result.summary.revision
        ? state.summary
        : result.summary,
    logsTruncated: state.logsTruncated || result.logsTruncated,
    callsTruncated: state.callsTruncated || (result.callsTruncated ?? false),
  }
  for (const span of result.spans) next = applySpan(next, span)
  for (const log of result.logs) next = applyLog(next, log)
  for (const call of result.calls ?? []) next = applyCall(next, call)
  return next
}
