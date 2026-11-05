import {
  type AggregatedMessage,
  type MessagePart,
  type ModelProvider,
  ProviderError,
  type ServerMessage,
  type StreamChatRequest,
} from '@mokei/model-provider'
import { SpanStatusCode } from '@opentelemetry/api'
import { describe, expect, test, vi } from 'vitest'

import { type AgentEvent, AgentSession, type ProviderRetryEvent, Session } from '../src/index.js'
import { useTestTracing } from './support/otel.js'

type Types = {
  Message: unknown
  MessagePart: unknown
  Model: { id: string }
  Tool: { name: string }
  ToolCall: unknown
}
type Part = MessagePart<unknown, unknown>

type Attempt = { reject: unknown } | { parts: Array<Part> }

const overloaded = (retryAfterMs = 0) =>
  new ProviderError({ message: 'Overloaded', kind: 'overloaded', provider: 'mock', retryAfterMs })
const authError = () => new ProviderError({ message: 'bad key', kind: 'auth', provider: 'mock' })

const reply = (text: string): Array<Part> => [
  { type: 'text-delta', text, raw: {} },
  { type: 'done', reason: 'stop', inputTokens: 3, outputTokens: 2 },
]

function request(attempt: Attempt): StreamChatRequest<unknown, unknown> {
  const controller = new AbortController()
  let promise: Promise<ReadableStream<Part>>
  if ('reject' in attempt) {
    promise = Promise.reject(attempt.reject)
  } else {
    const parts = [...attempt.parts]
    promise = Promise.resolve(
      new ReadableStream<Part>({
        pull(stream) {
          const next = parts.shift()
          if (next === undefined) stream.close()
          else stream.enqueue(next)
        },
      }),
    )
  }
  promise.catch(() => {})
  return Object.assign(promise, {
    abort: (reason?: unknown) => controller.abort(reason),
    signal: controller.signal,
  }) as StreamChatRequest<unknown, unknown>
}

function createProvider(attempts: Array<Attempt>): ModelProvider<Types> {
  return {
    telemetry: { providerName: 'mock' },
    listModels: async () => [],
    embed: async () => ({ embeddings: [] }),
    streamChat: vi.fn(() => request(attempts.shift() ?? { parts: reply('fallback') })),
    toolFromMCP: (tool) => ({ name: tool.name }),
    aggregateMessage(parts: Array<ServerMessage<unknown, unknown>>): AggregatedMessage<unknown> {
      return {
        source: 'aggregated',
        role: 'assistant',
        text: parts.map((part) => part.text ?? '').join(''),
        toolCalls: [],
        inputTokens: 0,
        outputTokens: 0,
      }
    },
  }
}

const messages = [{ source: 'client' as const, role: 'user' as const, text: 'hi' }]
const fastRetry = { baseDelayMs: 0 }

