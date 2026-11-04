import { randomUUID } from 'node:crypto'
import type { StoreProvider } from '@hozon/db'
import { getLogStore } from '@hozon/store-log'
import type { StoredSpan } from '@hozon/store-telemetry'
import { getTelemetryStore } from '@hozon/store-telemetry'
import type { Sink } from '@logtape/logtape'
import type { OpenSpan, TraceCall, TraceLog, TraceSummary, TracingInfo } from '@mokei/host-protocol'
import type { Context } from '@opentelemetry/api'
import { isSpanContextValid, SpanStatusCode, trace } from '@opentelemetry/api'
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace'
import { toJSONValue } from '@sozai/json'
import { getReporter, renderLogMessage } from '@sozai/log'

import { toOpenSpan, toStoredSpan } from './stored-span.js'
import { getTraceIndexStore, type IndexedTraceCall, pickSummaryAttributes } from './trace-index.js'

export type TraceRecorderEvent =
  | { type: 'span:start'; data: OpenSpan }
  | { type: 'span:end'; data: StoredSpan }
  | { type: 'log'; data: TraceLog }
  | { type: 'trace:summary'; data: TraceSummary }

export type TraceRecorderParams = {
  provider: StoreProvider
  onEvent?: (event: TraceRecorderEvent) => void
  hasListeners?: (type: TraceRecorderEvent['type']) => boolean
  reportCategories?: ReadonlyArray<ReadonlyArray<string>>
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
  return span.attributes['mokei.root'] === true
}

/** The trace a span calls into, when it is a call from another trace (a linked request span). */
function calledTraceID(span: OpenSpan): string | undefined {
  const target = span.attributes['mokei.context.trace_id']
  return typeof target === 'string' && target !== span.traceID ? target : undefined
}

/** `span` as a call into another trace, or `undefined` when it is not one. */
export function toTraceCall(span: OpenSpan | StoredSpan): IndexedTraceCall | undefined {
  const contextTraceID = calledTraceID(span)
  if (contextTraceID == null) return undefined
  const ended = 'endTime' in span && typeof span.endTime === 'number'
  return {
    contextTraceID,
    traceID: span.traceID,
    spanID: span.spanID,
    name: span.name,
    startTime: span.startTime,
    ...(ended ? { endTime: (span as StoredSpan).endTime } : {}),
    outcome: ended
      ? (span as StoredSpan).status.code === SpanStatusCode.ERROR
        ? 'error'
        : 'ok'
      : null,
  }
}

function sameAttributes(a: TraceSummary['attributes'], b: TraceSummary['attributes']): boolean {
  const keys = Object.keys(b) as Array<keyof TraceSummary['attributes']>
  return keys.every((key) => a[key] === b[key])
}

function createSummary(span: OpenSpan): TraceSummary {
  const kind = span.attributes['mokei.kind']
  const attributes = pickSummaryAttributes(span.attributes)
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
  summary?: TraceSummary
  droppedLogCount: number
  rootChanged: boolean
  hasRootStart: boolean
  retryTimer?: ReturnType<typeof setTimeout>
}

export class LocalTraceRecorder implements SpanProcessor {
  #sink: Sink
  #provider: StoreProvider
  #onEvent?: TraceRecorderParams['onEvent']
  #hasListeners?: TraceRecorderParams['hasListeners']
  #unrooted = new Set<string>()
  #reportError: NonNullable<TraceRecorderParams['reportError']>
  #queueLimit: number
  #flushBatchSize: number
  #retryDelaysMs: Array<number>
  #dirtySummaryLimit: number
  #timer: ReturnType<typeof setInterval>
  // Live spans, not start-time copies: attributes set after start (a context's
  // `mokei.server.name`) must reach snapshots and summaries before the span ends.
  #open = new Map<string, Span>()
  // Traces whose lost child-only delta is being checked against the index.
  #verifying = new Set<string>()
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
    const excluded = [['hozon'], ['mokei', 'trace-recorder'], ...(params.reportCategories ?? [])]
    this.#sink = (record) => {
      if (this.#stopped) return
      if (excluded.some((prefix) => prefix.every((part, index) => record.category[index] === part)))
        return
      const spanContext = trace.getActiveSpan()?.spanContext()
      if (spanContext == null || !isSpanContextValid(spanContext)) return
      const logID = randomUUID()
      const log: TraceLog = {
        logID,
        traceID: spanContext.traceId,
        spanID: spanContext.spanId,
        timestamp: record.timestamp,
        level: record.level,
        category: [...record.category],
        message: renderLogMessage(record),
        properties: {
          ...Object.fromEntries(
            Object.entries(record.properties).map(([key, value]) => [key, toJSONValue(value)]),
          ),
          'dev.mokei/logID': logID,
        },
      }
      this.#queue.push({ type: 'log', data: log })
      this.#emit({ type: 'log', data: log })
      this.#checkQueue()
    }
    this.#provider = params.provider
    this.#onEvent = params.onEvent
    this.#hasListeners = params.hasListeners
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

