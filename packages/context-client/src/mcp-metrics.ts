import {
  type Attributes,
  createNoopMeter,
  type Histogram,
  type MeterProvider,
  metrics,
} from '@opentelemetry/api'

import { getMokeiMeter, MCP_DURATION_BUCKETS } from './semconv.js'

const METRIC_KEYS = [
  'mcp.method.name',
  'gen_ai.tool.name',
  'gen_ai.prompt.name',
  'gen_ai.operation.name',
  'error.type',
  'rpc.response.status_code',
  'mcp.protocol.version',
  'network.transport',
  'network.protocol.name',
  'server.address',
  'server.port',
] as const

/** Keep only low-cardinality attributes; ids, URIs and `mokei.*` keys never reach metrics. */
export function metricAttributes(spanAttributes: Attributes): Attributes {
  const attributes: Attributes = {}
  for (const key of METRIC_KEYS) {
    const value = spanAttributes[key]
    if (value !== undefined) attributes[key] = value
  }
  return attributes
}

let histograms = new Map<string, Histogram>()
let histogramsProvider: MeterProvider | undefined

/** False while no MeterProvider is registered; callers skip building attributes then. */
export function mcpMetricsEnabled(): boolean {
  return getMokeiMeter('context-client') !== createNoopMeter()
}

function durationHistogram(name: string, description: string): Histogram {
  const provider = metrics.getMeterProvider()
  if (provider !== histogramsProvider) {
    histograms = new Map()
    histogramsProvider = provider
  }
  let histogram = histograms.get(name)
  if (histogram === undefined) {
    histogram = getMokeiMeter('context-client').createHistogram(name, {
      description,
      unit: 's',
      advice: { explicitBucketBoundaries: [...MCP_DURATION_BUCKETS] },
    })
    histograms.set(name, histogram)
  }
  return histogram
}

export function recordMCPOperation(params: {
  side: 'client' | 'server'
  durationS: number
  attributes: Attributes
}): void {
  durationHistogram(
    `mcp.${params.side}.operation.duration`,
    params.side === 'client'
      ? 'Duration of an MCP request or notification as observed by the client'
      : 'MCP request or notification duration as observed on the receiver',
  ).record(params.durationS, params.attributes)
}

export function recordMCPSession(params: { durationS: number; attributes: Attributes }): void {
  durationHistogram(
    'mcp.client.session.duration',
    'Duration of the MCP session as observed on the client',
  ).record(params.durationS, params.attributes)
}
