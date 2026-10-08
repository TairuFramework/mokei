import type { StoredSpan } from '@hozon/store-telemetry'
import type { OpenSpan } from '@mokei/host-protocol'
import type { Attributes, HrTime } from '@opentelemetry/api'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { toJSONValue } from '@sozai/json'

function milliseconds(time: HrTime): number {
  return time[0] * 1000 + time[1] / 1_000_000
}

function attributes(values: Attributes = {}): StoredSpan['attributes'] {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, toJSONValue(value)]))
}

export function toOpenSpan(span: ReadableSpan): OpenSpan {
  const context = span.spanContext()
  return {
    traceID: context.traceId,
    spanID: context.spanId,
    ...(span.parentSpanContext ? { parentSpanID: span.parentSpanContext.spanId } : {}),
    name: span.name,
    kind: span.kind,
    startTime: milliseconds(span.startTime),
    attributes: attributes(span.attributes),
    links: span.links.map((link) => ({
      traceID: link.context.traceId,
      spanID: link.context.spanId,
    })),
  }
}

export function toStoredSpan(span: ReadableSpan): StoredSpan {
  return {
    ...toOpenSpan(span),
    attributes: attributes(span.attributes),
    endTime: milliseconds(span.endTime),
    status: { ...span.status },
    events: span.events.map((event) => ({
      name: event.name,
      time: milliseconds(event.time),
      attributes: attributes(event.attributes),
    })),
  }
}
