import type { Attributes, HrTime } from '@opentelemetry/api'
import { ExportResultCode } from '@opentelemetry/core'
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base'
import { getReporter } from '@sozai/log'

import { toJSONValue } from './to-json-value.js'
import type { StoredSpan, TraceStore } from './trace-store.js'

function milliseconds(time: HrTime): number {
  return time[0] * 1000 + time[1] / 1000000
}

function attributes(values: Attributes = {}): StoredSpan['attributes'] {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, toJSONValue(value)]))
}

function storedSpan(span: ReadableSpan): StoredSpan {
  const ctx = span.spanContext()
  return {
    traceID: ctx.traceId,
    spanID: ctx.spanId,
    ...(span.parentSpanContext ? { parentSpanID: span.parentSpanContext.spanId } : {}),
    name: span.name,
    kind: span.kind,
    startTime: milliseconds(span.startTime),
    endTime: milliseconds(span.endTime),
    status: { ...span.status },
    attributes: attributes(span.attributes),
    events: span.events.map((event) => ({
      name: event.name,
      time: milliseconds(event.time),
      attributes: attributes(event.attributes),
    })),
    links: span.links.map((link) => ({
      traceID: link.context.traceId,
      spanID: link.context.spanId,
    })),
  }
}

export function createTraceStoreSpanExporter(store: TraceStore): SpanExporter {
  const report = getReporter(['mokei', 'flow-host', 'capture'], '@mokei/flow-host')
  const pending = new Set<Promise<void>>()
  async function drain(): Promise<void> {
    while (pending.size > 0) await Promise.all(pending)
  }
  return {
    export(spans, callback) {
      const write = Promise.resolve()
        .then(() => store.addSpans(spans.map(storedSpan)))
        .then(
          () => callback({ code: ExportResultCode.SUCCESS }),
          (error: unknown) => {
            report('Failed to capture span batch', error)
            callback({
              code: ExportResultCode.FAILED,
              error: error instanceof Error ? error : new Error(String(error)),
            })
          },
        )
        .finally(() => pending.delete(write))
      pending.add(write)
    },
    forceFlush: drain,
    shutdown: drain,
  }
}
