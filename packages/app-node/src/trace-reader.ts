import { createHash } from 'node:crypto'
import type { StoreProvider } from '@hozon/db'
import { getLogStore } from '@hozon/store-log'
import { getTelemetryStore, type StoredSpan } from '@hozon/store-telemetry'
import type {
  OpenSpan,
  TraceLog,
  TraceSummary,
  TracesGetResult,
  TracesListParams,
  TracesListResult,
} from '@mokei/host-protocol'
import { SpanStatusCode } from '@opentelemetry/api'

import { getTraceIndexStore } from './trace-index.js'
import type { LocalTraceRecorder } from './trace-recorder.js'

export type TraceReader = {
  list(params: TracesListParams): Promise<TracesListResult>
  get(traceID: string): Promise<TracesGetResult | undefined>
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
  const attributes: TraceSummary['attributes'] = {}
  for (const key of ['run.id', 'flow.id', 'mokei.context.id'] as const) {
    const value = root.attributes[key]
    if (typeof value === 'string') attributes[key] = value
  }
  const label = root.attributes['run.label']
  if (typeof label === 'string') attributes.label = label
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
    (params.name == null || summary.name.toLowerCase().includes(params.name.toLowerCase())) &&
    (params.since == null || summary.startTime >= params.since) &&
    (params.until == null || summary.startTime <= params.until)
  )
}

export function createTraceReader(params: {
  provider: StoreProvider
  recorder: LocalTraceRecorder
  logLimit?: number
}): TraceReader {
  const { provider, recorder } = params
  const logLimit = params.logLimit ?? 1000
  if (!Number.isInteger(logLimit) || logLimit < 0)
    throw new RangeError('Trace log limit must be a non-negative integer')
  return {
    async list(params) {
      const snapshot = recorder.snapshot()
      if (!Number.isInteger(params.limit) || params.limit < 0)
        throw new RangeError('Trace list limit must be a non-negative integer')
      if (params.limit === 0) return { traces: [] }
      let boundary: [number, string] | undefined
      if (params.cursor != null) {
        const cursor: unknown = JSON.parse(Buffer.from(params.cursor, 'base64').toString('utf8'))
        if (
          !Array.isArray(cursor) ||
          cursor.length !== 2 ||
          typeof cursor[0] !== 'number' ||
          typeof cursor[1] !== 'string'
        )
          throw new Error('Invalid trace list cursor')
        boundary = cursor as [number, string]
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
              cursor: Buffer.from(JSON.stringify([last.startTime, last.traceID])).toString(
                'base64',
              ),
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
        const property = log.properties['dev.mokei/logID']
        let logID: string
        if (typeof property === 'string') {
          logID = property
        } else {
          // Pre-recorder logs have no ID; preserve identical records with stable occurrence IDs.
          const hash = createHash('sha256').update(JSON.stringify(log)).digest('hex')
          const occurrence = legacyCounts.get(hash) ?? 0
          legacyCounts.set(hash, occurrence + 1)
          logID = `legacy:${hash}:${occurrence}`
        }
        byLogID.set(logID, { ...log, logID })
      }
      const logs = [...byLogID.values()].sort((a, b) => a.timestamp - b.timestamp)
      return {
        summary,
        spans,
        logs: logs.slice(Math.max(0, logs.length - logLimit)),
        logsTruncated: logs.length > logLimit,
      }
    },
  }
}
