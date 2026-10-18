import { SpanStatusCode, trace } from '@opentelemetry/api'
import { afterEach, describe, expect, test } from 'vitest'

import {
  endSpanError,
  errorTypeOf,
  getMokeiTracer,
  resolveContentCapture,
  SEMCONV_SCHEMA_URL,
} from '../src/semconv.js'
import { useTestTracing } from './support/otel.js'

const ENV_KEY = 'OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT'
// Package has no Node types.
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
  .process.env
const originalEnv = env[ENV_KEY]

afterEach(() => {
  if (originalEnv === undefined) {
    delete env[ENV_KEY]
  } else {
    env[ENV_KEY] = originalEnv
  }
})

describe('resolveContentCapture', () => {
  test('undefined stays off with env unset', () => {
    delete env[ENV_KEY]
    expect(resolveContentCapture(undefined)).toBe('off')
  })

  test('env TRUE enables when off', () => {
    env[ENV_KEY] = 'TRUE'
    expect(resolveContentCapture('off')).toBe('on')
    expect(resolveContentCapture(undefined)).toBe('on')
  })

  test('explicit payloads win over env', () => {
    env[ENV_KEY] = 'true'
    expect(resolveContentCapture(1024)).toBe(1024)
    expect(resolveContentCapture('on')).toBe('on')
  })

  test('other env values do not enable', () => {
    env[ENV_KEY] = 'yes'
    expect(resolveContentCapture('off')).toBe('off')
  })
})

describe('tracer and span helpers', () => {
  const { exporter } = useTestTracing()

  test('getMokeiTracer sets scope name and schema URL', () => {
    getMokeiTracer('x').startSpan('s').end()
    const [span] = exporter.getFinishedSpans()
    expect(span?.instrumentationScope.name).toBe('mokei.x')
    expect(span?.instrumentationScope.schemaUrl).toBe(SEMCONV_SCHEMA_URL)
  })

  test('endSpanError sets error.type, status and ends', () => {
    endSpanError(trace.getTracer('t').startSpan('e'), 'boom', 'it broke')
    const [span] = exporter.getFinishedSpans()
    expect(span?.status).toEqual({ code: SpanStatusCode.ERROR, message: 'it broke' })
    expect(span?.attributes['error.type']).toBe('boom')
  })
})

describe('errorTypeOf', () => {
  test('abort errors map to cancelled', () => {
    const abort = new Error('stop')
    abort.name = 'AbortError'
    expect(errorTypeOf(abort)).toBe('cancelled')
    expect(errorTypeOf(new DOMException('stop', 'AbortError'))).toBe('cancelled')
  })

  test('named errors keep their name', () => {
    expect(errorTypeOf(new TypeError('x'))).toBe('TypeError')
  })

  test('generic Error and non-Error values map to _OTHER', () => {
    expect(errorTypeOf(new Error('x'))).toBe('_OTHER')
    expect(errorTypeOf('boom')).toBe('_OTHER')
    expect(errorTypeOf(undefined)).toBe('_OTHER')
  })
})
