import type { Tool } from '@mokei/context-protocol'
import type {
  AggregatedMessage,
  Message,
  MessagePart,
  ModelProvider,
  ProviderTelemetry,
  ServerMessage,
  StreamChatParams,
  StreamChatRequest,
} from '@mokei/model-provider'
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import {
  AlwaysOffSampler,
  BasicTracerProvider,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base'
import { fromStream } from '@sozai/generator'
import { afterEach, describe, expect, test, vi } from 'vitest'

import * as content from '../src/gen-ai-content.js'
import { AgentSession, Session, type SessionParams, traceStreamChat } from '../src/index.js'
import { useTestMetrics } from './support/metrics.js'
import { useTestTracing } from './support/otel.js'

vi.mock('../src/gen-ai-content.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/gen-ai-content.js')>()
  return {
    ...original,
    toInputMessages: vi.fn(original.toInputMessages),
    toSystemInstructions: vi.fn(original.toSystemInstructions),
    toOutputMessages: vi.fn(original.toOutputMessages),
    toToolDefinitions: vi.fn(original.toToolDefinitions),
  }
})

type FakeToolCall = { id: string }
type FakeTypes = {
  Message: unknown
  MessagePart: unknown
  Model: unknown
  Tool: { name: string }
  ToolCall: FakeToolCall
}
type Part = MessagePart<unknown, FakeToolCall>

class RateLimitError extends Error {
  constructor() {
    super('slow down')
    this.name = 'RateLimitError'
  }
}

const OPENAI: ProviderTelemetry = {
  providerName: 'openai',
  serverAddress: 'api.openai.com',
  serverPort: 443,
}

const DONE: Part = {
  type: 'done',
  reason: 'tool_calls',
  inputTokens: 12,
  outputTokens: 7,
  responseID: 'resp-1',
  responseModel: 'gpt-x-2026',
}

function createProvider(
  parts: Array<Part>,
  telemetry: ProviderTelemetry | undefined = OPENAI,
  // How the fake stream reacts once the request signal aborts.
  onAbort: 'ignore' | 'close' | 'error' = 'ignore',
): ModelProvider<FakeTypes> & {
  calls: Array<StreamChatParams<unknown, FakeToolCall, { name: string }>>
} {
  const calls: Array<StreamChatParams<unknown, FakeToolCall, { name: string }>> = []
  return {
    calls,
    telemetry,
    listModels: async () => [],
    embed: async () => ({ embeddings: [] }),
    toolFromMCP: (tool: Tool) => ({ name: tool.name }),
    aggregateMessage: (
      messages: Array<ServerMessage<unknown, FakeToolCall>>,
    ): AggregatedMessage<FakeToolCall> => {
      return {
        source: 'aggregated',
        role: 'assistant',
        text: messages.map((m) => m.text ?? '').join(''),
        toolCalls: messages.flatMap((m) => m.toolCalls ?? []),
        doneReason: messages.find((m) => m.doneReason != null)?.doneReason,
        inputTokens: messages.reduce((sum, m) => sum + (m.inputTokens ?? 0), 0),
        outputTokens: messages.reduce((sum, m) => sum + (m.outputTokens ?? 0), 0),
      }
    },
    streamChat: (params) => {
      calls.push(params)
      const controller = new AbortController()
      let index = 0
      const stream = new ReadableStream<Part>({
        async pull(streamController) {
          // A real delay so time-to-first-chunk is measurable.
          await new Promise((resolve) => setTimeout(resolve, 2))
          if (params.signal?.aborted && onAbort !== 'ignore') {
            if (onAbort === 'close') {
              streamController.close()
            } else {
              streamController.error(new DOMException('aborted', 'AbortError'))
            }
            return
          }
          const part = parts[index++]
          if (part == null) {
            streamController.close()
          } else {
            streamController.enqueue(part)
          }
        },
      })
      return Object.assign(Promise.resolve(stream), {
        abort: (reason?: unknown) => controller.abort(reason),
        signal: controller.signal,
      }) as StreamChatRequest<unknown, FakeToolCall>
    },
  }
}

