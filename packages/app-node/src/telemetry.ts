import type { StoreProvider } from '@hozon/db'
import type { LogLevel, Sink } from '@logtape/logtape'
import { context, metrics, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { BatchSpanProcessor, type SpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace'
import { raceAttempt, settleSequential, TimeoutInterruption } from '@sozai/async'
import { getConsoleSink, isSetup, reset, setup } from '@sozai/log'
import { createFileSink } from '@tejika/log'

import { LocalTraceRecorder, type TraceRecorderEvent } from './trace-recorder.js'

let installed = false
const EXPORT_TIMEOUT_MS = 10_000

async function shutdownProvider(provider: { shutdown(): Promise<void> }): Promise<void> {
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

function getMetricsEndpoint(otlp: { endpoint: string; metricsEndpoint?: string }): string | null {
  if (otlp.metricsEndpoint != null) return otlp.metricsEndpoint
  return otlp.endpoint.endsWith('/v1/traces')
    ? `${otlp.endpoint.slice(0, -'/v1/traces'.length)}/v1/metrics`
    : null
}

export function setupMokeiTelemetry(params: {
  provider: StoreProvider
  onEvent?: (event: TraceRecorderEvent) => void
  hasListeners?: (type: TraceRecorderEvent['type']) => boolean
  flushIntervalMs?: number
  service?: { name?: string; version?: string }
  otlp?: { endpoint: string; metricsEndpoint?: string; headers?: Record<string, string> }
  logs?: { level?: LogLevel; file?: boolean }
  reportCategories?: ReadonlyArray<ReadonlyArray<string>>
}): { recorder: LocalTraceRecorder; dispose(): Promise<void> } {
  if (installed) throw new Error('Flow telemetry was already installed in this process')
  if (isSetup()) throw new Error('Logging is already configured')
  const metricsEndpoint = params.otlp ? getMetricsEndpoint(params.otlp) : null
  // OTel's public getters return proxies even before registration. Read without probing.
  const registry: unknown = Reflect.get(globalThis, Symbol.for('opentelemetry.js.api.1'))
  if (typeof registry === 'object' && registry !== null) {
    if ('trace' in registry && registry.trace != null) {
      throw new Error('A global tracer provider is already registered')
    }
    if ('context' in registry && registry.context != null) {
      throw new Error('A global context manager is already registered')
    }
    if (metricsEndpoint != null && 'metrics' in registry && registry.metrics != null) {
      throw new Error('A global meter provider is already registered')
    }
  }

  const rollback: Array<() => void | Promise<void>> = []
  try {
    const recorder = new LocalTraceRecorder({
      provider: params.provider,
      onEvent: params.onEvent,
      hasListeners: params.hasListeners,
      flushIntervalMs: params.flushIntervalMs,
      reportCategories: params.reportCategories,
    })
    const processors: Array<SpanProcessor> = [recorder]
    rollback.push(() => recorder.shutdown())
    if (params.otlp) {
      const processor = new BatchSpanProcessor({
        exporter: new OTLPTraceExporter({
          url: params.otlp.endpoint,
          headers: params.otlp.headers,
          timeoutMillis: EXPORT_TIMEOUT_MS,
        }),
        exportTimeoutMillis: EXPORT_TIMEOUT_MS,
      })
      processors.push(processor)
      rollback.push(() => processor.shutdown())
    }
    const resource = resourceFromAttributes({
      'service.name': params.service?.name ?? 'mokei',
      ...(params.service?.version == null ? {} : { 'service.version': params.service.version }),
    })
    const provider = new TracerProvider({
      resource,
      spanProcessors: processors,
    })
    rollback.length = 0
    rollback.push(() => recorder.shutdown())
    rollback.push(() => shutdownProvider(provider))
    let meterProvider: MeterProvider | undefined
    if (params.otlp && metricsEndpoint != null) {
      meterProvider = new MeterProvider({
        resource,
        readers: [
          new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter({
              url: metricsEndpoint,
              headers: params.otlp.headers,
              timeoutMillis: EXPORT_TIMEOUT_MS,
            }),
            exportTimeoutMillis: EXPORT_TIMEOUT_MS,
          }),
        ],
      })
      const registered = meterProvider
      rollback.push(() => shutdownProvider(registered))
    }
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
    if (meterProvider) {
      if (!metrics.setGlobalMeterProvider(meterProvider)) {
        throw new Error('Failed to register the global meter provider')
      }
      rollback.push(() => metrics.disable())
    }

    const sinks: Record<string, Sink> = { capture: recorder.sink, errors: getConsoleSink() }
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
        {
          category: ['mokei', 'mcp', 'notification'],
          lowestLevel: 'debug',
          sinks: ['capture'],
          parentSinks: 'override',
        },
        { category: ['logtape', 'meta'], lowestLevel: 'error', sinks: [] },
        ...[['mokei', 'trace-recorder'], ...(params.reportCategories ?? [])].map((category) => ({
          category: [...category],
          lowestLevel: 'error' as const,
          sinks: ['errors'],
        })),
        { category: ['hozon'], lowestLevel: 'error', sinks: ['errors'] },
      ],
    })
    let disposal: Promise<void> | undefined
    return {
      recorder,
      dispose() {
        disposal ??= settleSequential(
          [
            () => provider.forceFlush({ timeoutMillis: EXPORT_TIMEOUT_MS }),
            // Shutdown exports a final metrics batch.
            ...(meterProvider ? [() => shutdownProvider(meterProvider)] : []),
            // Exporter shutdown may wait on an HTTP response after the processor's timeout.
            () => shutdownProvider(provider),
            // Never release storage while a local write outlives a provider/export timeout.
            () => recorder.shutdown(),
            reset,
            () => trace.disable(),
            () => metrics.disable(),
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
