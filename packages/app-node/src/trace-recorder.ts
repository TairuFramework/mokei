import type { StoreProvider } from '@hozon/db'
import { getLogStore } from '@hozon/store-log'
import type { StoredSpan } from '@hozon/store-telemetry'
import { getTelemetryStore } from '@hozon/store-telemetry'
import type { OpenSpan, TraceLog, TraceSummary, TracingInfo } from '@mokei/host-protocol'
import type { Context } from '@opentelemetry/api'
import { SpanStatusCode } from '@opentelemetry/api'
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-base'
import { toJSONValue } from '@sozai/json'
import { getReporter } from '@sozai/log'

import { toOpenSpan, toStoredSpan } from './stored-span.js'
import { getTraceIndexStore } from './trace-index.js'

export type TraceRecorderEvent =
  | { type: 'span:start'; data: OpenSpan }
  | { type: 'span:end'; data: StoredSpan }
  | { type: 'log'; data: TraceLog }
  | { type: 'trace:summary'; data: TraceSummary }

export type TraceRecorderParams = {
  provider: StoreProvider
  onEvent?: (event: TraceRecorderEvent) => void
  queueLimit?: number
  flushIntervalMs?: number
  flushBatchSize?: number
  retryDelaysMs?: Array<number>
  dirtySummaryLimit?: number
  reportError?: (message: string, error: unknown) => void
}

export type RecorderSnapshot = {
  open: Array<OpenSpan>
  spans: Array<StoredSpan>
  logs: Array<TraceLog>
  summaries: Array<TraceSummary>
}

// Logs share the queue and transaction with spans.
export type TraceQueueEntry = { type: 'span'; data: StoredSpan } | { type: 'log'; data: TraceLog }

function isRoot(span: ReadableSpan): boolean {
  return span.attributes['mokei.root'] === true || span.parentSpanContext == null
}

function createSummary(span: OpenSpan): TraceSummary {
  const kind = span.attributes['mokei.kind']
  const attributes: TraceSummary['attributes'] = {}
  for (const key of ['run.id', 'flow.id', 'mokei.context.id'] as const) {
    const value = span.attributes[key]
    if (typeof value === 'string') attributes[key] = value
  }
  const label = span.attributes['run.label']
  if (typeof label === 'string') attributes.label = label
  return {
    traceID: span.traceID,
    rootSpanID: span.spanID,
    kind: kind === 'flow' || kind === 'mcp' || kind === 'context' ? kind : 'step',
    name: span.name,
    active: false,
    outcome: null,
    startTime: span.startTime,
    attributes,
    spanCount: 0,
    errorCount: 0,
    droppedCount: 0,
    revision: 0,
  }
}

type PendingSummary = {
  summary: TraceSummary
  rootChanged: boolean
  retryTimer?: ReturnType<typeof setTimeout>
}

export class LocalTraceRecorder implements SpanProcessor {
  #provider: StoreProvider
  #onEvent?: TraceRecorderParams['onEvent']
  #reportError: NonNullable<TraceRecorderParams['reportError']>
  #queueLimit: number
  #flushBatchSize: number
  #retryDelaysMs: Array<number>
  #dirtySummaryLimit: number
  #timer: ReturnType<typeof setInterval>
  #open = new Map<string, OpenSpan>()
  #queue: Array<TraceQueueEntry> = []
  #summaries = new Map<string, TraceSummary>()
  #dirty = new Set<string>()
  #pending = new Map<string, PendingSummary>()
  #flush?: Promise<void>
  #shutdown?: Promise<void>
  #stopped = false
  #droppedCount = 0
  #lostSummaryCount = 0

