import { createLogStoreSink } from '@hozon/logtape'
import { createTelemetrySpanExporter } from '@hozon/otel'
import type { LogStore } from '@hozon/store-log'
import type { TelemetryStore } from '@hozon/store-telemetry'
import type { LogLevel, Sink } from '@logtape/logtape'
import { context, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { raceAttempt, settleSequential, TimeoutInterruption } from '@sozai/async'
import { getConsoleSink, isSetup, reset, setup } from '@sozai/log'
import { createFileSink } from '@tejika/log'

let installed = false
const EXPORT_TIMEOUT_MS = 10_000

async function shutdownProvider(provider: BasicTracerProvider): Promise<void> {
  try {
    const shutdown = provider.shutdown()
    await raceAttempt({ fn: () => shutdown, timeoutMs: EXPORT_TIMEOUT_MS })
  } catch (error) {
    if (error instanceof TimeoutInterruption) {
      throw new Error(`Telemetry shutdown timed out after ${EXPORT_TIMEOUT_MS}ms`, { cause: error })
    }
    throw error
  }
}

export function setupMokeiTelemetry(params: {
  logStore: LogStore
  telemetryStore: TelemetryStore
  otlp?: { endpoint: string; headers?: Record<string, string> }
  logs?: { level?: LogLevel; file?: boolean }
  reportCategories?: ReadonlyArray<ReadonlyArray<string>>
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
    const localExporter = createTelemetrySpanExporter(params.telemetryStore)
    const localProcessor = new BatchSpanProcessor(localExporter, {
      exportTimeoutMillis: EXPORT_TIMEOUT_MS,
    })
    const processors = [localProcessor]
    rollback.push(() => localProcessor.shutdown())
    if (params.otlp) {
      const processor = new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: params.otlp.endpoint,
          headers: params.otlp.headers,
          timeoutMillis: EXPORT_TIMEOUT_MS,
        }),
        { exportTimeoutMillis: EXPORT_TIMEOUT_MS },
      )
      processors.push(processor)
      rollback.push(() => processor.shutdown())
    }
    const provider = new BasicTracerProvider({
      spanProcessors: processors,
      forceFlushTimeoutMillis: EXPORT_TIMEOUT_MS,
    })
    rollback.length = 0
    rollback.push(() => shutdownProvider(provider))
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
    // Cached tracers retain this provider even if later setup fails.
    installed = true
    rollback.push(() => trace.disable())

    const sink = createLogStoreSink(params.logStore, {
      tracedOnly: true,
      excludeCategories: (params.reportCategories ?? []).map((category) => [...category]),
    })
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
        ...(params.reportCategories ?? []).map((category) => ({
          category: [...category],
          lowestLevel: 'error' as const,
          sinks: ['errors'],
        })),
        { category: ['hozon'], lowestLevel: 'error', sinks: ['errors'] },
      ],
    })
    let disposal: Promise<void> | undefined
    return {
      dispose() {
        disposal ??= settleSequential(
          [
            () => provider.forceFlush(),
            // Exporter shutdown may wait on an HTTP response after the processor's timeout.
            () => shutdownProvider(provider),
            // Never release storage while a local write outlives a provider/export timeout.
            () => localProcessor.shutdown(),
            () => localExporter.shutdown(),
            () => sink.flush(),
            reset,
            () => trace.disable(),
            () => context.disable(),
          ],
          'Failed to dispose mokei telemetry',
        )
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
