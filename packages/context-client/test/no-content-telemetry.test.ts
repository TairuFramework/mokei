import { DirectTransports } from '@enkaku/transport'
import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import { trace } from '@opentelemetry/api'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { ContextClient } from '../src/client.js'
import { resolvePayloadCap, responseOutcome, sanitizeMessage } from '../src/observation.js'
import { endSpanError, resolveContentCapture } from '../src/semconv.js'
import { useTestTracing } from './support/otel.js'

const { exporter } = useTestTracing()
const SECRET = 'secret detail'
const disposals: Array<() => Promise<void>> = []

afterEach(async () => {
  vi.unstubAllEnvs()
  for (const dispose of disposals.splice(0)) await dispose()
})

function mentionsSecret(value: unknown): boolean {
  return JSON.stringify(value ?? null).includes(SECRET)
}

describe("payloads: 'never'", () => {
  test('env var cannot override never', () => {
    vi.stubEnv('OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT', 'true')
    expect(resolveContentCapture('never')).toBe('never')
    expect(resolveContentCapture('off')).toBe('on')
  })

  test('never captures no content', () => {
    expect(resolvePayloadCap('never')).toBeNull()
  })

  test('sanitizeMessage drops error text', () => {
    const sanitised = sanitizeMessage(
      { jsonrpc: '2.0', id: 1, error: { code: 1, message: SECRET, data: { why: SECRET } } },
      'never',
    ) as { error?: unknown }
    expect(sanitised.error).toEqual({ code: 1 })
  })

  test('responseOutcome drops error text', () => {
    const outcome = responseOutcome({ error: { code: -32602, message: SECRET } }, 'client', 'never')
    expect(outcome).toEqual({ error: true, errorType: '-32602', statusCode: '-32602' })
  })

  test('endSpanError drops the message', () => {
    const span = trace.getTracer('test').startSpan('s')
    endSpanError(span, 'boom', SECRET, 'never')
    const [finished] = exporter.getFinishedSpans()
    expect(finished?.status.message).toBeFalsy()
    expect(finished?.attributes['error.type']).toBe('boom')
    exporter.reset()
  })

  test('server error text never reaches a span', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    disposals.push(() => transports.dispose())
    const client = new ContextClient({
      transport: transports.client,
      protocolVersion: '2025-11-25',
      tracing: {
        contextID: 'ctx',
        contextSpan: trace.getTracer('test').startSpan('ctx'),
        payloads: 'never',
      },
      listRoots: [],
    })
    const pending = client.request('tools/list', {}).catch((error: unknown) => error)
    const init = (await transports.server.read()).value as { id: number }
    await transports.server.write({
      jsonrpc: '2.0',
      id: init.id,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 's', version: '1' },
      },
    } as ServerMessage)
    await transports.server.read() // notifications/initialized
    const list = (await transports.server.read()).value as { id: number }
    await transports.server.write({
      jsonrpc: '2.0',
      id: list.id,
      error: { code: -32602, message: SECRET },
    } as ServerMessage)
    await pending
    const spans = exporter.getFinishedSpans().filter((span) => span.name.startsWith('tools/list'))
    expect(spans.length).toBeGreaterThan(0)
    for (const span of spans) {
      expect(span.attributes['error.type']).toBe('-32602')
      expect(span.status.message).toBeFalsy()
      expect(mentionsSecret(span.attributes)).toBe(false)
      expect(mentionsSecret(span.events)).toBe(false)
    }
    exporter.reset()
  })
})