  constructor(params: TraceRecorderParams) {
    this.#provider = params.provider
    this.#onEvent = params.onEvent
    this.#reportError =
      params.reportError ?? getReporter(['mokei', 'trace-recorder'], '@mokei/app-node')
    this.#queueLimit = params.queueLimit ?? 10000
    this.#flushBatchSize = params.flushBatchSize ?? 200
    this.#retryDelaysMs = params.retryDelaysMs ?? [250, 1000, 4000]
    this.#dirtySummaryLimit = params.dirtySummaryLimit ?? 1000
    this.#timer = setInterval(() => {
      void this.forceFlush()
    }, params.flushIntervalMs ?? 250)
    this.#timer.unref?.()
  }

  onStart(span: Span, _parentContext: Context): void {
    if (this.#stopped) return
    const open = toOpenSpan(span)
    this.#open.set(open.spanID, open)
    this.#emit({ type: 'span:start', data: open })
    if (isRoot(span)) {
      this.#update(open, (summary) => {
        const root = createSummary(open)
        return {
          ...summary,
          kind: root.kind,
          name: root.name,
          attributes: { ...summary.attributes, ...root.attributes },
          active: true,
          outcome: null,
          activeSegmentSpanID: open.spanID,
          endTime: undefined,
        }
      })
    }
  }

  onEnd(span: ReadableSpan): void {
    if (this.#stopped) return
    const stored = toStoredSpan(span)
    this.#open.delete(stored.spanID)
    this.#queue.push({ type: 'span', data: stored })
    this.#emit({ type: 'span:end', data: stored })
    this.#update(stored, (summary) => ({
      ...summary,
      spanCount: summary.spanCount + 1,
      errorCount: summary.errorCount + (span.status.code === SpanStatusCode.ERROR ? 1 : 0),
      ...(isRoot(span)
        ? {
            active: false,
            activeSegmentSpanID: undefined,
            outcome:
              span.status.code === SpanStatusCode.ERROR ? ('error' as const) : ('ok' as const),
            endTime: stored.endTime,
          }
        : {}),
    }))
    while (this.#queue.length > this.#queueLimit) {
      const entry = this.#queue.shift()
      if (entry) this.#drop([entry], new Error('Trace queue overflow'))
    }
    if (this.#queue.length >= this.#flushBatchSize) void this.forceFlush()
  }

  #emit(event: TraceRecorderEvent): void {
    try {
      this.#onEvent?.(structuredClone(event))
    } catch (error) {
      this.#reportError('Failed to deliver trace event', error)
    }
  }

  #update(span: OpenSpan, update: (summary: TraceSummary) => TraceSummary): void {
    const traceID = span.traceID
    const current = this.#summaries.get(traceID)
    if (current) {
      this.#changed({ ...update(current), revision: current.revision + 1 })
      return
    }
    let pending = this.#pending.get(traceID)
    if (pending == null) {
      if (this.#stopped || this.#pending.size >= this.#dirtySummaryLimit) {
        this.#lostSummaryCount++
        this.#reportError(
          'Trace hydration limit exceeded',
          new Error(`Lost summary delta for ${traceID}`),
        )
        return
      }
      pending = { summary: createSummary(span), rootChanged: false }
      this.#pending.set(traceID, pending)
      void this.#hydrate(traceID, pending)
    }
    const next = { ...update(pending.summary), revision: pending.summary.revision + 1 }
    pending.rootChanged ||= next.activeSegmentSpanID != null || next.endTime != null
    pending.summary = next
  }

  async #hydrate(traceID: string, pending: PendingSummary, attempt = 0): Promise<void> {
    try {
      const persisted = await (await getTraceIndexStore(this.#provider)).get(traceID)
      // Shutdown or loss invalidates the read, including a late successful result.
      if (this.#pending.get(traceID) !== pending) return
      const local = pending.summary
      const summary =
        persisted == null
          ? local
          : {
              ...persisted,
              ...(pending.rootChanged ? local : {}),
              rootSpanID: persisted.rootSpanID,
              startTime: persisted.startTime,
              attributes: pending.rootChanged
                ? { ...persisted.attributes, ...local.attributes }
                : persisted.attributes,
              spanCount: persisted.spanCount + local.spanCount,
              errorCount: persisted.errorCount + local.errorCount,
              droppedCount: persisted.droppedCount + local.droppedCount,
              revision: persisted.revision + local.revision,
            }
      this.#pending.delete(traceID)
      this.#changed(summary)
    } catch (error) {
      if (this.#pending.get(traceID) !== pending) return
      this.#reportError('Failed to load trace summary', error)
      const delay = this.#retryDelaysMs[attempt]
      if (delay == null) {
        this.#losePending(traceID, pending)
      } else {
        pending.retryTimer = setTimeout(() => {
          pending.retryTimer = undefined
          void this.#hydrate(traceID, pending, attempt + 1)
        }, delay)
      }
    }
  }

  #losePending(traceID: string, pending: PendingSummary): void {
    clearTimeout(pending.retryTimer)
    this.#pending.delete(traceID)
    this.#lostSummaryCount++
    this.#reportError(
      'Lost unresolved trace summary',
      new Error(`Lost summary delta for ${traceID}`),
    )
  }

  #changed(summary: TraceSummary): void {
    this.#summaries.set(summary.traceID, summary)
    this.#dirty.add(summary.traceID)
    this.#emit({ type: 'trace:summary', data: summary })
    while (this.#dirty.size > this.#dirtySummaryLimit) {
      const oldest = [...this.#dirty].find((traceID) => !this.#summaries.get(traceID)?.active)
      if (oldest == null) break
      this.#dirty.delete(oldest)
      this.#summaries.delete(oldest)
      this.#lostSummaryCount++
      this.#reportError('Trace summary limit exceeded', new Error(`Lost summary for ${oldest}`))
    }
  }

  #drop(entries: Array<TraceQueueEntry>, error: unknown): void {
    this.#droppedCount += entries.length
    this.#reportError('Dropped trace queue entries', error)
    for (const entry of entries) {
      const traceID = entry.data.traceID
      if (traceID == null) continue
      const source = entry.type === 'span' ? entry.data : this.#summaries.get(traceID)
      if (entry.type === 'span') {
        this.#update(entry.data, (summary) => ({
          ...summary,
          droppedCount: summary.droppedCount + 1,
        }))
      } else if (source && 'rootSpanID' in source) {
        this.#changed({
          ...source,
          droppedCount: source.droppedCount + 1,
          revision: source.revision + 1,
        })
      }
    }
  }

  snapshot(traceID?: string): RecorderSnapshot {
    const matches = (entry: { traceID?: string }) => traceID == null || entry.traceID === traceID
    return structuredClone({
      open: [...this.#open.values()].filter(matches),
      spans: this.#queue.flatMap((entry) =>
        entry.type === 'span' && matches(entry.data) ? [entry.data] : [],
      ),
      logs: this.#queue.flatMap((entry) =>
        entry.type === 'log' && matches(entry.data) ? [entry.data] : [],
      ),
      summaries: [...this.#summaries.values()].filter(matches),
    })
  }

  info(): TracingInfo {
    return { lostSummaryCount: this.#lostSummaryCount, droppedCount: this.#droppedCount }
  }

  async sweepInterrupted(): Promise<number> {
    const result = await this.#provider.withTransaction(async (tx) => {
      const store = await getTraceIndexStore(tx)
      const traceIDs = await store.listActiveIDs()
      const count = await store.markInterrupted()
      const summaries = await Promise.all(traceIDs.map((traceID) => store.get(traceID)))
      return { count, summaries }
    })
    for (const summary of result.summaries) {
      if (summary == null) continue
      const current = this.#summaries.get(summary.traceID)
      if (current && current.revision <= summary.revision) {
        this.#summaries.set(summary.traceID, summary)
        this.#dirty.delete(summary.traceID)
        if (!summary.active) this.#summaries.delete(summary.traceID)
      }
      this.#emit({ type: 'trace:summary', data: summary })
    }
    return result.count
  }

  forceFlush(): Promise<void> {
    if (this.#flush) return this.#flush
    const flush = this.#drain()
      .catch((error) => {
        this.#reportError('Failed to flush trace recorder', error)
      })
      .finally(() => {
        if (this.#flush === flush) this.#flush = undefined
      })
    this.#flush = flush
    return flush
  }

  async #drain(): Promise<void> {
    while (true) {
      const batch = this.#queue.slice(0, this.#flushBatchSize)
      const summaries = [...this.#dirty].flatMap((traceID) => {
        const summary = this.#summaries.get(traceID)
        return summary ? [summary] : []
      })
      if (batch.length === 0 && summaries.length === 0) return
      let committed = false
      for (let attempt = 0; ; attempt++) {
        try {
          await this.#provider.withTransaction(async (tx) => {
            const spans = batch.flatMap((entry) => (entry.type === 'span' ? [entry.data] : []))
            const logs = batch.flatMap((entry) => (entry.type === 'log' ? [entry.data] : []))
            if (spans.length) await (await getTelemetryStore(tx)).addSpans(spans)
            if (logs.length)
              await (await getLogStore(tx)).addLogs(
                logs.map((log) => ({
                  ...log,
                  properties: Object.fromEntries(
                    Object.entries(log.properties).map(([key, value]) => [key, toJSONValue(value)]),
                  ),
                })),
              )
            if (summaries.length) await (await getTraceIndexStore(tx)).upsert(summaries)
          })
          committed = true
          break
        } catch (error) {
          const delay = this.#retryDelaysMs[attempt]
          if (delay == null) {
            const queued = batch.filter((entry) => this.#queue.includes(entry))
            this.#drop(queued, error)
            break
          }
          await new Promise<void>((resolve) => setTimeout(resolve, delay))
        }
      }
      const consumed = new Set(batch)
      this.#queue = this.#queue.filter((entry) => !consumed.has(entry))
      if (!committed) return
      for (const summary of summaries) {
        if (this.#summaries.get(summary.traceID)?.revision !== summary.revision) continue
        this.#dirty.delete(summary.traceID)
        if (!summary.active) this.#summaries.delete(summary.traceID)
      }
    }
  }

  shutdown(): Promise<void> {
    if (this.#shutdown) return this.#shutdown
    this.#stopped = true
    clearInterval(this.#timer)
    for (const [traceID, pending] of this.#pending) this.#losePending(traceID, pending)
    this.#shutdown = this.forceFlush()
    return this.#shutdown
  }
}
