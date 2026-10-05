import { isTerminalRunState } from '@mokei/flow-client'
import { isSpanContextValid } from '@opentelemetry/api'
import type { Context, Span } from '@sozai/otel'
import {
  createTracerFactory,
  extractW3CTraceContext,
  formatTraceparent,
  getActiveSpan,
  parseTraceparent,
  SpanStatusCode,
  setSpanOnContext,
  withActiveContext,
} from '@sozai/otel'

import type { RunRecord, RunState } from './types.js'

export function createRunTracing() {
  const tracer = createTracerFactory('mokei')('flow-host')
  const open = new Map<string, { span: Span; context: Context }>()
  function end(runID: string) {
    const active = open.get(runID)
    if (active === undefined) return
    open.delete(runID)
    active.span.end()
  }
  function begin(record: RunRecord, resume: boolean): Pick<RunRecord, 'traceID' | 'traceparent'> {
    const parent =
      resume && record.traceparent !== undefined && parseTraceparent(record.traceparent)
        ? extractW3CTraceContext({ traceparent: record.traceparent })
        : undefined
    const parentSpan = withActiveContext(parent, () => getActiveSpan()?.spanContext())
    const caller = getActiveSpan()?.spanContext()
    const span = tracer.startSpan(
      resume ? 'flow.run.resume' : 'flow.run',
      {
        ...(!resume
          ? {
              root: true,
              links:
                caller !== undefined && isSpanContextValid(caller) ? [{ context: caller }] : [],
            }
          : {}),
        attributes: {
          'run.id': record.runID,
          ...(record.flowID !== undefined ? { 'flow.id': record.flowID } : {}),
          'run.label': record.label,
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
    open.set(record.runID, { span, context })
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
      active.span.addEvent('run.state', { 'run.state': state })
      if (state === 'failed') active.span.setStatus({ code: SpanStatusCode.ERROR })
      if (isTerminalRunState(state)) end(runID)
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
