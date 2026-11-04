import { createHash } from 'node:crypto'
import type { StoreProvider } from '@hozon/db'
import { getLogStore } from '@hozon/store-log'
import { getTelemetryStore, type StoredSpan } from '@hozon/store-telemetry'
import type {
  OpenSpan,
  TraceCall,
  TraceLog,
  TraceSummary,
  TracesGetResult,
  TracesListParams,
  TracesListResult,
  TracesLogsParams,
  TracesLogsResult,
} from '@mokei/host-protocol'
import { SpanStatusCode } from '@opentelemetry/api'

import { decodeTraceCursor, encodeTraceCursor } from './trace-cursor.js'
import { getTraceIndexStore, pickSummaryAttributes, traceSearchText } from './trace-index.js'
import type { LocalTraceRecorder } from './trace-recorder.js'

export type TraceReader = {
  list(params: TracesListParams): Promise<TracesListResult>
  get(traceID: string): Promise<TracesGetResult | undefined>
  /** One page of a trace's logs, newest first. */
  logs(params: TracesLogsParams): Promise<TracesLogsResult>
}

type StoredLogLike = Omit<TraceLog, 'logID'>

/**
 * The log's own `dev.mokei/logID`, or a stable ID for a log recorded before the recorder stamped
 * one: its content hash and its occurrence among identical records.
 */
function legacyAwareLogID(log: StoredLogLike, counts: Map<string, number>): string {
  const property = log.properties['dev.mokei/logID']
  if (typeof property === 'string') return property
  const hash = createHash('sha256').update(JSON.stringify(log)).digest('hex')
  const occurrence = counts.get(hash) ?? 0
  counts.set(hash, occurrence + 1)
  return `legacy:${hash}:${occurrence}`
}

type TraceSpan = OpenSpan | StoredSpan

function isEnded(span: TraceSpan): span is StoredSpan {
  return 'endTime' in span && typeof span.endTime === 'number'
}

function synthesise(spans: Array<TraceSpan>): TraceSummary | undefined {
  const root =
    spans.find((span) => span.attributes['mokei.root'] === true || span.parentSpanID == null) ??
    spans[0]
  if (root == null) return undefined
  const kind = root.attributes['mokei.kind']
  const attributes = pickSummaryAttributes(root.attributes)
  return {
    traceID: root.traceID,
    rootSpanID: root.spanID,
    kind: kind === 'flow' || kind === 'mcp' || kind === 'context' ? kind : 'step',
    name: root.name,
    active: false,
    outcome: isEnded(root) ? (root.status.code === SpanStatusCode.ERROR ? 'error' : 'ok') : null,
    startTime: root.startTime,
    ...(isEnded(root) ? { endTime: root.endTime } : {}),
    attributes,
    spanCount: spans.filter((span) => isEnded(span)).length,
    errorCount: spans.filter((span) => isEnded(span) && span.status.code === SpanStatusCode.ERROR)
      .length,
    droppedCount: 0,
    revision: 0,
  }
}

function matches(summary: TraceSummary, params: TracesListParams): boolean {
  return (
    (params.kind == null || summary.kind === params.kind) &&
    (params.active == null || summary.active === params.active) &&
    (params.outcome === undefined || summary.outcome === params.outcome) &&
    (params.name == null || traceSearchText(summary).includes(params.name.toLowerCase())) &&
    (params.since == null || summary.startTime >= params.since) &&
    (params.until == null || summary.startTime <= params.until)
  )
}

