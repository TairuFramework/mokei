import type { CallToolResult, ElicitRequest, ElicitResult, Tool } from '@mokei/context-protocol'
import type {
  AggregatedMessage,
  MessagePart,
  ModelProvider,
  ServerMessage,
  StreamChatRequest,
} from '@mokei/model-provider'
import { defer } from '@sozai/async'
import { describe, expect, test, vi } from 'vitest'

import { type AgentEvent, AgentSession, Session } from '../src/index.js'

type ToolCall = { id: string; name: string }
type TestTypes = {
  Message: unknown
  MessagePart: unknown
  Model: { id: string }
  Tool: { name: string; description: string }
  ToolCall: ToolCall
}

const question = {
  message: 'pending',
  requestedSchema: { type: 'object' as const, properties: {} },
}

function provider(): ModelProvider<TestTypes> {
  return {
    listModels: vi.fn(async () => [{ id: 'test-model', raw: { id: 'test-model' } }]),
    embed: vi.fn(async () => ({ embeddings: [] })),
    streamChat: vi.fn((params: { messages: Array<{ role: string }> }) => {
      const first = !params.messages.some((message) => message.role === 'tool')
      const parts: Array<MessagePart<unknown, ToolCall>> = first
        ? [
            {
              type: 'tool-call',
              toolCalls: [
                {
                  id: 'ask-1',
                  name: 'questions:ask',
                  arguments: '{}',
                  raw: { id: 'ask-1', name: 'ask' },
                },
              ],
              raw: {},
            },
          ]
        : [{ type: 'text-delta', text: 'done', raw: {} }]
      parts.push({ type: 'done', inputTokens: 1, outputTokens: 1, raw: {} })
      const stream = new ReadableStream<MessagePart<unknown, ToolCall>>({
        start(controller) {
          for (const part of parts) controller.enqueue(part)
          controller.close()
        },
      })
      return Object.assign(Promise.resolve(stream), {
        signal: new AbortController().signal,
        abort: () => undefined,
      }) as StreamChatRequest<unknown, ToolCall>
    }),
    aggregateMessage: vi.fn(
      (parts: Array<ServerMessage<unknown, ToolCall>>): AggregatedMessage<ToolCall> => ({
        source: 'aggregated',
        role: 'assistant',
        text: parts.map((part) => part.text ?? '').join(''),
        toolCalls: parts.flatMap((part) => part.toolCalls ?? []),
        inputTokens: 1,
        outputTokens: 1,
      }),
    ),
    toolFromMCP: vi.fn((tool: Tool) => ({ name: tool.name, description: tool.description ?? '' })),
  }
}

function harness(
  options: {
    forward?: boolean
    elicit?: true | ((request: { signal: AbortSignal }) => Promise<ElicitResult>)
    handler?: (
      client: {
        elicit: (
          params: ElicitRequest['params'] & { signal?: AbortSignal },
        ) => Promise<ElicitResult>
      },
      signal: AbortSignal,
    ) => Promise<CallToolResult>
  } = {},
) {
  const session = new Session<TestTypes>({ elicit: options.elicit ?? true })
  session.contextHost.addDirectContext({
    key: 'questions',
    protocolVersion: '2025-11-25',
    tools: [
      {
        id: 'questions:ask',
        tool: { name: 'ask', inputSchema: { type: 'object', properties: {} } },
        enabled: true,
      },
    ],
    config: {
      name: 'questions',
      version: '1.0.0',
      protocolVersions: ['2025-11-25'],
      tools: {
        ask: {
          description: 'Ask',
          inputSchema: { type: 'object' as const, properties: {} },
          handler: async ({
            client,
            signal,
          }: {
            client: {
              elicit: (
                params: ElicitRequest['params'] & { signal?: AbortSignal },
              ) => Promise<ElicitResult>
            }
            signal: AbortSignal
          }) => {
            if (options.handler) return options.handler(client, signal)
            const result = await client.elicit({
              ...question,
              ...(options.forward ? { signal } : {}),
            })
            return { content: [{ type: 'text' as const, text: result.action }] }
          },
        },
      },
    },
  })
  return { session, provider: provider() }
}

function elicitation(events: Array<AgentEvent>): Array<AgentEvent> {
  return events.filter((event) => event.type.startsWith('elicitation-'))
}

function expectOneError(events: Array<AgentEvent>) {
  const pair = elicitation(events)
  expect(pair.map((event) => event.type)).toEqual(['elicitation-request', 'elicitation-error'])
  if (pair[0]?.type !== 'elicitation-request' || pair[1]?.type !== 'elicitation-error') {
    throw new Error('Expected an elicitation request and error')
  }
  expect(pair[1].requestID).toBe(pair[0].requestID)
}

async function untilRequest(stream: AsyncGenerator<AgentEvent>): Promise<Array<AgentEvent>> {
  const seen: Array<AgentEvent> = []
  for (;;) {
    const next = await stream.next()
    if (next.done) throw new Error('Stream ended before elicitation')
    seen.push(next.value)
    if (next.value.type === 'elicitation-request') return seen
  }
}