  get sink(): Sink {
    return this.#sink
  }

  onStart(span: Span, _parentContext: Context): void {
    if (this.#stopped) return
    const open = toOpenSpan(span)
    this.#open.set(open.spanID, span)
    this.#emit({ type: 'span:start', data: open })
    if (isRoot(span)) {
      this.#unrooted.delete(open.traceID)
      this.#update(open, (summary) => {
        const root = createSummary(open)
        return {
          ...summary,
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
            attributes: { ...summary.attributes, ...pickSummaryAttributes(stored.attributes) },
            active: false,
            activeSegmentSpanID: undefined,
            outcome:
              span.status.code === SpanStatusCode.ERROR ? ('error' as const) : ('ok' as const),
            endTime: stored.endTime,
          }
        : {}),
    }))
    this.#checkQueue()
  }

  #checkQueue(): void {
    while (this.#queue.length > this.#queueLimit) {
      const entry = this.#queue.shift()
      if (entry) this.#drop([entry], new Error('Trace queue overflow'))
    }
    if (this.#queue.length >= this.#flushBatchSize) void this.forceFlush()
  }

  #emit(event: TraceRecorderEvent): void {
    if (this.#onEvent == null || this.#hasListeners?.(event.type) === false) return
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
    const pending = this.#getPending(traceID, span)
    if (pending == null) return
    const currentDelta = pending.summary ?? createSummary(span)
    const next = { ...update(currentDelta), revision: currentDelta.revision + 1 }
    pending.rootChanged ||= next.activeSegmentSpanID != null || next.endTime != null
    pending.hasRootStart ||=
      span.attributes['mokei.root'] === true && next.activeSegmentSpanID != null
    pending.summary = next
  }

  #getPending(traceID: string, span?: OpenSpan): PendingSummary | undefined {
    if (this.#unrooted.has(traceID)) return
    let pending = this.#pending.get(traceID)
    if (pending == null) {
      if (this.#stopped || this.#pending.size >= this.#dirtySummaryLimit) {
        if (span?.attributes['mokei.root'] !== true) {
          // A child-only delta is lost only if its trace is one this recorder indexes.
          if (!this.#stopped) this.#verifyLoss(traceID)
          return
        }
        this.#lostSummaryCount++
        this.#reportError(
          'Trace hydration limit exceeded',
          new Error(`Lost summary delta for ${traceID}`),
        )
        return
      }
      pending = {
        summary: span == null ? undefined : createSummary(span),
        droppedLogCount: 0,
        rootChanged: false,
        hasRootStart: false,
      }
      this.#pending.set(traceID, pending)
      void this.#hydrate(traceID, pending)
    }
    return pending
  }

  async #hydrate(traceID: string, pending: PendingSummary, attempt = 0): Promise<void> {
    try {
      const persisted = await (await getTraceIndexStore(this.#provider)).get(traceID)
      // Shutdown or loss invalidates the read, including a late successful result.
      if (this.#pending.get(traceID) !== pending) return
      const local = pending.summary
      if (persisted == null && (!pending.hasRootStart || local == null)) {
        this.#pending.delete(traceID)
        this.#markUnrooted(traceID)
        return
      }
      const summary =
        persisted == null
          ? local
          : {
              ...persisted,
              ...(pending.rootChanged ? local : {}),
              name: persisted.name,
              kind: persisted.kind,
              rootSpanID: persisted.rootSpanID,
              startTime: persisted.startTime,
              attributes: pending.rootChanged
                ? { ...persisted.attributes, ...local?.attributes }
                : persisted.attributes,
              spanCount: persisted.spanCount + (local?.spanCount ?? 0),
              errorCount: persisted.errorCount + (local?.errorCount ?? 0),
              droppedCount: persisted.droppedCount + (local?.droppedCount ?? 0),
              revision: persisted.revision + (local?.revision ?? 0),
            }
      this.#pending.delete(traceID)
      if (summary == null) return
      this.#changed({
        ...summary,
        droppedCount: summary.droppedCount + pending.droppedLogCount,
        revision: summary.revision + pending.droppedLogCount,
      })
    } catch (error) {
      if (this.#pending.get(traceID) !== pending) return
      this.#reportError('Failed to load trace summary', error)
      const delay = this.#retryDelaysMs[attempt]
      if (delay == null) {
        // Hydration failed for good: whether the trace is indexed is unknown, so any delta it
        // held counts as lost. The load error was reported above.
        this.#losePending(traceID, pending, { childDeltas: true })
      } else {
        pending.retryTimer = setTimeout(() => {
          pending.retryTimer = undefined
          void this.#hydrate(traceID, pending, attempt + 1)
        }, delay)
      }
    }
  }

  #markUnrooted(traceID: string): void {
    this.#unrooted.add(traceID)
    if (this.#unrooted.size > 1000) {
      const oldest = this.#unrooted.values().next().value
      if (oldest !== undefined) this.#unrooted.delete(oldest)
    }
  }

  /**
   * Counts a child-only delta dropped at the hydration limit as lost when its trace is indexed.
   * A trace the index does not hold is unrooted (no mokei root span), so nothing was lost.
   */
  #verifyLoss(traceID: string): void {
    if (this.#unrooted.has(traceID) || this.#verifying.has(traceID)) return
    const lost = () => {
      this.#lostSummaryCount++
      this.#reportError(
        'Trace hydration limit exceeded',
        new Error(`Lost summary delta for ${traceID}`),
      )
    }
    // Lookups are bounded like pending summaries. Past the bound, assume the delta mattered.
    if (this.#verifying.size >= this.#dirtySummaryLimit) {
      lost()
      return
    }
    this.#verifying.add(traceID)
    void getTraceIndexStore(this.#provider)
      .then((store) => store.get(traceID))
      .then(
        (persisted) => {
          if (persisted == null) this.#markUnrooted(traceID)
          else lost()
        },
        (error) => {
          this.#reportError('Failed to load trace summary', error)
          lost()
        },
      )
      .finally(() => {
        this.#verifying.delete(traceID)
      })
  }

  #losePending(
    traceID: string,
    pending: PendingSummary,
    options: { childDeltas?: boolean } = {},
  ): void {
    clearTimeout(pending.retryTimer)
    this.#pending.delete(traceID)
    const heldChildDeltas =
      (pending.summary?.spanCount ?? 0) > 0 ||
      (pending.summary?.droppedCount ?? 0) > 0 ||
      pending.droppedLogCount > 0
    if (!pending.hasRootStart && !(options.childDeltas && heldChildDeltas)) return
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
      if (entry.type === 'span') {
        this.#update(entry.data, (summary) => ({
          ...summary,
          droppedCount: summary.droppedCount + 1,
        }))
      } else {
        const current = this.#summaries.get(traceID)
        if (current) {
          this.#changed({
            ...current,
            droppedCount: current.droppedCount + 1,
            revision: current.revision + 1,
          })
        } else {
          const pending = this.#getPending(traceID)
          if (pending) pending.droppedLogCount++
        }
      }
    }
  }

  snapshot(traceID?: string): RecorderSnapshot {
    const matches = (entry: { traceID?: string }) => traceID == null || entry.traceID === traceID
    return structuredClone({
      open: [...this.#open.values()].map((span) => toOpenSpan(span)).filter(matches),
      spans: this.#queue.flatMap((entry) =>
        entry.type === 'span' && matches(entry.data) ? [entry.data] : [],
      ),
      logs: this.#queue.flatMap((entry) =>
        entry.type === 'log' && matches(entry.data) ? [entry.data] : [],
      ),
      summaries: [...this.#summaries.values()].filter(matches),
    })
  }

  /** Calls into `contextTraceID` not yet in the index: open, or ended and still queued. */
  callsInto(contextTraceID: string): Array<TraceCall> {
    const calls: Array<TraceCall> = []
    const spans = [
      ...[...this.#open.values()].map((span) => toOpenSpan(span)),
      ...this.#queue.flatMap((entry) => (entry.type === 'span' ? [entry.data] : [])),
    ]
    for (const span of spans) {
      const call = toTraceCall(span)
      if (call?.contextTraceID !== contextTraceID) continue
      const { contextTraceID: _, ...rest } = call
      calls.push(rest)
    }
    return structuredClone(calls)
  }

  /** Re-reads summary attributes set on open root spans after they started. */
  #refreshRoots(): void {
    for (const span of this.#open.values()) {
      if (!isRoot(span)) continue
      const picked = pickSummaryAttributes(span.attributes)
      const traceID = span.spanContext().traceId
      const current = this.#summaries.get(traceID) ?? this.#pending.get(traceID)?.summary
      if (current == null || sameAttributes(current.attributes, picked)) continue
      this.#update(toOpenSpan(span), (summary) => ({
        ...summary,
        attributes: { ...summary.attributes, ...picked },
      }))
    }
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
    if (!this.#stopped) this.#refreshRoots()
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
            const calls = spans.flatMap((span) => {
              const call = toTraceCall(span)
              return call == null ? [] : [call]
            })
            if (summaries.length || calls.length) {
              const index = await getTraceIndexStore(tx)
              if (calls.length) await index.addCalls(calls)
              if (summaries.length) await index.upsert(summaries)
            }
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
