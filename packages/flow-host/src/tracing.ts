import {
  endSpanError,
  getMokeiMeter,
  getMokeiTracer,
  WORKFLOW_DURATION_BUCKETS,
} from '@mokei/context-client'
import { isTerminalRunState } from '@mokei/flow-client'
import type { Attributes, Histogram, MeterProvider } from '@opentelemetry/api'
import { createNoopMeter, isSpanContextValid, metrics } from '@opentelemetry/api'
import type { Context, Span } from '@sozai/otel'
import {
  extractW3CTraceContext,
  formatTraceparent,
  getActiveSpan,
  parseTraceparent,
  setSpanOnContext,
  withActiveContext,
} from '@sozai/otel'

import type { RunRecord, RunState } from './types.js'

let durationHistogram: Histogram | undefined
let histogramProvider: MeterProvider | undefined

function recordDuration(durationS: number, attributes: Attributes): void {
  const meter = getMokeiMeter('flow-host')
  if (meter === createNoopMeter()) return
  const provider = metrics.getMeterProvider()
  if (provider !== histogramProvider || durationHistogram === undefined) {
    histogramProvider = provider
    durationHistogram = meter.createHistogram('gen_ai.invoke_workflow.duration', {
      description: 'Duration of a flow run from start to terminal state',
      unit: 's',
      advice: { explicitBucketBoundaries: [...WORKFLOW_DURATION_BUCKETS] },
    })
  }
  durationHistogram.record(durationS, attributes)
}

export function createRunTracing() {
  const tracer = getMokeiTracer('flow-host')
  const open = new Map<
    string,
    { span: Span; context: Context; startedAt: number; flowID?: string; failed: boolean }
  >()
  function end(runID: string, terminal = false) {
    const active = open.get(runID)
    if (active === undefined) return
    open.delete(runID)
    if (active.failed) endSpanError(active.span, 'failed')
    else active.span.end()
    if (terminal) {
      recordDuration((performance.now() - active.startedAt) / 1000, {
        ...(active.flowID !== undefined ? { 'gen_ai.workflow.name': active.flowID } : {}),
        ...(active.failed ? { 'error.type': 'failed' } : {}),
      })
    }
  }
  function begin(record: RunRecord, resume: boolean): Pick<RunRecord, 'traceID' | 'traceparent'> {
    const parent =
      resume && record.traceparent !== undefined && parseTraceparent(record.traceparent)
        ? extractW3CTraceContext({ traceparent: record.traceparent })
        : undefined
    const parentSpan = withActiveContext(parent, () => getActiveSpan()?.spanContext())
    const caller = getActiveSpan()?.spanContext()
    const span = tracer.startSpan(
      record.flowID !== undefined ? `invoke_workflow ${record.flowID}` : 'invoke_workflow',
      {
        ...(!resume
          ? {
              root: true,
              links:
                caller !== undefined && isSpanContextValid(caller) ? [{ context: caller }] : [],
            }
          : {}),
        attributes: {
          'gen_ai.operation.name': 'invoke_workflow',
          ...(record.flowID !== undefined ? { 'gen_ai.workflow.name': record.flowID } : {}),
          'mokei.kind': 'flow',
          'mokei.root': true,
          'mokei.run.id': record.runID,
          ...(record.flowID !== undefined ? { 'mokei.flow.id': record.flowID } : {}),
          'mokei.run.label': record.label,
          ...(resume ? { 'mokei.run.resumed': true } : {}),
        },
      },
      parent,
    )
    const context = setSpanOnContext(parent, span)
    const spanContext = span.spanContext()
    const traceparent = formatTraceparent(
      spanContext.traceId,
      spanContext.spanId,
      spanContext.traceFlags,
    )
    // A no-op tracer reuses a valid parent rather than allocating a span ID.
    if (traceparent === undefined || spanContext.spanId === parentSpan?.spanId) {
      span.end()
      return {}
    }
    open.set(record.runID, {
      span,
      context,
      startedAt: performance.now(),
      ...(record.flowID !== undefined ? { flowID: record.flowID } : {}),
      failed: false,
    })
    return { traceID: spanContext.traceId, traceparent }
  }
  return {
    start: (record: RunRecord) => begin(record, false),
    resume(record: RunRecord) {
      begin(record, true)
    },
    state(runID: string, state: RunState) {
      const active = open.get(runID)
      if (active === undefined) return
      active.span.addEvent('mokei.run.state', { 'mokei.run.state': state })
      if (state === 'failed') active.failed = true
      if (isTerminalRunState(state)) end(runID, true)
    },
    withRun<T>(runID: string, work: () => T): T {
      return withActiveContext(open.get(runID)?.context, work)
    },
    end,
    dispose() {
      for (const runID of open.keys()) end(runID)
    },
  }
}
export type RunTracing = ReturnType<typeof createRunTracing>
