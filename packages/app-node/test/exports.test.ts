import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { expect, test } from 'vitest'

import { toOpenSpan, toStoredSpan } from '../src/index.js'

test('public span converters preserve identity and attributes', async () => {
  const opens: Array<ReturnType<typeof toOpenSpan>> = []
  const stored: Array<ReturnType<typeof toStoredSpan>> = []
  const provider = new BasicTracerProvider({
    spanProcessors: [
      {
        onStart: (span) => {
          opens.push(toOpenSpan(span))
        },
        onEnd: (span) => {
          stored.push(toStoredSpan(span))
        },
        forceFlush: async () => {},
        shutdown: async () => {},
      },
    ],
  })
  try {
    const span = provider.getTracer('exports').startSpan('mcp.context', {
      attributes: { 'mokei.root': true },
    })
    span.end()
    expect(opens[0]).toMatchObject({
      traceID: span.spanContext().traceId,
      spanID: span.spanContext().spanId,
      name: 'mcp.context',
      attributes: { 'mokei.root': true },
    })
    expect(stored[0]).toMatchObject(opens[0] ?? {})
    expect(stored[0]?.endTime).toBeGreaterThanOrEqual(opens[0]?.startTime ?? 0)
  } finally {
    await provider.shutdown()
  }
})