const USER: Array<Message<unknown, FakeToolCall>> = [
  { source: 'client', role: 'system', text: 'Be brief.' },
  { source: 'client', role: 'user', text: 'Hi' },
  {
    source: 'aggregated',
    role: 'assistant',
    text: '',
    toolCalls: [
      {
        id: 'call-1',
        name: 'local:login',
        arguments: '{"apiKey":"sk-123","user":"a"}',
        raw: {
          id: 'call-1',
        },
      },
    ],
    inputTokens: 1,
    outputTokens: 1,
  },
  { source: 'client', role: 'tool', toolCallID: 'call-1', toolCallName: 'local:login', text: 'ok' },
]

async function runTurn(
  provider: ModelProvider<FakeTypes>,
  params: Partial<SessionParams<FakeTypes>> & {
    temperature?: number
    maxTokens?: number
  } = {},
): Promise<AggregatedMessage<FakeToolCall>> {
  const { temperature, maxTokens, ...sessionParams } = params
  const session = new Session<FakeTypes>(sessionParams)
  session.addLocalTool({
    name: 'login',
    description: 'Log in',
    inputSchema: { type: 'object', properties: { user: { type: 'string' } } },
    execute: async () => ({ content: [] }),
  })
  const turn = session.streamChatTurn({
    provider,
    model: 'gpt-x',
    messages: USER,
    temperature,
    maxTokens,
  })
  let result = await turn.next()
  while (!result.done) {
    result = await turn.next()
  }
  return result.value
}