export function createTraceReader(params: {
  provider: StoreProvider
  recorder: LocalTraceRecorder
  logLimit?: number
  /** Most calls into a trace `get` returns (default 200). */
  callLimit?: number
}): TraceReader {
  const { provider, recorder } = params
  const logLimit = params.logLimit ?? 1000
  if (!Number.isInteger(logLimit) || logLimit < 0)
    throw new RangeError('Trace log limit must be a non-negative integer')
  const callLimit = params.callLimit ?? 200
  if (!Number.isInteger(callLimit) || callLimit < 0)
    throw new RangeError('Trace call limit must be a non-negative integer')

  /** Calls into `traceID`, newest first: indexed ones merged with those still in the recorder. */
  async function readCalls(
    traceID: string,
  ): Promise<{ calls: Array<TraceCall>; callsTruncated: boolean }> {
    const stored = await getTraceIndexStore(provider).then((store) =>
      store.listCalls(traceID, callLimit + 1),
    )
    const bySpanID = new Map<string, TraceCall>()
    for (const call of [...recorder.callsInto(traceID), ...stored]) {
      const previous = bySpanID.get(call.spanID)
      // An ended record of the same call wins over an open one.
      if (previous == null || (previous.endTime == null && call.endTime != null)) {
        bySpanID.set(call.spanID, call)
      }
    }
    const calls = [...bySpanID.values()].sort(
      (a, b) => b.startTime - a.startTime || (a.spanID < b.spanID ? 1 : -1),
    )
    return { calls: calls.slice(0, callLimit), callsTruncated: calls.length > callLimit }
  }

  return {
    async list(params) {
      const snapshot = recorder.snapshot()
      if (!Number.isInteger(params.limit) || params.limit < 0)
        throw new RangeError('Trace list limit must be a non-negative integer')
      if (params.limit === 0) return { traces: [] }
      let boundary: [number, string] | undefined
      if (params.cursor != null) {
        boundary = decodeTraceCursor(params.cursor)
      }
      const index = await getTraceIndexStore(provider)
      // Extra rows replace stored matches invalidated by newer in-memory summaries.
      const [stored, counterparts] = await Promise.all([
        index.list({ ...params, limit: params.limit + snapshot.summaries.length + 1 }),
        Promise.all(snapshot.summaries.map((summary) => index.get(summary.traceID))),
      ])
      const summaries = new Map(stored.traces.map((summary) => [summary.traceID, summary]))
      for (const summary of [...snapshot.summaries, ...counterparts]) {
        if (summary == null) continue
        const previous = summaries.get(summary.traceID)
        if (previous == null || summary.revision > previous.revision)
          summaries.set(summary.traceID, summary)
      }
      const ordered = [...summaries.values()]
        .filter((summary) => {
          return (
            matches(summary, params) &&
            (boundary == null ||
              summary.startTime < boundary[0] ||
              (summary.startTime === boundary[0] && summary.traceID < boundary[1]))
          )
        })
        .sort(
          (a, b) =>
            b.startTime - a.startTime ||
            (a.traceID < b.traceID ? 1 : a.traceID > b.traceID ? -1 : 0),
        )
      const traces = ordered.slice(0, params.limit)
      const last = traces.at(-1)
      return {
        traces,
        ...(ordered.length > params.limit && last != null
          ? {
              cursor: encodeTraceCursor(last.startTime, last.traceID),
            }
          : {}),
      }
    },
    async get(traceID) {
      const snapshot = recorder.snapshot(traceID)
      const [storedSummary, storedSpans, storedLogs] = await Promise.all([
        getTraceIndexStore(provider).then((store) => store.get(traceID)),
        getTelemetryStore(provider).then((store) => store.getSpans(traceID)),
        getLogStore(provider).then((store) => store.getTraceLogs(traceID)),
      ])
      const bySpanID = new Map<string, TraceSpan>()
      for (const span of [...snapshot.open, ...snapshot.spans, ...storedSpans]) {
        const previous = bySpanID.get(span.spanID)
        if (previous == null || isEnded(span)) bySpanID.set(span.spanID, span)
      }
      const spans = [...bySpanID.values()].sort((a, b) => a.startTime - b.startTime)
      let summary = storedSummary
      for (const local of snapshot.summaries) {
        if (summary == null || local.revision > summary.revision) summary = local
      }
      summary ??= synthesise(spans)
      if (summary == null) return undefined
      const byLogID = new Map<string, TraceLog>(snapshot.logs.map((log) => [log.logID, log]))
      const legacyCounts = new Map<string, number>()
      for (const log of storedLogs) {
        // Pre-recorder logs have no ID; preserve identical records with stable occurrence IDs.
        const logID = legacyAwareLogID(log, legacyCounts)
        byLogID.set(logID, { ...log, logID })
      }
      const logs = [...byLogID.values()].sort((a, b) => a.timestamp - b.timestamp)
      const { calls, callsTruncated } = await readCalls(traceID)
      return {
        summary,
        spans,
        logs: logs.slice(Math.max(0, logs.length - logLimit)),
        logsTruncated: logs.length > logLimit,
        calls,
        callsTruncated,
      }
    },
    async logs(params) {
      if (!Number.isInteger(params.limit) || params.limit < 0) {
        throw new RangeError('Trace log limit must be a non-negative integer')
      }
      if (params.limit === 0) return { logs: [] }
      const page = await getLogStore(provider).then((store) =>
        store.queryLogs({
          traceID: params.traceID,
          ...(params.spanID == null ? {} : { spanID: params.spanID }),
          ...(params.before == null ? {} : { to: params.before }),
          order: 'desc',
          limit: params.limit,
          ...(params.cursor == null ? {} : { cursor: params.cursor }),
        }),
      )
      const legacyCounts = new Map<string, number>()
      const byLogID = new Map<string, TraceLog>()
      // Logs not yet flushed are the newest, so they belong only to the first page.
      if (params.cursor == null) {
        for (const log of recorder.snapshot(params.traceID).logs) {
          if (params.spanID != null && log.spanID !== params.spanID) continue
          if (params.before != null && log.timestamp > params.before) continue
          byLogID.set(log.logID, log)
        }
      }
      for (const log of page.logs) {
        const logID = legacyAwareLogID(log as StoredLogLike, legacyCounts)
        byLogID.set(logID, { ...(log as StoredLogLike), logID })
      }
      return {
        logs: [...byLogID.values()].sort((a, b) => b.timestamp - a.timestamp),
        ...(page.cursor == null ? {} : { cursor: page.cursor }),
      }
    },
  }
}