describe('AgentSession elicitation abort', () => {
  test('stream return aborts pending elicitation', async () => {
    const env = harness()
    const answer = defer<ElicitResult>()
    const observed: Array<AgentEvent> = []
    let callbackSignal: AbortSignal | undefined
    const agent = new AgentSession({
      session: env.session,
      provider: env.provider,
      model: 'test-model',
      onElicitation: ({ signal }) => {
        callbackSignal = signal
        return answer.promise
      },
      onEvent: (event) => observed.push(event),
    })
    const stream = agent.stream({ prompt: 'ask' })
    await untilRequest(stream)
    await stream.return(undefined)
    await vi.waitFor(() => expectOneError(observed))
    expect(callbackSignal?.aborted).toBe(true)
    answer.resolve({ action: 'accept', content: {} })
    await Promise.resolve()
    expectOneError(observed)
    await agent.dispose()
    await env.session.dispose()
  })

  test('caller abort aborts pending elicitation', async () => {
    const env = harness()
    const caller = new AbortController()
    const answer = defer<ElicitResult>()
    const observed: Array<AgentEvent> = []
    let callbackSignal: AbortSignal | undefined
    const agent = new AgentSession({
      session: env.session,
      provider: env.provider,
      model: 'test-model',
      onElicitation: ({ signal }) => {
        callbackSignal = signal
        return answer.promise
      },
      onEvent: (event) => observed.push(event),
    })
    const stream = agent.stream({ prompt: 'ask', signal: caller.signal })
    await untilRequest(stream)
    const reason = new Error('caller stopped')
    caller.abort(reason)
    await vi.waitFor(() => expectOneError(observed))
    expect(callbackSignal?.reason).toBe(reason)
    const rest: Array<AgentEvent> = []
    for await (const event of stream) rest.push(event)
    expect(rest.find((event) => event.type === 'tool-call-error')).toBeDefined()
    await agent.dispose()
    await env.session.dispose()
  })

  test('tool timeout aborts pending elicitation', async () => {
    vi.useFakeTimers()
    const env = harness()
    const answer = defer<ElicitResult>()
    const observed: Array<AgentEvent> = []
    let callbackSignal: AbortSignal | undefined
    const agent = new AgentSession({
      session: env.session,
      provider: env.provider,
      model: 'test-model',
      toolTimeout: 20,
      onElicitation: ({ signal }) => {
        callbackSignal = signal
        return answer.promise
      },
      onEvent: (event) => observed.push(event),
    })
    try {
      const streamed: Array<AgentEvent> = []
      for await (const event of agent.stream({ prompt: 'ask' })) {
        streamed.push(event)
        if (event.type === 'elicitation-request') await vi.advanceTimersByTimeAsync(20)
      }
      expectOneError(streamed)
      expectOneError(observed)
      expect(callbackSignal?.aborted).toBe(true)
      expect(callbackSignal?.reason).not.toEqual(new Error('Tool call settled'))
      expect(streamed.find((event) => event.type === 'tool-call-error')).toMatchObject({
        error: { name: 'ToolCallTimeoutError' },
      })
    } finally {
      vi.useRealTimers()
      await agent.dispose()
      await env.session.dispose()
    }
  })

  test('cancelToolCall aborts pending elicitation', async () => {
    const env = harness()
    const answer = defer<ElicitResult>()
    const observed: Array<AgentEvent> = []
    let callbackSignal: AbortSignal | undefined
    const agent = new AgentSession({
      session: env.session,
      provider: env.provider,
      model: 'test-model',
      onElicitation: ({ signal }) => {
        callbackSignal = signal
        return answer.promise
      },
      onEvent: (event) => observed.push(event),
    })
    const streamed: Array<AgentEvent> = []
    for await (const event of agent.stream({ prompt: 'ask' })) {
      streamed.push(event)
      if (event.type === 'elicitation-request') agent.cancelToolCall()
    }
    expectOneError(streamed)
    expectOneError(observed)
    expect(callbackSignal?.aborted).toBe(true)
    expect(callbackSignal?.reason).not.toEqual(new Error('Tool call settled'))
    expect(streamed.find((event) => event.type === 'tool-call-error')).toMatchObject({
      error: { name: 'ToolCallCancelledError' },
    })
    await agent.dispose()
    await env.session.dispose()
  })

  test('2025 forwarded and unforwarded server signals both abort', async () => {
    for (const forward of [true, false]) {
      const env = harness({ forward })
      const answer = defer<ElicitResult>()
      const observed: Array<AgentEvent> = []
      let callbackSignal: AbortSignal | undefined
      const agent = new AgentSession({
        session: env.session,
        provider: env.provider,
        model: 'test-model',
        onElicitation: ({ signal }) => {
          callbackSignal = signal
          return answer.promise
        },
        onEvent: (event) => observed.push(event),
      })
      const streamed: Array<AgentEvent> = []
      for await (const event of agent.stream({ prompt: 'ask' })) {
        streamed.push(event)
        if (event.type === 'elicitation-request') agent.cancelToolCall()
      }
      expectOneError(streamed)
      expectOneError(observed)
      expect(callbackSignal?.aborted).toBe(true)
      expect(streamed.find((event) => event.type === 'tool-call-error')).toMatchObject({
        error: { name: 'ToolCallCancelledError' },
      })
      await agent.dispose()
      await env.session.dispose()
    }
  })

  test('breaking after request still pairs onEvent with error', async () => {
    const env = harness()
    const answer = defer<ElicitResult>()
    const observed: Array<AgentEvent> = []
    const agent = new AgentSession({
      session: env.session,
      provider: env.provider,
      model: 'test-model',
      onElicitation: () => answer.promise,
      onEvent: (event) => observed.push(event),
    })
    for await (const event of agent.stream({ prompt: 'ask' })) {
      if (event.type === 'elicitation-request') break
    }
    await vi.waitFor(() => expectOneError(observed))
    await agent.dispose()
    await env.session.dispose()
  })

  test('fallback base handler aborts with the tool', async () => {
    const answer = defer<ElicitResult>()
    let baseSignal: AbortSignal | undefined
    const env = harness({
      elicit: ({ signal }) => {
        baseSignal = signal
        return answer.promise
      },
    })
    const observed: Array<AgentEvent> = []
    const agent = new AgentSession({
      session: env.session,
      provider: env.provider,
      model: 'test-model',
      onEvent: (event) => observed.push(event),
    })
    const streamed: Array<AgentEvent> = []
    for await (const event of agent.stream({ prompt: 'ask' })) {
      streamed.push(event)
      if (event.type === 'elicitation-request') agent.cancelToolCall()
    }
    expectOneError(streamed)
    expectOneError(observed)
    expect(baseSignal?.aborted).toBe(true)
    expect(baseSignal?.reason).not.toEqual(new Error('Tool call settled'))
    answer.resolve({ action: 'accept', content: {} })
    await Promise.resolve()
    expectOneError(observed)
    await agent.dispose()
    await env.session.dispose()
  })

  test('late callback result after abort is ignored', async () => {
    const env = harness()
    const answer = defer<ElicitResult>()
    const observed: Array<AgentEvent> = []
    const agent = new AgentSession({
      session: env.session,
      provider: env.provider,
      model: 'test-model',
      onElicitation: () => answer.promise,
      onEvent: (event) => observed.push(event),
    })
    const stream = agent.stream({ prompt: 'ask' })
    await untilRequest(stream)
    agent.cancelToolCall()
    await vi.waitFor(() => expectOneError(observed))
    answer.resolve({ action: 'accept', content: {} })
    await Promise.resolve()
    expectOneError(observed)
    const remaining: Array<AgentEvent> = []
    for await (const event of stream) remaining.push(event)
    expect(remaining.some((event) => event.type === 'elicitation-response')).toBe(false)
    await agent.dispose()
    await env.session.dispose()
  })

  test('rejects an already-aborted elicitation before invoking the callback', async () => {
    const env = harness()
    const requestController = new AbortController()
    requestController.abort(new Error('request already stopped'))
    const observed: Array<AgentEvent> = []
    const callback = vi.fn(() => ({ action: 'decline' as const }))
    const host = env.session.contextHost
    const install = host.handleElicitation.bind(host)
    let dispatch: Parameters<typeof host.handleElicitation>[0] | undefined
    const capture = vi.spyOn(host, 'handleElicitation').mockImplementation((handler) => {
      dispatch = handler
      return install(handler)
    })
    const agent = new AgentSession({
      session: env.session,
      provider: env.provider,
      model: 'test-model',
      onElicitation: callback,
      onEvent: (event) => observed.push(event),
    })
    capture.mockRestore()
    if (dispatch == null) throw new Error('Elicitation handler not installed')
    await Promise.resolve(
      dispatch(
        { key: 'questions', params: question, signal: requestController.signal },
        async () => ({ action: 'decline' }),
      ),
    ).catch(() => undefined)
    expect(callback).not.toHaveBeenCalled()
    expectOneError(observed)
    await agent.dispose()
    await env.session.dispose()
  })

  test('agent disposal aborts an unattributed elicitation', async () => {
    const answer = defer<ElicitResult>()
    const started = defer<void>()
    const env = harness({ elicit: true })
    const observed: Array<AgentEvent> = []
    let callbackSignal: AbortSignal | undefined
    const agent = new AgentSession({
      session: env.session,
      provider: env.provider,
      model: 'test-model',
      onElicitation: ({ signal }) => {
        callbackSignal = signal
        started.resolve()
        return answer.promise
      },
      onEvent: (event) => observed.push(event),
    })
    const call = env.session.contextHost.callTool({ key: 'questions', name: 'ask', arguments: {} })
    await started.promise
    await agent.dispose()
    await call.catch(() => undefined)
    expect(callbackSignal?.aborted).toBe(true)
    expectOneError(observed)
    answer.resolve({ action: 'accept', content: {} })
    await Promise.resolve()
    expectOneError(observed)
    await env.session.dispose()
  })
})
