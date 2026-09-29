import type {
  CallToolResult,
  ElicitRequest,
  ElicitResult,
  InputResponse,
  Tool,
} from '@mokei/context-protocol'
import type {
  AggregatedMessage,
  FunctionToolCall,
  MessagePart,
  ModelProvider,
  ServerMessage as ProviderServerMessage,
  StreamChatRequest,
} from '@mokei/model-provider'
import { defer } from '@sozai/async'
import { describe, expect, test, vi } from 'vitest'

import { type AgentEvent, AgentSession, Session } from '../src/index.js'

type TestToolCall = { id: string; name: string }
type TestTypes = {
  Message: unknown
  MessagePart: unknown
  Model: { id: string }
  Tool: { name: string; description: string }
  ToolCall: TestToolCall
}

function createProvider(toolName = 'questions:ask'): ModelProvider<TestTypes> {
  return {
    listModels: vi.fn(async () => [{ id: 'test-model', raw: { id: 'test-model' } }]),
    embed: vi.fn(async () => ({ embeddings: [] })),
    streamChat: vi.fn((params: { messages: Array<{ role: string }> }) => {
      const firstTurn = !params.messages.some((message) => message.role === 'tool')
      const parts: Array<MessagePart<unknown, TestToolCall>> = firstTurn
        ? [
            {
              type: 'tool-call',
              toolCalls: [
                {
                  id: 'ask-1',
                  name: toolName,
                  arguments: '{}',
                  raw: { id: 'ask-1', name: 'ask' },
                },
              ],
              raw: {},
            },
          ]
        : [{ type: 'text-delta', text: 'done', raw: {} }]
      parts.push({ type: 'done', inputTokens: 1, outputTokens: 1, raw: {} })
      const stream = new ReadableStream<MessagePart<unknown, TestToolCall>>({
        start(controller) {
          for (const part of parts) controller.enqueue(part)
          controller.close()
        },
      })
      return Object.assign(Promise.resolve(stream), {
        signal: new AbortController().signal,
        abort: () => undefined,
      }) as StreamChatRequest<unknown, TestToolCall>
    }),
    aggregateMessage: vi.fn(
      (
        parts: Array<ProviderServerMessage<unknown, TestToolCall>>,
      ): AggregatedMessage<TestToolCall> => ({
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

function createHarness(
  handler?: (client: {
    elicit: (params: ElicitRequest['params']) => Promise<ElicitResult>
  }) => CallToolResult | Promise<CallToolResult>,
) {
  const session = new Session<TestTypes>({ elicit: true })
  session.contextHost.addDirectContext({
    key: 'questions',
    protocolVersion: '2025-11-25',
    tools: [
      {
        id: 'questions:ask',
        tool: { name: 'ask', description: 'Ask', inputSchema: { type: 'object', properties: {} } },
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
          }: {
            client: { elicit: (params: ElicitRequest['params']) => Promise<ElicitResult> }
          }) => {
            if (handler != null) return await handler(client)
            const result = await client.elicit({
              message: 'tool question',
              requestedSchema: { type: 'object', properties: {} },
            })
            return { content: [{ type: 'text' as const, text: result.action }] }
          },
        },
      },
      prompts: {
        setup: {
          description: 'Setup',
          handler: async ({
            client,
          }: {
            client: { elicit: (params: ElicitRequest['params']) => Promise<ElicitResult> }
          }) => {
            await client.elicit({
              message: 'setup question',
              requestedSchema: { type: 'object', properties: {} },
            })
            return { messages: [] }
          },
        },
      },
    },
  })
  const provider = createProvider()
  return {
    session,
    provider,
  }
}

function relevant(events: Array<AgentEvent>): Array<AgentEvent> {
  return events.filter(
    (event) =>
      event.type === 'tool-call-start' ||
      event.type === 'tool-call-complete' ||
      event.type.startsWith('elicitation-'),
  )
}

function expectPairedAndOrdered(streamed: Array<AgentEvent>, observed: Array<AgentEvent>) {
  const streamEvents = relevant(streamed)
  const observedEvents = relevant(observed)
  expect(streamEvents).toEqual(observedEvents)
  const requests = streamEvents.filter((event) => event.type === 'elicitation-request')
  const terminals = streamEvents.filter(
    (event) => event.type === 'elicitation-response' || event.type === 'elicitation-error',
  )
  expect(requests).toHaveLength(terminals.length)
  for (const request of requests) {
    if (request.type !== 'elicitation-request') continue
    expect(terminals.filter((event) => event.requestID === request.requestID)).toHaveLength(1)
  }
  const terminalIndex = streamEvents.findIndex(
    (event) => event.type === 'tool-call-complete' || event.type === 'tool-call-error',
  )
  expect(terminalIndex).toBe(streamEvents.length - 1)
  expect(streamEvents[0]?.type).toBe('tool-call-start')
}

describe('AgentSession elicitation stream', () => {
  test('response at tool settlement precedes tool terminal', async () => {
    const callbackStarted = defer<void>()
    const answer = defer<ElicitResult>()
    const harness = createHarness(async (client) => {
      void client
        .elicit({
          message: 'at settlement',
          requestedSchema: { type: 'object', properties: {} },
        })
        .catch(() => undefined)
      await callbackStarted.promise
      answer.resolve({ action: 'accept', content: {} })
      return { content: [] }
    })
    const observed: Array<AgentEvent> = []
    const agent = new AgentSession({
      session: harness.session,
      provider: harness.provider,
      model: 'test-model',
      onElicitation: () => {
        callbackStarted.resolve()
        return answer.promise
      },
      onEvent: (event) => observed.push(event),
    })
    const streamed: Array<AgentEvent> = []
    for await (const event of agent.stream({ prompt: 'ask' })) streamed.push(event)
    expectPairedAndOrdered(streamed, observed)
    expect(relevant(streamed).map((event) => event.type)).toEqual([
      'tool-call-start',
      'elicitation-request',
      'elicitation-response',
      'tool-call-complete',
    ])
    await agent.dispose()
    await harness.session.dispose()
  })

  test('several requests in one MRTR round preserve stream and onEvent order', async () => {
    const session = new Session<TestTypes>({ elicit: true })
    session.contextHost.addDirectContext({
      key: 'questions',
      protocolVersion: '2026-07-28',
      tools: [
        {
          id: 'questions:ask',
          tool: {
            name: 'ask',
            description: 'Ask',
            inputSchema: { type: 'object', properties: {} },
          },
          enabled: true,
        },
      ],
      config: {
        name: 'questions',
        version: '1.0.0',
        protocolVersions: ['2026-07-28'],
        tools: {
          ask: {
            description: 'Ask',
            inputSchema: { type: 'object' as const, properties: {} },
            handler: ({ inputResponses }: { inputResponses?: Record<string, InputResponse> }) => {
              if (inputResponses != null) {
                expect(inputResponses).toMatchObject({
                  first: { action: 'decline' },
                  second: { action: 'decline' },
                })
                return { content: [] }
              }
              return {
                resultType: 'input_required' as const,
                inputRequests: {
                  first: {
                    method: 'elicitation/create' as const,
                    params: {
                      message: 'first',
                      requestedSchema: { type: 'object' as const, properties: {} },
                    },
                  },
                  second: {
                    method: 'elicitation/create' as const,
                    params: {
                      message: 'second',
                      requestedSchema: { type: 'object' as const, properties: {} },
                    },
                  },
                },
              }
            },
          },
        },
      },
    })
    const observed: Array<AgentEvent> = []
    const agent = new AgentSession({
      session,
      provider: createProvider(),
      model: 'test-model',
      onElicitation: () => ({ action: 'decline' }),
      onEvent: (event) => observed.push(event),
    })
    const streamed: Array<AgentEvent> = []
    for await (const event of agent.stream({ prompt: 'ask' })) streamed.push(event)
    expectPairedAndOrdered(streamed, observed)
    expect(relevant(streamed).map((event) => event.type)).toEqual([
      'tool-call-start',
      'elicitation-request',
      'elicitation-request',
      'elicitation-response',
      'elicitation-response',
      'tool-call-complete',
    ])
    await agent.dispose()
    await session.dispose()
  })

  test('2025 tool returning before its elicitation settles aborts the request', async () => {
    const callbackStarted = defer<void>()
    const answer = defer<ElicitResult>()
    let callbackSignal: AbortSignal | undefined
    const harness = createHarness(async (client) => {
      void client
        .elicit({
          message: 'left pending',
          requestedSchema: { type: 'object', properties: {} },
        })
        .catch(() => undefined)
      await callbackStarted.promise
      return { content: [] }
    })
    const observed: Array<AgentEvent> = []
    const agent = new AgentSession({
      session: harness.session,
      provider: harness.provider,
      model: 'test-model',
      onElicitation: ({ signal }) => {
        callbackSignal = signal
        callbackStarted.resolve()
        return answer.promise
      },
      onEvent: (event) => observed.push(event),
    })
    const streamed: Array<AgentEvent> = []
    for await (const event of agent.stream({ prompt: 'ask' })) streamed.push(event)
    expectPairedAndOrdered(streamed, observed)
    expect(relevant(streamed).map((event) => event.type)).toEqual([
      'tool-call-start',
      'elicitation-request',
      'elicitation-error',
      'tool-call-complete',
    ])
    expect(callbackSignal?.aborted).toBe(true)
    expect(callbackSignal?.reason).toEqual(new Error('Tool call settled'))
    await agent.dispose()
    await harness.session.dispose()
  })

  test('keeps attribution through the settlement barrier', async () => {
    const firstStarted = defer<void>()
    const secondStarted = defer<void>()
    const firstAnswer = defer<ElicitResult>()
    const secondAnswer = defer<ElicitResult>()
    let askAgain: (() => Promise<ElicitResult>) | undefined
    const harness = createHarness(async (client) => {
      askAgain = () =>
        client.elicit({
          message: 'second',
          requestedSchema: { type: 'object', properties: {} },
        })
      void client
        .elicit({
          message: 'first',
          requestedSchema: { type: 'object', properties: {} },
        })
        .catch(() => undefined)
      await firstStarted.promise
      return { content: [] }
    })
    const observed: Array<AgentEvent> = []
    const agent = new AgentSession({
      session: harness.session,
      provider: harness.provider,
      model: 'test-model',
      onElicitation: (request) => {
        if (request.params.message === 'first') {
          firstStarted.resolve()
          return firstAnswer.promise
        }
        secondStarted.resolve()
        return secondAnswer.promise
      },
      onEvent: (event) => observed.push(event),
    })
    const streamed: Array<AgentEvent> = []
    for await (const event of agent.stream({ prompt: 'ask' })) {
      streamed.push(event)
      if (
        event.type === 'elicitation-error' &&
        streamed.filter((seen) => seen.type === 'elicitation-error').length === 1
      ) {
        if (askAgain == null) throw new Error('Second elicitation is unavailable')
        void askAgain().catch(() => undefined)
        await secondStarted.promise
      }
    }
    expectPairedAndOrdered(streamed, observed)
    expect(relevant(streamed).map((event) => event.type)).toEqual([
      'tool-call-start',
      'elicitation-request',
      'elicitation-error',
      'elicitation-request',
      'elicitation-error',
      'tool-call-complete',
    ])
    expect(
      relevant(streamed)
        .filter((event) => event.type.startsWith('elicitation-'))
        .every((event) => 'toolCall' in event && event.toolCall?.name === 'questions:ask'),
    ).toBe(true)
    await agent.dispose()
    await harness.session.dispose()
  })
  test('local tools do not attribute elicitation from the local context', async () => {
    const harness = createHarness()
    harness.provider = createProvider('local:run')
    harness.session.contextHost.addDirectContext({
      key: 'local',
      protocolVersion: '2025-11-25',
      config: {
        name: 'local',
        version: '1.0.0',
        protocolVersions: ['2025-11-25'],
        tools: {
          ask: {
            description: 'Ask',
            inputSchema: { type: 'object' as const, properties: {} },
            handler: async ({
              client,
            }: {
              client: { elicit: (params: ElicitRequest['params']) => Promise<ElicitResult> }
            }) => {
              await client.elicit({
                message: 'local context question',
                requestedSchema: { type: 'object', properties: {} },
              })
              return { content: [] }
            },
          },
        },
      },
    })
    harness.session.contextHost.addLocalTool({
      name: 'run',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        await harness.session.contextHost.callTool({ key: 'local', name: 'ask', arguments: {} })
        return { content: [] }
      },
    })
    const observed: Array<AgentEvent> = []
    const agent = new AgentSession({
      session: harness.session,
      provider: harness.provider,
      model: 'test-model',
      onElicitation: () => ({ action: 'decline' }),
      onEvent: (event) => observed.push(event),
    })
    const streamed: Array<AgentEvent> = []
    for await (const event of agent.stream({ prompt: 'run' })) streamed.push(event)

    const elicitationEvents = observed.filter((event) => event.type.startsWith('elicitation-'))
    expect(elicitationEvents.map((event) => event.type)).toEqual([
      'elicitation-request',
      'elicitation-response',
    ])
    expect(elicitationEvents.every((event) => !('toolCall' in event))).toBe(true)
    expect(streamed.some((event) => event.type.startsWith('elicitation-'))).toBe(false)
    expect(relevant(streamed).map((event) => event.type)).toEqual([
      'tool-call-start',
      'tool-call-complete',
    ])
    expect(
      relevant(streamed).every(
        (event) => 'toolCall' in event && event.toolCall?.name === 'local:run',
      ),
    ).toBe(true)
    await agent.dispose()
    await harness.session.dispose()
  })

  test('yields elicitation-request before its callback resolves', async () => {
    const answer = defer<ElicitResult>()
    const harness = createHarness()
    const agent = new AgentSession({
      session: harness.session,
      provider: harness.provider,
      model: 'test-model',
      onElicitation: () => answer.promise,
    })
    const events: Array<AgentEvent> = []
    const timer = setTimeout(() => answer.resolve({ action: 'decline' }), 2000)
    try {
      for await (const event of agent.stream({ prompt: 'ask' })) {
        events.push(event)
        if (event.type === 'elicitation-request') answer.resolve({ action: 'accept', content: {} })
      }
      expect(relevant(events).map((event) => event.type)).toEqual([
        'tool-call-start',
        'elicitation-request',
        'elicitation-response',
        'tool-call-complete',
      ])
      expect(relevant(events)[2]).toMatchObject({ action: 'accept' })
    } finally {
      clearTimeout(timer)
      await agent.dispose()
      await harness.session.dispose()
    }
  })

  test('immediate callback keeps stream and onEvent order', async () => {
    const harness = createHarness()
    const observed: Array<AgentEvent> = []
    const agent = new AgentSession({
      session: harness.session,
      provider: harness.provider,
      model: 'test-model',
      onElicitation: () => ({ action: 'decline' }),
      onEvent: (event) => observed.push(event),
    })
    const streamed: Array<AgentEvent> = []
    for await (const event of agent.stream({ prompt: 'ask' })) streamed.push(event)
    const types = [
      'tool-call-start',
      'elicitation-request',
      'elicitation-response',
      'tool-call-complete',
    ]
    expect(relevant(streamed).map((event) => event.type)).toEqual(types)
    expect(relevant(observed).map((event) => event.type)).toEqual(types)
    await agent.dispose()
    await harness.session.dispose()
  })

  test('matching single tool call supplies toolCall', async () => {
    const harness = createHarness()
    const callbackCalls: Array<FunctionToolCall<unknown> | undefined> = []
    const agent = new AgentSession({
      session: harness.session,
      provider: harness.provider,
      model: 'test-model',
      onElicitation: (request) => {
        callbackCalls.push(request.toolCall)
        return { action: 'decline' }
      },
    })
    const streamed: Array<AgentEvent> = []
    for await (const event of agent.stream({ prompt: 'ask' })) streamed.push(event)
    const request = streamed.find((event) => event.type === 'elicitation-request')
    expect(request).toMatchObject({ toolCall: { name: 'questions:ask' } })
    expect(callbackCalls[0]).toMatchObject({ name: 'questions:ask' })
    await agent.dispose()
    await harness.session.dispose()
  })

  test('observer failures preserve attributed event pairs', async () => {
    const harness = createHarness()
    const agent = new AgentSession({
      session: harness.session,
      provider: harness.provider,
      model: 'test-model',
      onElicitation: () => ({ action: 'decline' }),
      onEvent: (event) => {
        if (event.type.startsWith('elicitation-') || event.type === 'tool-call-complete') {
          throw new Error('observer failed')
        }
      },
    })
    agent.events.on('event', async (event) => {
      if (event.type.startsWith('elicitation-') || event.type === 'tool-call-complete') {
        throw new Error('listener failed')
      }
    })
    const streamed: Array<AgentEvent> = []
    for await (const event of agent.stream({ prompt: 'ask' })) streamed.push(event)
    expect(relevant(streamed).map((event) => event.type)).toEqual([
      'tool-call-start',
      'elicitation-request',
      'elicitation-response',
      'tool-call-complete',
    ])
    await agent.dispose()
    await harness.session.dispose()
  })

  test('setup and unmatched requests go to onEvent only', async () => {
    const harness = createHarness()
    harness.session.contextHost.addDirectContext({
      key: 'other',
      protocolVersion: '2025-11-25',
      config: {
        name: 'other',
        version: '1.0.0',
        protocolVersions: ['2025-11-25'],
        tools: {
          ask: {
            description: 'Ask',
            inputSchema: { type: 'object' as const, properties: {} },
            handler: async ({
              client,
            }: {
              client: { elicit: (params: ElicitRequest['params']) => Promise<ElicitResult> }
            }) => {
              await client.elicit({
                message: 'other question',
                requestedSchema: { type: 'object', properties: {} },
              })
              return { content: [] }
            },
          },
        },
      },
    })
    const answer = defer<ElicitResult>()
    const observed: Array<AgentEvent> = []
    const agent = new AgentSession({
      session: harness.session,
      provider: harness.provider,
      model: 'test-model',
      onElicitation: (request) =>
        request.key === 'questions' && request.params.message !== 'setup question'
          ? answer.promise
          : { action: 'decline' },
      onEvent: (event) => observed.push(event),
    })
    await harness.session.contextHost.getPrompt({ key: 'questions', name: 'setup', arguments: {} })
    const streamed: Array<AgentEvent> = []
    for await (const event of agent.stream({ prompt: 'ask' })) {
      streamed.push(event)
      if (event.type === 'elicitation-request') {
        await harness.session.contextHost.callTool({ key: 'other', name: 'ask', arguments: {} })
        answer.resolve({ action: 'decline' })
      }
    }
    expect(
      relevant(observed).filter((event) => event.type.startsWith('elicitation-')),
    ).toHaveLength(6)
    expect(
      relevant(streamed).filter((event) => event.type.startsWith('elicitation-')),
    ).toHaveLength(2)
    expect(observed[0]).not.toHaveProperty('toolCall')
    const otherEvents = relevant(observed).filter(
      (event) => event.type.startsWith('elicitation-') && 'key' in event && event.key === 'other',
    )
    expect(otherEvents).toHaveLength(2)
    expect(otherEvents.every((event) => !('toolCall' in event))).toBe(true)
    await agent.dispose()
    await harness.session.dispose()
  })

  test('two concurrent runs against one context leave requests unattributed', async () => {
    const release = defer<ElicitResult>()
    const bothStarted = defer<void>()
    let count = 0
    const harness = createHarness()
    const callbackCalls: Array<FunctionToolCall<unknown> | undefined> = []
    const observed: Array<AgentEvent> = []
    const agent = new AgentSession({
      session: harness.session,
      provider: harness.provider,
      model: 'test-model',
      onElicitation: (request) => {
        callbackCalls.push(request.toolCall)
        count++
        if (count === 2) bothStarted.resolve()
        return release.promise
      },
      onEvent: (event) => observed.push(event),
    })
    const first: Array<AgentEvent> = []
    const second: Array<AgentEvent> = []
    const firstRun = (async () => {
      for await (const event of agent.stream({ prompt: 'first' })) first.push(event)
    })()
    const secondRun = (async () => {
      for await (const event of agent.stream({ prompt: 'second' })) second.push(event)
    })()
    await bothStarted.promise
    release.resolve({ action: 'decline' })
    await Promise.all([firstRun, secondRun])
    expect(callbackCalls).toEqual([undefined, undefined])
    expect(relevant(first).filter((event) => event.type.startsWith('elicitation-'))).toEqual([])
    expect(relevant(second).filter((event) => event.type.startsWith('elicitation-'))).toEqual([])
    expect(
      relevant(observed).filter((event) => event.type.startsWith('elicitation-')),
    ).toHaveLength(4)
    await agent.dispose()
    await harness.session.dispose()
  })
})
