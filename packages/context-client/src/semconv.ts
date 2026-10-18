import { type Meter, type Span, SpanStatusCode, type Tracer } from '@opentelemetry/api'
import { createMeterFactory, createTracerFactory } from '@sozai/otel'

import type { PayloadCapture } from './observation.js'

export const SEMCONV_SCHEMA_URL = 'https://opentelemetry.io/schemas/gen-ai-dev/1.42.0-dev'

const CONTENT_ENV_VAR = 'OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT'

export const MCP_DURATION_BUCKETS: ReadonlyArray<number> = [
  0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300,
]

export const GEN_AI_DURATION_BUCKETS: ReadonlyArray<number> = [
  0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28, 2.56, 5.12, 10.24, 20.48, 40.96, 81.92,
]

export const AGENT_DURATION_BUCKETS: ReadonlyArray<number> = [
  0.1, 0.2, 0.4, 0.8, 1.6, 3.2, 6.4, 12.8, 25.6, 51.2, 102.4, 204.8, 409.6,
]

export const AGENT_COUNT_BUCKETS: ReadonlyArray<number> = [1, 2, 4, 8, 16, 32, 64, 128]

export const WORKFLOW_DURATION_BUCKETS: ReadonlyArray<number> = [
  1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600, 7200,
]

export const TOKEN_BUCKETS: ReadonlyArray<number> = [
  1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 16777216, 67108864,
]

const tracerFactory = createTracerFactory('mokei', undefined, { schemaUrl: SEMCONV_SCHEMA_URL })
const meterFactory = createMeterFactory('mokei', undefined, { schemaUrl: SEMCONV_SCHEMA_URL })

export function getMokeiTracer(scope: string): Tracer {
  return tracerFactory(scope)
}

export function getMokeiMeter(scope: string): Meter {
  return meterFactory(scope)
}

/** Env opt-in only applies when `payloads` is unset or `'off'`; Node-free env access. */
export function resolveContentCapture(payloads: PayloadCapture | undefined): PayloadCapture {
  if (payloads !== undefined && payloads !== 'off') {
    return payloads
  }
  // No Node types in this package; process is absent on React Native.
  const nodeGlobal = globalThis as { process?: { env?: Record<string, string | undefined> } }
  const value = nodeGlobal.process?.env?.[CONTENT_ENV_VAR]
  return value?.toLowerCase() === 'true' ? 'on' : 'off'
}

export function endSpanError(span: Span, errorType: string, message?: string): void {
  span.setAttribute('error.type', errorType)
  span.setStatus({ code: SpanStatusCode.ERROR, message })
  span.end()
}

/**
 * `error.type` of a thrown value: aborts are `cancelled`, errors with a specific name keep it,
 * everything else is `_OTHER`.
 */
export function errorTypeOf(error: unknown): string {
  if (!(error instanceof Error)) return '_OTHER'
  if (error.name === 'AbortError') return 'cancelled'
  return error.name !== 'Error' ? error.name : '_OTHER'
}
