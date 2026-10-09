import type {
  OpenSpan,
  StoredSpan,
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
  }
  for (const span of result.spans) next = applySpan(next, span)
  for (const log of result.logs) next = applyLog(next, log)
  return next
}