describe('Session chat retry', () => {
  const { exporter } = useTestTracing()

  test('retries a retryable failure and emits provider-retry', async () => {
    const provider = createProvider([{ reject: overloaded() }, { parts: reply('hello') }])
    const session = new Session<Types>({ providers: { mock: provider }, retry: fastRetry })
    const retries: Array<ProviderRetryEvent> = []
    session.events.on('provider-retry', (event) => {
      retries.push(event)
    })
    const onRetry = vi.fn()

    const result = await session.chat({ provider: 'mock', model: 'm', messages, onRetry })

    expect(result.text).toBe('hello')
    expect(provider.streamChat).toHaveBeenCalledTimes(2)
    expect(retries).toHaveLength(1)
    expect(retries[0]).toMatchObject({ attempt: 1, maxRetries: 2, provider: 'mock', model: 'm' })
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  test('records retries on the one inference span', async () => {
    const provider = createProvider([
      { parts: [{ type: 'error', error: overloaded() }] },
      { parts: reply('ok') },
    ])
    const session = new Session<Types>({ providers: { mock: provider }, retry: fastRetry })

    await session.chat({ provider: 'mock', model: 'm', messages })

    const spans = exporter.getFinishedSpans().filter((span) => span.name === 'chat m')
    expect(spans).toHaveLength(1)
    expect(spans[0]?.status.code).not.toBe(SpanStatusCode.ERROR)
    const events = spans[0]?.events.filter((event) => event.name === 'mokei.retry') ?? []
    expect(events).toHaveLength(1)
    expect(events[0]?.attributes).toMatchObject({
      'mokei.retry.attempt': 1,
      'error.type': 'overloaded',
    })
  })

  test('a final failure ends the span with the error kind', async () => {
    const provider = createProvider([{ reject: authError() }])
    const session = new Session<Types>({ providers: { mock: provider } })

    await expect(session.chat({ provider: 'mock', model: 'm', messages })).rejects.toMatchObject({
      kind: 'auth',
    })
    expect(provider.streamChat).toHaveBeenCalledTimes(1)
    const span = exporter.getFinishedSpans().find((s) => s.name === 'chat m')
    expect(span?.status.code).toBe(SpanStatusCode.ERROR)
    expect(span?.attributes['error.type']).toBe('auth')
  })

  test('retry: false on the session disables retries', async () => {
    const error = overloaded()
    const provider = createProvider([{ reject: error }, { parts: reply('never') }])
    const session = new Session<Types>({ providers: { mock: provider }, retry: false })

    await expect(session.chat({ provider: 'mock', model: 'm', messages })).rejects.toBe(error)
    expect(provider.streamChat).toHaveBeenCalledTimes(1)
  })

  test('a request can override the session policy', async () => {
    const provider = createProvider([{ reject: overloaded() }, { parts: reply('ok') }])
    const session = new Session<Types>({ providers: { mock: provider }, retry: false })

    const result = await session.chat({
      provider: 'mock',
      model: 'm',
      messages,
      retry: fastRetry,
    })
    expect(result.text).toBe('ok')
  })

  test('streamChatTurn does not retry after output', async () => {
    const provider = createProvider([
      {
        parts: [
          { type: 'text-delta', text: 'part', raw: {} },
          { type: 'error', error: overloaded() },
        ],
      },
    ])
    const session = new Session<Types>({ providers: { mock: provider }, retry: fastRetry })
    const turn = session.streamChatTurn({ provider: 'mock', model: 'm', messages })

    await expect(turn.next()).resolves.toMatchObject({ value: { type: 'text-delta' } })
    await expect(turn.next()).rejects.toMatchObject({ kind: 'overloaded' })
    expect(provider.streamChat).toHaveBeenCalledTimes(1)
  })
})

describe('AgentSession retry', () => {
  useTestTracing()

  test('the run survives an overload before output and yields a retry event', async () => {
    const provider = createProvider([
      { parts: [{ type: 'error', error: overloaded() }] },
      { parts: reply('recovered') },
    ])
    const session = new Session<Types>({ providers: { mock: provider }, retry: fastRetry })
    const agent = new AgentSession<Types>({ session, provider: 'mock', model: 'm' })

    const events: Array<AgentEvent> = []
    for await (const event of agent.stream({ prompt: 'hi' })) events.push(event)

    const types = events.map((event) => event.type)
    expect(types).toContain('retry')
    expect(types.indexOf('retry')).toBeLessThan(types.indexOf('text-delta'))
    expect(types.at(-1)).toBe('complete')
    const retry = events.find((event) => event.type === 'retry')
    expect(retry).toMatchObject({ iteration: 1, attempt: 1, maxRetries: 2 })
    const complete = events.at(-1)
    expect(complete).toMatchObject({ result: { text: 'recovered', finishReason: 'complete' } })
  })

  test('the agent retry option overrides the session', async () => {
    const provider = createProvider([{ reject: overloaded() }, { parts: reply('never') }])
    const session = new Session<Types>({ providers: { mock: provider }, retry: fastRetry })
    const agent = new AgentSession<Types>({ session, provider: 'mock', model: 'm', retry: false })

    const events: Array<AgentEvent> = []
    await expect(async () => {
      for await (const event of agent.stream({ prompt: 'hi' })) events.push(event)
    }).rejects.toMatchObject({ kind: 'overloaded' })

    expect(events.map((event) => event.type)).not.toContain('retry')
    expect(events.find((event) => event.type === 'error')).toMatchObject({
      error: { kind: 'overloaded' },
    })
    expect(provider.streamChat).toHaveBeenCalledTimes(1)
  })

  test('the agent timeout ends a retry wait at once', async () => {
    const provider = createProvider([{ reject: overloaded(20_000) }, { parts: reply('late') }])
    const session = new Session<Types>({ providers: { mock: provider } })
    const agent = new AgentSession<Types>({ session, provider: 'mock', model: 'm', timeout: 100 })

    const started = Date.now()
    const events: Array<AgentEvent> = []
    await expect(async () => {
      for await (const event of agent.stream({ prompt: 'hi' })) events.push(event)
    }).rejects.toThrow()

    expect(Date.now() - started).toBeLessThan(5_000)
    const types = events.map((event) => event.type)
    expect(types).toContain('retry')
    expect(types).toContain('timeout')
    expect(provider.streamChat).toHaveBeenCalledTimes(1)
  })
})
