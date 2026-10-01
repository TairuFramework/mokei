import type { LogLevel, Sink } from '@logtape/logtape'
import type { TraceStore } from '@mokei/flow-host'
import { createTraceStoreLogSink, createTraceStoreSpanExporter } from '@mokei/flow-host'
import { context, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { getConsoleSink, isSetup, reset, setup } from '@sozai/log'
import { createFileSink } from '@tejika/log'

let installed = false

export function setupFlowTelemetry(params: {
  traceStore: TraceStore
  otlp?: { endpoint: string; headers?: Record<string, string> }
  logs?: { level?: LogLevel; file?: boolean }
}): { dispose(): Promise<void> } {
  if (installed) throw new Error('Flow telemetry was already installed in this process')
  if (isSetup()) throw new Error('Logging is already configured')
  // OTel's public getters return proxies even before registration. Read without probing.
  const registry: unknown = Reflect.get(globalThis, Symbol.for('opentelemetry.js.api.1'))
  if (typeof registry === 'object' && registry !== null) {
    if ('trace' in registry && registry.trace != null) {
      throw new Error('A global tracer provider is already registered')
    }
    if ('context' in registry && registry.context != null) {
      throw new Error('A global context manager is already registered')
    }
  }

  const rollback: Array<() => void | Promise<void>> = []
  try {
    const localProcessor = new BatchSpanProcessor(createTraceStoreSpanExporter(params.traceStore))
    const processors = [localProcessor]
    rollback.push(() => localProcessor.shutdown())
    if (params.otlp) {
      const processor = new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: params.otlp.endpoint,
          headers: params.otlp.headers,
        }),
      )
      processors.push(processor)
      rollback.push(() => processor.shutdown())
    }
    const provider = new BasicTracerProvider({ spanProcessors: processors })
    rollback.length = 0
    rollback.push(() => provider.shutdown())
    const manager = new AsyncLocalStorageContextManager()
    let contextRegistered = false
    rollback.push(() => {
      if (contextRegistered) context.disable()
      else manager.disable()
    })
    manager.enable()
    if (!context.setGlobalContextManager(manager)) {
      throw new Error('Failed to register the global context manager')
    }
    contextRegistered = true
    if (!trace.setGlobalTracerProvider(provider)) {
      throw new Error('Failed to register the global tracer provider')
    }
    rollback.push(() => trace.disable())

    const sink = createTraceStoreLogSink(params.traceStore)
    rollback.push(() => sink.flush())
    const sinks: Record<string, Sink> = { capture: sink, errors: getConsoleSink() }
    const rootSinks = ['capture']
    if (params.logs?.file !== false) {
      const file = createFileSink({ app: 'mokei', name: 'mokei', rotate: 'daily' })
      let disposed = false
      const disposeFile = (): void => {
        if (disposed) return
        disposed = true
        const dispose: unknown = Reflect.get(file, Symbol.dispose)
        if (typeof dispose === 'function') dispose.call(file)
      }
      // configureSync may dispose a sink before throwing. Share its rollback guard.
      sinks.file = Object.assign((record: Parameters<Sink>[0]) => file(record), {
        [Symbol.dispose]: disposeFile,
      })
      rollback.push(disposeFile)
      rootSinks.push('file')
    }
    rollback.push(reset)
    setup({
      sinks,
      loggers: [
        { category: [], lowestLevel: params.logs?.level ?? 'info', sinks: rootSinks },
        { category: ['logtape', 'meta'], lowestLevel: 'error', sinks: [] },
        { category: ['mokei', 'flow-host', 'capture'], lowestLevel: 'error', sinks: ['errors'] },
      ],
    })
    installed = true
    let disposal: Promise<void> | undefined
    return {
      dispose() {
        disposal ??= (async () => {
          const errors: Array<unknown> = []
          for (const cleanup of [
            () => provider.forceFlush(),
            () => provider.shutdown(),
            () => sink.flush(),
            reset,
            () => trace.disable(),
            () => context.disable(),
          ]) {
            try {
              await cleanup()
            } catch (error) {
              errors.push(error)
            }
          }
          if (errors.length > 0)
            throw new AggregateError(errors, 'Failed to dispose flow telemetry')
        })()
        return disposal
      },
    }
  } catch (error) {
    for (const cleanup of rollback.reverse()) {
      try {
        // Setup is synchronous. Start asynchronous drains without replacing its original error.
        const completion = cleanup()
        if (completion) void completion.catch(() => {})
      } catch {}
    }
    throw error
  }
}