describe('inference spans', () => {
  const { exporter } = useTestTracing()
  const { collect } = useTestMetrics()

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function onlySpan(): ReadableSpan {
    const spans = exporter.getFinishedSpans()
    expect(spans).toHaveLength(1)
    return spans[0] as ReadableSpan
  }

  test('records request and response attributes', async () => {
    const provider = createProvider([{ type: 'text-delta', text: 'Hello', raw: {} }, DONE])
    const aggregated = await runTurn(provider, { temperature: 0.2, maxTokens: 100 })

    expect(aggregated.doneReason).toBe('tool_calls')
    expect(provider.calls[0]).toMatchObject({ temperature: 0.2, maxTokens: 100 })

    const span = onlySpan()
    expect(span.name).toBe('chat gpt-x')
    expect(span.kind).toBe(SpanKind.CLIENT)
    expect(span.status.code).toBe(SpanStatusCode.UNSET)
    expect(span.attributes).toMatchObject({
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': 'openai',
      'gen_ai.request.model': 'gpt-x',
      'gen_ai.request.temperature': 0.2,
      'gen_ai.request.max_tokens': 100,
      'gen_ai.request.stream': true,
      'server.address': 'api.openai.com',
      'server.port': 443,
      'gen_ai.response.id': 'resp-1',
      'gen_ai.response.model': 'gpt-x-2026',
      'gen_ai.response.finish_reasons': ['tool_call'],
      'gen_ai.usage.input_tokens': 12,
      'gen_ai.usage.output_tokens': 7,
    })
    expect(span.attributes['gen_ai.output.type']).toBeUndefined()
    expect(span.attributes['gen_ai.usage.cache_read.input_tokens']).toBeUndefined()
    expect(span.attributes['gen_ai.usage.cache_write.input_tokens']).toBeUndefined()
    expect(span.attributes['gen_ai.usage.reasoning.output_tokens']).toBeUndefined()
    expect(span.attributes['gen_ai.response.time_to_first_chunk']).toBeGreaterThan(0)
    expect(span.attributes['gen_ai.input.messages']).toBeUndefined()
    expect(span.attributes['gen_ai.output.messages']).toBeUndefined()
    expect(span.attributes['gen_ai.system_instructions']).toBeUndefined()
    expect(span.attributes['gen_ai.tool.definitions']).toBeUndefined()
  })

  test('local providers use INTERNAL spans and json output type', async () => {
    const provider = createProvider([DONE], { providerName: 'llama.cpp', local: true })
    const request = {
      model: 'gpt-x',
      messages: USER,
      output: { schema: { type: 'object' } as const },
    }
    const stream = await traceStreamChat({
      telemetry: provider.telemetry,
      request,
      capture: 'off',
      start: () => provider.streamChat(request),
    })
    for await (const _chunk of fromStream(stream)) {
      // drain
    }
    const span = onlySpan()
    expect(span.kind).toBe(SpanKind.INTERNAL)
    expect(span.attributes['gen_ai.provider.name']).toBe('llama.cpp')
    expect(span.attributes['gen_ai.output.type']).toBe('json')
    expect(span.attributes['server.address']).toBeUndefined()
  })

  test('input tokens include cache when the provider excludes them', async () => {
    const provider = createProvider(
      [
        {
          type: 'done',
          reason: 'end_turn',
          inputTokens: 10,
          outputTokens: 3,
          cacheReadInputTokens: 5,
          cacheWriteInputTokens: 2,
          reasoningOutputTokens: 1,
        },
      ],
      { providerName: 'anthropic', inputTokensExcludeCache: true },
    )
    await runTurn(provider)
    const span = onlySpan()
    expect(span.attributes).toMatchObject({
      'gen_ai.usage.input_tokens': 17,
      'gen_ai.usage.cache_read.input_tokens': 5,
      'gen_ai.usage.cache_write.input_tokens': 2,
      'gen_ai.usage.reasoning.output_tokens': 1,
      'gen_ai.response.finish_reasons': ['stop'],
    })
    // Only output-bearing parts are timed.
    expect(span.attributes['gen_ai.response.time_to_first_chunk']).toBeUndefined()
    const metrics = await collect()
    expect(metrics.get('gen_ai.client.inference.time_to_first_chunk') ?? []).toHaveLength(0)
  })

  test('skips content work when the span is not recording', async () => {
    trace.disable()
    const offProvider = new BasicTracerProvider({ sampler: new AlwaysOffSampler() })
    trace.setGlobalTracerProvider(offProvider)
    try {
      vi.mocked(content.toInputMessages).mockClear()
      vi.mocked(content.toSystemInstructions).mockClear()
      vi.mocked(content.toOutputMessages).mockClear()
      vi.mocked(content.toToolDefinitions).mockClear()
      const provider = createProvider([{ type: 'text-delta', text: 'Hi', raw: {} }, DONE])
      await runTurn(provider, { tracing: { payloads: 'on' } })
      expect(content.toInputMessages).not.toHaveBeenCalled()
      expect(content.toSystemInstructions).not.toHaveBeenCalled()
      expect(content.toOutputMessages).not.toHaveBeenCalled()
      expect(content.toToolDefinitions).not.toHaveBeenCalled()
      expect(exporter.getFinishedSpans()).toHaveLength(0)
    } finally {
      // useTestTracing re-registers its provider before the next test.
      trace.disable()
      await offProvider.shutdown()
    }
  })

  async function abortMidStream(onAbort: 'close' | 'error'): Promise<void> {
    const provider = createProvider(
      [
        { type: 'text-delta', text: 'a', raw: {} },
        { type: 'text-delta', text: 'b', raw: {} },
        DONE,
      ],
      OPENAI,
      onAbort,
    )
    const controller = new AbortController()
    const session = new Session<FakeTypes>()
    const turn = session.streamChatTurn({
      provider,
      model: 'gpt-x',
      messages: USER,
      signal: controller.signal,
    })
    const first = await turn.next()
    expect(first.value).toMatchObject({ type: 'text-delta' })
    controller.abort()
    let result = await turn.next()
    while (!result.done) {
      result = await turn.next()
    }
  }

  test('signal abort that closes the stream ends the span as cancelled', async () => {
    await abortMidStream('close')
    const span = onlySpan()
    expect(span.status.code).toBe(SpanStatusCode.ERROR)
    expect(span.attributes['error.type']).toBe('cancelled')
  })

  test('signal abort that errors the stream ends the span as cancelled', async () => {
    await expect(abortMidStream('error')).rejects.toThrow('aborted')
    const span = onlySpan()
    expect(span.status.code).toBe(SpanStatusCode.ERROR)
    expect(span.attributes['error.type']).toBe('cancelled')
  })

  test('captures redacted content when payloads are on', async () => {
    const provider = createProvider([
      { type: 'reasoning-delta', reasoning: 'Think', raw: {} },
      { type: 'text-delta', text: 'Hel', raw: {} },
      { type: 'text-delta', text: 'lo', raw: {} },
      {
        type: 'tool-call',
        toolCalls: [
          {
            id: 'call-2',
            name: 'local:login',
            arguments: '{"user":"b"}',
            raw: {
              id: 'call-2',
            },
          },
        ],
        raw: {},
      },
      DONE,
    ])
    await runTurn(provider, { tracing: { payloads: 'on' } })
    const span = onlySpan()
    const attribute = (key: string) => JSON.parse(span.attributes[key] as string)

    expect(attribute('gen_ai.system_instructions')).toEqual([
      { type: 'text', content: 'Be brief.' },
    ])
    expect(attribute('gen_ai.input.messages')).toEqual([
      { role: 'user', parts: [{ type: 'text', content: 'Hi' }] },
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool_call',
            id: 'call-1',
            name: 'local:login',
            arguments: { apiKey: '[redacted]', user: 'a' },
          },
        ],
      },
      { role: 'tool', parts: [{ type: 'tool_call_response', id: 'call-1', response: 'ok' }] },
    ])
    expect(attribute('gen_ai.output.messages')).toEqual([
      {
        role: 'assistant',
        parts: [
          { type: 'reasoning', content: 'Think' },
          { type: 'text', content: 'Hello' },
          { type: 'tool_call', id: 'call-2', name: 'local:login', arguments: { user: 'b' } },
        ],
        finish_reason: 'tool_call',
      },
    ])
    expect(attribute('gen_ai.tool.definitions')).toEqual([
      {
        type: 'function',
        name: 'local:login',
        description: 'Log in',
        parameters: { type: 'object', properties: { user: { type: 'string' } } },
      },
    ])
    expect(span.attributes['mokei.payload.truncated']).toBeUndefined()
  })

  test('flags truncated content', async () => {
    const provider = createProvider([DONE])
    await runTurn(provider, { tracing: { payloads: 16 } })
    const span = onlySpan()
    expect(span.attributes['mokei.payload.truncated']).toBe(true)
    expect((span.attributes['gen_ai.input.messages'] as string).length).toBeLessThanOrEqual(16)
  })

  test('env var enables content capture without payloads', async () => {
    vi.stubEnv('OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT', 'TRUE')
    const provider = createProvider([DONE])
    await runTurn(provider)
    const span = onlySpan()
    expect(span.attributes['gen_ai.input.messages']).toBeTypeOf('string')
  })

  test('error part ends the span with the error name', async () => {
    const provider = createProvider([{ type: 'error', error: new RateLimitError() }])
    await expect(runTurn(provider)).rejects.toThrow('slow down')
    const span = onlySpan()
    expect(span.status.code).toBe(SpanStatusCode.ERROR)
    expect(span.attributes['error.type']).toBe('RateLimitError')

    const metrics = await collect()
    expect(metrics.get('gen_ai.client.inference.duration')?.[0]?.attributes).toMatchObject({
      'error.type': 'RateLimitError',
    })
  })

  test('generic errors map to _OTHER', async () => {
    const provider = createProvider([{ type: 'error', error: new Error('boom') }])
    await expect(runTurn(provider)).rejects.toThrow('boom')
    expect(onlySpan().attributes['error.type']).toBe('_OTHER')
  })

  test('consumer cancellation ends the span once as cancelled', async () => {
    const provider = createProvider([
      { type: 'text-delta', text: 'a', raw: {} },
      { type: 'text-delta', text: 'b', raw: {} },
      DONE,
    ])
    const session = new Session<FakeTypes>()
    for await (const chunk of session.streamChatTurn({
      provider,
      model: 'gpt-x',
      messages: USER,
    })) {
      expect(chunk.type).toBe('text-delta')
      break
    }
    const span = onlySpan()
    expect(span.status.code).toBe(SpanStatusCode.ERROR)
    expect(span.attributes['error.type']).toBe('cancelled')

    const metrics = await collect()
    expect(metrics.get('gen_ai.client.inference.usage.input_tokens')).toEqual([
      expect.objectContaining({
        value: 0,
        attributes: expect.objectContaining({
          'gen_ai.token.modality': 'unknown',
        }),
      }),
    ])
  })

  test('agent turns record tool definitions', async () => {
    const provider = createProvider([{ type: 'text-delta', text: 'Hi', raw: {} }, DONE])
    const session = new Session<FakeTypes>({ tracing: { payloads: 'on' } })
    session.addLocalTool({
      name: 'login',
      description: 'Log in',
      inputSchema: { type: 'object' },
      execute: async () => ({ content: [] }),
    })
    const agent = new AgentSession<FakeTypes>({ session, provider, model: 'gpt-x' })
    await agent.run({ prompt: 'Hi' })
    const span = exporter.getFinishedSpans().find((s) => s.name === 'chat gpt-x')
    expect(JSON.parse(span?.attributes['gen_ai.tool.definitions'] as string)).toEqual([
      {
        type: 'function',
        name: 'local:login',
        description: 'Log in',
        parameters: { type: 'object' },
      },
    ])
  })

  test('Session.chat is traced', async () => {
    const provider = createProvider([{ type: 'text-delta', text: 'Hi', raw: {} }, DONE])
    const session = new Session<FakeTypes>()
    const message = await session.chat({ provider, model: 'gpt-x', messages: USER, topP: 0.9 })
    expect(message.doneReason).toBe('tool_calls')
    const span = onlySpan()
    expect(span.name).toBe('chat gpt-x')
    expect(span.attributes['gen_ai.request.top_p']).toBe(0.9)
  })

  test('records inference metrics', async () => {
    const provider = createProvider([
      { type: 'text-delta', text: 'a', raw: {} },
      { type: 'text-delta', text: 'b', raw: {} },
      { type: 'text-delta', text: 'c', raw: {} },
      DONE,
    ])
    await runTurn(provider)
    const metrics = await collect()
    const base = {
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': 'openai',
      'gen_ai.request.model': 'gpt-x',
      'server.address': 'api.openai.com',
      'server.port': 443,
    }

    const duration = metrics.get('gen_ai.client.inference.duration')
    expect(duration).toHaveLength(1)
    expect(duration?.[0]?.attributes).toMatchObject({
      ...base,
      'gen_ai.response.model': 'gpt-x-2026',
    })
    expect(duration?.[0]?.attributes['error.type']).toBeUndefined()
    expect(duration?.[0]?.schemaUrl).toBe('https://opentelemetry.io/schemas/gen-ai-dev/1.42.0-dev')

    expect(metrics.get('gen_ai.client.inference.time_to_first_chunk')?.[0]?.value).toMatchObject({
      count: 1,
    })
    // Three content chunks: two after the first; `done` is not an output chunk.
    expect(metrics.get('gen_ai.client.inference.time_per_output_chunk')?.[0]?.value).toMatchObject({
      count: 2,
    })

    expect(metrics.get('gen_ai.client.inference.usage.input_tokens')).toEqual([
      {
        value: 12,
        attributes: expect.objectContaining({ 'gen_ai.token.modality': 'text' }),
        schemaUrl: expect.any(String),
      },
    ])
    expect(metrics.get('gen_ai.client.inference.usage.output_tokens')?.[0]?.value).toBe(7)

    const operation = metrics.get('gen_ai.client.inference.operation.input_tokens')
    expect(operation?.[0]?.value).toMatchObject({ count: 1, sum: 12 })
    expect(operation?.[0]?.attributes['gen_ai.token.modality']).toBeUndefined()
    expect(
      metrics.get('gen_ai.client.inference.operation.output_tokens')?.[0]?.value,
    ).toMatchObject({ sum: 7 })
  })
})
