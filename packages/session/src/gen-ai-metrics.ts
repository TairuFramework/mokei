import {
  AGENT_COUNT_BUCKETS,
  AGENT_DURATION_BUCKETS,
  GEN_AI_DURATION_BUCKETS,
  getMokeiMeter,
  TOKEN_BUCKETS,
} from '@mokei/context-client'
import {
  type Attributes,
  type Counter,
  createNoopMeter,
  type Histogram,
  type MeterProvider,
  metrics,
} from '@opentelemetry/api'

const SCOPE = 'session'

type Instruments = {
  duration: Histogram
  timeToFirstChunk: Histogram
  timePerOutputChunk: Histogram
  usage: Record<TokenKind, Counter>
  operationInputTokens: Histogram
  operationOutputTokens: Histogram
}

export type TokenKind =
  | 'input'
  | 'output'
  | 'cache_read.input'
  | 'cache_write.input'
  | 'reasoning.output'

const TOKEN_KINDS: Array<TokenKind> = [
  'input',
  'output',
  'cache_read.input',
  'cache_write.input',
  'reasoning.output',
]

let instruments: Instruments | undefined
let instrumentsProvider: MeterProvider | undefined

/** False while no MeterProvider is registered; callers skip building attributes then. */
export function genAIMetricsEnabled(): boolean {
  return getMokeiMeter(SCOPE) !== createNoopMeter()
}

function durationHistogram(name: string, description: string): Histogram {
  return getMokeiMeter(SCOPE).createHistogram(name, {
    description,
    unit: 's',
    advice: { explicitBucketBoundaries: [...GEN_AI_DURATION_BUCKETS] },
  })
}

function tokenHistogram(name: string, description: string): Histogram {
  return getMokeiMeter(SCOPE).createHistogram(name, {
    description,
    unit: '{token}',
    advice: { explicitBucketBoundaries: [...TOKEN_BUCKETS] },
  })
}

// Instruments are bound to a meter; rebuild them when the global MeterProvider changes.
export function genAIInstruments(): Instruments {
  const provider = metrics.getMeterProvider()
  if (instruments === undefined || provider !== instrumentsProvider) {
    const meter = getMokeiMeter(SCOPE)
    instrumentsProvider = provider
    instruments = {
      duration: durationHistogram(
        'gen_ai.client.inference.duration',
        'Duration of a GenAI inference operation',
      ),
      timeToFirstChunk: durationHistogram(
        'gen_ai.client.inference.time_to_first_chunk',
        'Time to receive the first chunk of a streaming response',
      ),
      timePerOutputChunk: durationHistogram(
        'gen_ai.client.inference.time_per_output_chunk',
        'Time between consecutive chunks of a streaming response',
      ),
      usage: Object.fromEntries(
        TOKEN_KINDS.map((kind) => [
          kind,
          meter.createCounter(`gen_ai.client.inference.usage.${kind}_tokens`, {
            description: `Number of ${kind.replace('.', ' ')} tokens used`,
            unit: '{token}',
          }),
        ]),
      ) as Record<TokenKind, Counter>,
      operationInputTokens: tokenHistogram(
        'gen_ai.client.inference.operation.input_tokens',
        'Input tokens used per inference operation',
      ),
      operationOutputTokens: tokenHistogram(
        'gen_ai.client.inference.operation.output_tokens',
        'Output tokens used per inference operation',
      ),
    }
  }
  return instruments
}

export type InferenceUsage = Partial<Record<TokenKind, number>>

export function recordInferenceUsage(
  usage: InferenceUsage | undefined,
  attributes: Attributes,
): void {
  const { usage: counters, operationInputTokens, operationOutputTokens } = genAIInstruments()
  if (usage === undefined) {
    const unknown = { ...attributes, 'gen_ai.token.modality': 'unknown' }
    counters.input.add(0, unknown)
    counters.output.add(0, unknown)
    return
  }
  const text = { ...attributes, 'gen_ai.token.modality': 'text' }
  for (const kind of TOKEN_KINDS) {
    const value = usage[kind]
    // Input and output are always reported; the breakdown counters only when present.
    if (value !== undefined && (value > 0 || kind === 'input' || kind === 'output')) {
      counters[kind].add(value, text)
    }
  }
  operationInputTokens.record(usage.input ?? 0, attributes)
  operationOutputTokens.record(usage.output ?? 0, attributes)
}

type AgentInstruments = {
  duration: Histogram
  inferenceCalls: Histogram
  toolCalls: Histogram
  toolDuration: Histogram
}

let agentInstruments: AgentInstruments | undefined
let agentInstrumentsProvider: MeterProvider | undefined

function countHistogram(name: string, description: string, unit: string): Histogram {
  return getMokeiMeter(SCOPE).createHistogram(name, {
    description,
    unit,
    advice: { explicitBucketBoundaries: [...AGENT_COUNT_BUCKETS] },
  })
}

export function genAIAgentInstruments(): AgentInstruments {
  const provider = metrics.getMeterProvider()
  if (agentInstruments === undefined || provider !== agentInstrumentsProvider) {
    agentInstrumentsProvider = provider
    agentInstruments = {
      duration: getMokeiMeter(SCOPE).createHistogram('gen_ai.invoke_agent.duration', {
        description: 'Duration of an agent invocation',
        unit: 's',
        advice: { explicitBucketBoundaries: [...AGENT_DURATION_BUCKETS] },
      }),
      inferenceCalls: countHistogram(
        'gen_ai.invoke_agent.inference_calls',
        'Inference calls made per agent invocation',
        '{inference_call}',
      ),
      toolCalls: countHistogram(
        'gen_ai.invoke_agent.tool_calls',
        'Tool calls made per agent invocation',
        '{tool_call}',
      ),
      toolDuration: durationHistogram(
        'gen_ai.execute_tool.duration',
        'Duration of a tool execution',
      ),
    }
  }
  return agentInstruments
}
