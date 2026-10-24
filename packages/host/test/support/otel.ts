import { trace } from '@opentelemetry/api'
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace'
import { afterAll, beforeAll, beforeEach } from 'vitest'

export function useTestTracing(): { exporter: InMemorySpanExporter } {
  const exporter = new InMemorySpanExporter()
  const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] })
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
