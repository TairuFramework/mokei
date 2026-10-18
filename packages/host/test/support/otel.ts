import { trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { afterAll, beforeAll, beforeEach } from 'vitest'

export function useTestTracing(): { exporter: InMemorySpanExporter } {
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
  beforeAll(() => {
    trace.setGlobalTracerProvider(provider)
  })
  beforeEach(() => {
    trace.setGlobalTracerProvider(provider)
    exporter.reset()
  })
  afterAll(async () => {
    await provider.shutdown()
    trace.disable()
  })
  return { exporter }
}
