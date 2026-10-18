import { type Attributes, metrics } from '@opentelemetry/api'
import { AggregationTemporality, MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics'
import { afterAll, beforeAll, beforeEach } from 'vitest'

export type CollectedPoint = { value: unknown; attributes: Attributes; schemaUrl?: string }

class ManualReader extends MetricReader {
  constructor() {
    super({ aggregationTemporalitySelector: () => AggregationTemporality.DELTA })
  }
  async onForceFlush(): Promise<void> {}
  async onShutdown(): Promise<void> {}
}

export function useTestMetrics(): {
  collect(): Promise<Map<string, Array<CollectedPoint>>>
} {
  const reader = new ManualReader()
  const provider = new MeterProvider({ readers: [reader] })
  async function collect() {
    const result = new Map<string, Array<CollectedPoint>>()
    const { resourceMetrics } = await reader.collect()
    for (const scope of resourceMetrics.scopeMetrics) {
      for (const metric of scope.metrics) {
        const points = result.get(metric.descriptor.name) ?? []
        for (const point of metric.dataPoints) {
          points.push({
            value: point.value,
            attributes: point.attributes,
            schemaUrl: scope.scope.schemaUrl,
          })
        }
        result.set(metric.descriptor.name, points)
      }
    }
    return result
  }
  beforeAll(() => {
    metrics.setGlobalMeterProvider(provider)
  })
  // Delta temporality: drain whatever earlier tests recorded.
  beforeEach(async () => {
    await collect()
  })
  afterAll(async () => {
    await provider.shutdown()
    metrics.disable()
  })
  return { collect }
}
