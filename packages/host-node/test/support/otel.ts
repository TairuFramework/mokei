import { context, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { afterAll, beforeAll, beforeEach } from 'vitest'

export function useTestTracing(): { exporter: InMemorySpanExporter } {
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
  const manager = new AsyncLocalStorageContextManager()
  beforeAll(() => {
    context.setGlobalContextManager(manager.enable())
    trace.setGlobalTracerProvider(provider)
  })
  beforeEach(() => {
    trace.setGlobalTracerProvider(provider)
    exporter.reset()
  })
  afterAll(async () => {
    await provider.shutdown()
    trace.disable()
    context.disable()
    manager.disable()
  })
  return { exporter }
}
