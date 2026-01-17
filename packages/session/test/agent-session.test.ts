import { DirectTransports } from '@enkaku/transport'
import type { CallToolResult, ClientMessage, ServerMessage, Tool } from '@mokei/context-protocol'
import { LATEST_PROTOCOL_VERSION } from '@mokei/context-protocol'
import type {
  AggregatedMessage,
  FunctionToolCall,
  MessagePart,
  ModelProvider,
  ServerMessage as ProviderServerMessage,
  StreamChatRequest,
} from '@mokei/model-provider'
import { describe, expect, test, vi } from 'vitest'

import { AGENT_DEFAULTS, type AgentEvent, AgentSession, Session } from '../src/index.js'

/**
 * Creates a mock StreamChatRequest that combines AbortController and Promise.
 * We need a `then` method to implement PromiseLike for the mock.
 */
class MockStreamChatRequest<T> implements PromiseLike<T> {
  #abortController = new AbortController()
  #promise: Promise<T>

  constructor(promise: Promise<T>) {
    this.#promise = promise
  }

  get signal() {
    return this.#abortController.signal
  }

  abort() {
    this.#abortController.abort()
  }

  // biome-ignore lint/suspicious/noThenProperty: Required to implement PromiseLike interface
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.#promise.then(onfulfilled, onrejected)
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<T | TResult> {
    return this.#promise.catch(onrejected)
  }

  finally(onfinally?: (() => void) | null): Promise<T> {
    return this.#promise.finally(onfinally)
  }
}

// Mock provider types
type MockProviderTypes = {
  Message: unknown
  MessagePart: unknown
  Model: { id: string }
  Tool: { name: string; description: string }
  ToolCall: { id: string; name: string }
}

// Create a mock provider that returns specified responses
function createMockProvider(
  responses: Array<{
    text?: string
    toolCalls?: Array<FunctionToolCall<unknown>>
    inputTokens?: number
    outputTokens?: number
  }>,
): ModelProvider<MockProviderTypes> {
  let callIndex = 0

  return {
    listModels: vi.fn(async () => [{ id: 'test-model', raw: { id: 'test-model' } }]),

    embed: vi.fn(async () => ({ embeddings: [[0.1, 0.2, 0.3]] })),

    streamChat: vi.fn((_params) => {
      const response = responses[callIndex] ?? { text: 'Done', inputTokens: 10, outputTokens: 5 }
      callIndex++

      const parts: Array<MessagePart<unknown, unknown>> = []

      if (response.text) {
        parts.push({ type: 'text-delta', text: response.text, raw: {} })
      }

      if (response.toolCalls && response.toolCalls.length > 0) {
        parts.push({ type: 'tool-call', toolCalls: response.toolCalls, raw: {} })
      }

      parts.push({
        type: 'done',
        inputTokens: response.inputTokens ?? 10,
        outputTokens: response.outputTokens ?? 5,
        raw: {},
      })

      const stream = new ReadableStream<MessagePart<unknown, unknown>>({
        start(controller) {
          for (const part of parts) {
            controller.enqueue(part)
          }
          controller.close()
        },
      })

      return new MockStreamChatRequest(Promise.resolve(stream)) as unknown as StreamChatRequest<
        unknown,
        unknown
      >
    }),

    aggregateMessage: vi.fn(
      (parts: Array<ProviderServerMessage<unknown, unknown>>): AggregatedMessage<unknown> => {
        const text = parts
          .filter((p) => p.text)
          .map((p) => p.text)
          .join('')
        const toolCalls = parts.flatMap((p) => p.toolCalls ?? [])
        const inputTokens = parts.reduce((sum, p) => sum + (p.inputTokens ?? 0), 0)
        const outputTokens = parts.reduce((sum, p) => sum + (p.outputTokens ?? 0), 0)

        return {
          source: 'aggregated',
          role: 'assistant',
          text,
          toolCalls,
          inputTokens,
          outputTokens,
        }
      },
    ),

    toolFromMCP: vi.fn((tool: Tool) => ({
      name: tool.name,
      description: tool.description ?? '',
    })),
  }
}

// Create a Session with a mock context for testing
async function createMockSessionWithTools(
  tools: Array<{ name: string; description: string; result: CallToolResult }>,
  providers?: Record<string, ModelProvider<MockProviderTypes>>,
): Promise<Session<MockProviderTypes>> {
  const session = new Session<MockProviderTypes>({ providers })

  // Create a mock server transport pair
  const transports = new DirectTransports<ServerMessage, ClientMessage>()

  // Set up a simple server that handles initialize and tool calls
  const serverLoop = async () => {
    const transport = transports.server

    // Handle initialize
    const initReq = await transport.read()
    if (!initReq.done) {
      transport.write({
        jsonrpc: '2.0',
        id: (initReq.value as { id: number }).id,
        result: {
          capabilities: { tools: {} },
          protocolVersion: LATEST_PROTOCOL_VERSION,
          serverInfo: { name: 'MockServer', version: '1.0.0' },
        },
      })

      // Wait for initialized notification
      await transport.read()

      // Handle tools/list
      const toolsReq = await transport.read()
      if (!toolsReq.done) {
        transport.write({
          jsonrpc: '2.0',
          id: (toolsReq.value as { id: number }).id,
          result: {
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: { type: 'object' },
            })),
          },
        })
      }

      // Handle tool calls
      while (true) {
        const req = await transport.read()
        if (req.done) break

        const request = req.value as { id: number; method: string; params?: { name: string } }
        if (request.method === 'tools/call') {
          const tool = tools.find((t) => t.name === request.params?.name)
          transport.write({
            jsonrpc: '2.0',
            id: request.id,
            result: tool?.result ?? { content: [{ type: 'text', text: 'Unknown tool' }] },
          })
        }
      }
    }
  }

  // Start server in background
  serverLoop().catch(() => {})

  // Add the context using session's contextHost
  session.contextHost.createContext({
    key: 'mock',
    transport: transports.client,
  })

  // Initialize and setup
  await session.contextHost.setup('mock')

  return session
}

describe('AgentSession', () => {
  describe('constructor', () => {
    test('applies default values', () => {
      const provider = createMockProvider([{ text: 'Hello' }])
      const session = new Session({ providers: { test: provider } })

      const agent = new AgentSession({
        session,
        provider,
        model: 'test-model',
      })

      expect(agent).toBeInstanceOf(AgentSession)
    })

    test('throws if string provider not found', () => {
      const session = new Session()

      expect(
        () =>
          new AgentSession({
            session,
            provider: 'nonexistent',
            model: 'test-model',
          }),
      ).toThrow('Provider with key nonexistent does not exist')
    })

    test('accepts provider from session.providers', () => {
      const provider = createMockProvider([{ text: 'Hello' }])
      const session = new Session({ providers: { test: provider } })

      const agent = new AgentSession({
        session,
        provider: 'test',
        model: 'test-model',
      })

      expect(agent).toBeInstanceOf(AgentSession)
    })
  })

  describe('run()', () => {
    test('completes simple prompt without tools in 1 iteration', async () => {
      const provider = createMockProvider([
        { text: 'Hello, world!', inputTokens: 5, outputTokens: 3 },
      ])
      const session = new Session({ providers: { test: provider } })

      const agent = new AgentSession({
        session,
        provider,
        model: 'test-model',
      })

      const result = await agent.run('Say hello')

      expect(result.text).toBe('Hello, world!')
      expect(result.iterations).toBe(1)
      expect(result.toolCalls).toHaveLength(0)
      expect(result.finishReason).toBe('complete')
      expect(result.inputTokens).toBe(5)
      expect(result.outputTokens).toBe(3)
    })

    test('respects maxIterations limit', async () => {
      // Provider always returns tool calls
      const toolCall: FunctionToolCall<unknown> = {
        id: 'call-1',
        name: 'mock:test-tool',
        arguments: '{}',
        raw: {},
      }

      const provider = createMockProvider([
        { toolCalls: [toolCall] },
        { toolCalls: [toolCall] },
        { toolCalls: [toolCall] },
        { toolCalls: [toolCall] },
      ])

      const session = await createMockSessionWithTools(
        [
          {
            name: 'test-tool',
            description: 'Test tool',
            result: { content: [{ type: 'text', text: 'OK' }] },
          },
        ],
        { test: provider },
      )

      const agent = new AgentSession({
        session,
        provider,
        model: 'test-model',
        maxIterations: 2,
        toolApproval: 'auto',
      })

      const result = await agent.run('Do something')

      expect(result.iterations).toBe(2)
      expect(result.finishReason).toBe('max-iterations')

      await session.dispose()
    })

    test('handles abort signal', async () => {
      const provider = createMockProvider([{ text: 'Hello' }])
      const session = new Session({ providers: { test: provider } })

      const controller = new AbortController()
      controller.abort()

      const agent = new AgentSession({
        session,
        provider,
        model: 'test-model',
      })

      const result = await agent.run('Say hello', controller.signal)
      expect(result.finishReason).toBe('aborted')
    })
  })

  describe('stream()', () => {
    test('yields correct event sequence for simple prompt', async () => {
      const provider = createMockProvider([{ text: 'Hi!', inputTokens: 5, outputTokens: 2 }])
      const session = new Session({ providers: { test: provider } })

      const agent = new AgentSession({
        session,
        provider,
        model: 'test-model',
      })

      const events: Array<AgentEvent> = []
      for await (const event of agent.stream('Hello')) {
        events.push(event)
      }

      const eventTypes = events.map((e) => e.type)

      expect(eventTypes).toContain('start')
      expect(eventTypes).toContain('iteration-start')
      expect(eventTypes).toContain('text-delta')
      expect(eventTypes).toContain('text-complete')
      expect(eventTypes).toContain('iteration-complete')
      expect(eventTypes).toContain('complete')

      // Check order
      const startIndex = eventTypes.indexOf('start')
      const iterStartIndex = eventTypes.indexOf('iteration-start')
      const completeIndex = eventTypes.indexOf('complete')

      expect(startIndex).toBeLessThan(iterStartIndex)
      expect(iterStartIndex).toBeLessThan(completeIndex)
    })

    test('emits onEvent callback for each event', async () => {
      const provider = createMockProvider([{ text: 'Test' }])
      const session = new Session({ providers: { test: provider } })

      const receivedEvents: Array<AgentEvent> = []
      const onEvent = vi.fn((event: AgentEvent) => {
        receivedEvents.push(event)
      })

      const agent = new AgentSession({
        session,
        provider,
        model: 'test-model',
        onEvent,
      })

      const events: Array<AgentEvent> = []
      for await (const event of agent.stream('Test')) {
        events.push(event)
      }

      expect(onEvent).toHaveBeenCalled()
      expect(receivedEvents.length).toBe(events.length)
    })
  })

  describe('tool approval strategies', () => {
    test("'auto' executes all tools without prompting", async () => {
      const toolCall: FunctionToolCall<unknown> = {
        id: 'call-1',
        name: 'mock:greet',
        arguments: '{"name":"World"}',
        raw: {},
      }

      const provider = createMockProvider([
        { toolCalls: [toolCall], inputTokens: 10, outputTokens: 5 },
        { text: 'Done!', inputTokens: 15, outputTokens: 4 },
      ])

      const session = await createMockSessionWithTools(
        [
          {
            name: 'greet',
            description: 'Greets someone',
            result: { content: [{ type: 'text', text: 'Hello, World!' }] },
          },
        ],
        { test: provider },
      )

      const agent = new AgentSession({
        session,
        provider,
        model: 'test-model',
        toolApproval: 'auto',
      })

      const events: Array<AgentEvent> = []
      for await (const event of agent.stream('Greet World')) {
        events.push(event)
      }

      const eventTypes = events.map((e) => e.type)

      expect(eventTypes).toContain('tool-call-approved')
      expect(eventTypes).toContain('tool-call-start')
      expect(eventTypes).toContain('tool-call-complete')
      expect(eventTypes).not.toContain('tool-call-denied')

      await session.dispose()
    })

    test("'never' skips all tool execution", async () => {
      const toolCall: FunctionToolCall<unknown> = {
        id: 'call-1',
        name: 'mock:greet',
        arguments: '{}',
        raw: {},
      }

      const provider = createMockProvider([{ toolCalls: [toolCall] }, { text: 'OK then' }])

      const session = await createMockSessionWithTools(
        [
          {
            name: 'greet',
            description: 'Greets',
            result: { content: [{ type: 'text', text: 'Hi' }] },
          },
        ],
        { test: provider },
      )

      const agent = new AgentSession({
        session,
        provider,
        model: 'test-model',
        toolApproval: 'never',
      })

      const events: Array<AgentEvent> = []
      for await (const event of agent.stream('Greet')) {
        events.push(event)
      }

      const eventTypes = events.map((e) => e.type)

      expect(eventTypes).toContain('tool-call-denied')
      expect(eventTypes).not.toContain('tool-call-start')

      await session.dispose()
    })

    test('custom function is called with correct context', async () => {
      const toolCall: FunctionToolCall<unknown> = {
        id: 'call-1',
        name: 'mock:test',
        arguments: '{}',
        raw: {},
      }

      const provider = createMockProvider([{ toolCalls: [toolCall] }, { text: 'Done' }])

      const session = await createMockSessionWithTools(
        [
          {
            name: 'test',
            description: 'Test',
            result: { content: [{ type: 'text', text: 'OK' }] },
          },
        ],
        { test: provider },
      )

      const approvalFn = vi.fn(async (call, context) => {
        expect(call.name).toBe('mock:test')
        expect(context.iteration).toBe(1)
        expect(Array.isArray(context.history)).toBe(true)
        return true
      })

      const agent = new AgentSession({
        session,
        provider,
        model: 'test-model',
        toolApproval: approvalFn,
      })

      await agent.run('Test')

      expect(approvalFn).toHaveBeenCalled()

      await session.dispose()
    })

    test('custom function can deny with reason', async () => {
      const toolCall: FunctionToolCall<unknown> = {
        id: 'call-1',
        name: 'mock:dangerous',
        arguments: '{}',
        raw: {},
      }

      const provider = createMockProvider([{ toolCalls: [toolCall] }, { text: 'Understood' }])

      const session = await createMockSessionWithTools(
        [
          {
            name: 'dangerous',
            description: 'Dangerous op',
            result: { content: [{ type: 'text', text: 'Boom' }] },
          },
        ],
        { test: provider },
      )

      const approvalFn = vi.fn(async () => ({
        approved: false,
        reason: 'Too dangerous',
      }))

      const agent = new AgentSession({
        session,
        provider,
        model: 'test-model',
        toolApproval: approvalFn,
      })

      const events: Array<AgentEvent> = []
      for await (const event of agent.stream('Do dangerous thing')) {
        events.push(event)
      }

      const deniedEvent = events.find((e) => e.type === 'tool-call-denied')
      expect(deniedEvent).toBeDefined()
      expect((deniedEvent as { reason?: string }).reason).toBe('Too dangerous')

      await session.dispose()
    })
  })

  describe('events emitter', () => {
    test('emits events through events property', async () => {
      const provider = createMockProvider([{ text: 'Hello' }])
      const session = new Session({ providers: { test: provider } })

      const agent = new AgentSession({
        session,
        provider,
        model: 'test-model',
      })

      const receivedEvents: Array<AgentEvent> = []
      agent.events.on('event', (event) => {
        receivedEvents.push(event)
      })

      await agent.run('Hi')

      expect(receivedEvents.length).toBeGreaterThan(0)
      expect(receivedEvents.some((e) => e.type === 'complete')).toBe(true)
    })
  })

  describe('AGENT_DEFAULTS', () => {
    test('has expected default values', () => {
      expect(AGENT_DEFAULTS.maxIterations).toBe(10)
      expect(AGENT_DEFAULTS.timeout).toBe(5 * 60 * 1000)
      expect(AGENT_DEFAULTS.toolApproval).toBe('auto')
    })
  })

  describe('real-world scenarios', () => {
    describe('multi-step task execution', () => {
      test('executes sequence of tool calls across iterations', async () => {
        // Simulates: "Create a table, insert data, then query it"
        const createTableCall: FunctionToolCall<unknown> = {
          id: 'call-1',
          name: 'mock:create_table',
          arguments: '{"name":"users"}',
          raw: {},
        }
        const insertCall: FunctionToolCall<unknown> = {
          id: 'call-2',
          name: 'mock:insert',
          arguments: '{"table":"users","data":{"name":"Alice"}}',
          raw: {},
        }
        const queryCall: FunctionToolCall<unknown> = {
          id: 'call-3',
          name: 'mock:query',
          arguments: '{"sql":"SELECT * FROM users"}',
          raw: {},
        }

        const provider = createMockProvider([
          {
            text: 'Creating table...',
            toolCalls: [createTableCall],
            inputTokens: 20,
            outputTokens: 10,
          },
          { text: 'Inserting data...', toolCalls: [insertCall], inputTokens: 30, outputTokens: 15 },
          { text: 'Querying...', toolCalls: [queryCall], inputTokens: 25, outputTokens: 12 },
          { text: 'Done! Found 1 user: Alice', inputTokens: 40, outputTokens: 20 },
        ])

        const session = await createMockSessionWithTools(
          [
            {
              name: 'create_table',
              description: 'Create table',
              result: { content: [{ type: 'text', text: 'Table created' }] },
            },
            {
              name: 'insert',
              description: 'Insert data',
              result: { content: [{ type: 'text', text: 'Inserted 1 row' }] },
            },
            {
              name: 'query',
              description: 'Query data',
              result: { content: [{ type: 'text', text: '[{"name":"Alice"}]' }] },
            },
          ],
          { test: provider },
        )

        const agent = new AgentSession({
          session,
          provider,
          model: 'test-model',
          toolApproval: 'auto',
        })

        const result = await agent.run('Create users table, insert Alice, then show all users')

        expect(result.iterations).toBe(4)
        expect(result.toolCalls).toHaveLength(3)
        expect(result.toolCalls[0].call.name).toBe('mock:create_table')
        expect(result.toolCalls[1].call.name).toBe('mock:insert')
        expect(result.toolCalls[2].call.name).toBe('mock:query')
        expect(result.toolCalls.every((tc) => tc.approved)).toBe(true)
        expect(result.finishReason).toBe('complete')
        expect(result.inputTokens).toBe(115) // 20+30+25+40
        expect(result.outputTokens).toBe(57) // 10+15+12+20

        await session.dispose()
      })

      test('handles multiple tool calls in single response', async () => {
        // Model requests multiple tools at once (parallel tool calls)
        const tool1: FunctionToolCall<unknown> = {
          id: 'call-1',
          name: 'mock:get_weather',
          arguments: '{"city":"London"}',
          raw: {},
        }
        const tool2: FunctionToolCall<unknown> = {
          id: 'call-2',
          name: 'mock:get_weather',
          arguments: '{"city":"Paris"}',
          raw: {},
        }
        const tool3: FunctionToolCall<unknown> = {
          id: 'call-3',
          name: 'mock:get_weather',
          arguments: '{"city":"Tokyo"}',
          raw: {},
        }

        const provider = createMockProvider([
          { text: 'Checking weather...', toolCalls: [tool1, tool2, tool3] },
          { text: 'London: 15°C, Paris: 18°C, Tokyo: 22°C' },
        ])

        const session = await createMockSessionWithTools(
          [
            {
              name: 'get_weather',
              description: 'Get weather',
              result: { content: [{ type: 'text', text: '20°C' }] },
            },
          ],
          { test: provider },
        )

        const agent = new AgentSession({
          session,
          provider,
          model: 'test-model',
          toolApproval: 'auto',
        })

        const result = await agent.run('What is the weather in London, Paris, and Tokyo?')

        expect(result.iterations).toBe(2)
        expect(result.toolCalls).toHaveLength(3)
        expect(result.toolCalls.every((tc) => tc.approved)).toBe(true)
        expect(result.finishReason).toBe('complete')

        await session.dispose()
      })
    })

    describe('error handling', () => {
      test('continues execution when tool call fails', async () => {
        const toolCall: FunctionToolCall<unknown> = {
          id: 'call-1',
          name: 'mock:failing_tool',
          arguments: '{}',
          raw: {},
        }

        const provider = createMockProvider([
          { toolCalls: [toolCall] },
          { text: 'Tool failed, but I can continue without it.' },
        ])

        const session = await createMockSessionWithTools(
          [
            {
              name: 'failing_tool',
              description: 'This tool fails',
              result: { content: [{ type: 'text', text: 'Error occurred' }], isError: true },
            },
          ],
          { test: provider },
        )

        const agent = new AgentSession({
          session,
          provider,
          model: 'test-model',
          toolApproval: 'auto',
        })

        const events: Array<AgentEvent> = []
        for await (const event of agent.stream('Try the failing tool')) {
          events.push(event)
        }

        const result = events.find((e) => e.type === 'complete') as {
          result: { toolCalls: Array<{ result?: { isError?: boolean } }> }
        }
        expect(result).toBeDefined()
        expect(result.result.toolCalls[0].result?.isError).toBe(true)

        await session.dispose()
      })

      test('records tool execution errors', async () => {
        // Use a tool call with invalid context key to trigger an error
        const toolCall: FunctionToolCall<unknown> = {
          id: 'call-1',
          name: 'invalid_context:some_tool', // Invalid context key
          arguments: '{}',
          raw: {},
        }

        const provider = createMockProvider([
          { toolCalls: [toolCall] },
          { text: 'Could not find the tool.' },
        ])

        const session = await createMockSessionWithTools(
          [
            {
              name: 'other_tool',
              description: 'Other',
              result: { content: [{ type: 'text', text: 'OK' }] },
            },
          ],
          { test: provider },
        )

        const agent = new AgentSession({
          session,
          provider,
          model: 'test-model',
          toolApproval: 'auto',
        })

        const events: Array<AgentEvent> = []
        for await (const event of agent.stream('Call nonexistent tool')) {
          events.push(event)
        }

        // Should have a tool-call-error event because context doesn't exist
        const errorEvent = events.find((e) => e.type === 'tool-call-error')
        expect(errorEvent).toBeDefined()

        await session.dispose()
      })
    })

    describe('system prompt', () => {
      test('includes system prompt in conversation', async () => {
        const provider = createMockProvider([{ text: 'I am a helpful database assistant.' }])
        const session = new Session({ providers: { test: provider } })

        const agent = new AgentSession({
          session,
          provider,
          model: 'test-model',
          systemPrompt: 'You are a helpful database assistant. Always explain your actions.',
        })

        await agent.run('Who are you?')

        // Verify streamChat was called with system message
        expect(provider.streamChat).toHaveBeenCalled()
        const callArgs = (provider.streamChat as ReturnType<typeof vi.fn>).mock.calls[0][0]

        // First call should have system prompt + user message
        expect(callArgs.messages.length).toBeGreaterThanOrEqual(2)
        expect(callArgs.messages[0]).toEqual({
          source: 'client',
          role: 'system',
          text: 'You are a helpful database assistant. Always explain your actions.',
        })
        expect(callArgs.messages[1]).toEqual({
          source: 'client',
          role: 'user',
          text: 'Who are you?',
        })
      })

      test('does not include system prompt when not provided', async () => {
        const provider = createMockProvider([{ text: 'Hello!' }])
        const session = new Session({ providers: { test: provider } })

        const agent = new AgentSession({
          session,
          provider,
          model: 'test-model',
          // No systemPrompt
        })

        await agent.run('Hello')

        const callArgs = (provider.streamChat as ReturnType<typeof vi.fn>).mock.calls[0][0]

        // Should only have user message, no system message
        expect(callArgs.messages[0]).toEqual({
          source: 'client',
          role: 'user',
          text: 'Hello',
        })
      })
    })

    describe('token tracking', () => {
      test('accumulates tokens across all iterations', async () => {
        const toolCall: FunctionToolCall<unknown> = {
          id: 'call-1',
          name: 'mock:search',
          arguments: '{}',
          raw: {},
        }

        const provider = createMockProvider([
          { text: 'Searching...', toolCalls: [toolCall], inputTokens: 100, outputTokens: 50 },
          { text: 'Found results', inputTokens: 150, outputTokens: 75 },
        ])

        const session = await createMockSessionWithTools(
          [
            {
              name: 'search',
              description: 'Search',
              result: { content: [{ type: 'text', text: 'results' }] },
            },
          ],
          { test: provider },
        )

        const agent = new AgentSession({
          session,
          provider,
          model: 'test-model',
          toolApproval: 'auto',
        })

        const result = await agent.run('Search for something')

        expect(result.inputTokens).toBe(250) // 100 + 150
        expect(result.outputTokens).toBe(125) // 50 + 75

        await session.dispose()
      })
    })

    describe('mixed approval scenarios', () => {
      test('approves safe tools and denies dangerous ones', async () => {
        const safeCall: FunctionToolCall<unknown> = {
          id: 'call-1',
          name: 'mock:read_file',
          arguments: '{"path":"data.txt"}',
          raw: {},
        }
        const dangerousCall: FunctionToolCall<unknown> = {
          id: 'call-2',
          name: 'mock:delete_file',
          arguments: '{"path":"important.txt"}',
          raw: {},
        }

        const provider = createMockProvider([
          { toolCalls: [safeCall, dangerousCall] },
          { text: 'Read the file but could not delete.' },
        ])

        const session = await createMockSessionWithTools(
          [
            {
              name: 'read_file',
              description: 'Read file',
              result: { content: [{ type: 'text', text: 'file contents' }] },
            },
            {
              name: 'delete_file',
              description: 'Delete file',
              result: { content: [{ type: 'text', text: 'deleted' }] },
            },
          ],
          { test: provider },
        )

        const agent = new AgentSession({
          session,
          provider,
          model: 'test-model',
          toolApproval: async (toolCall) => {
            if (toolCall.name.includes('delete')) {
              return { approved: false, reason: 'Deletion not allowed' }
            }
            return true
          },
        })

        const result = await agent.run('Read and delete files')

        expect(result.toolCalls).toHaveLength(2)

        const readCall = result.toolCalls.find((tc) => tc.call.name === 'mock:read_file')
        const deleteCall = result.toolCalls.find((tc) => tc.call.name === 'mock:delete_file')

        expect(readCall?.approved).toBe(true)
        expect(readCall?.result).toBeDefined()

        expect(deleteCall?.approved).toBe(false)
        expect(deleteCall?.denialReason).toBe('Deletion not allowed')
        expect(deleteCall?.result).toBeUndefined()

        await session.dispose()
      })

      test('approval function receives event history', async () => {
        const tool1: FunctionToolCall<unknown> = {
          id: 'call-1',
          name: 'mock:first_tool',
          arguments: '{}',
          raw: {},
        }
        const tool2: FunctionToolCall<unknown> = {
          id: 'call-2',
          name: 'mock:second_tool',
          arguments: '{}',
          raw: {},
        }

        const provider = createMockProvider([
          { toolCalls: [tool1] },
          { toolCalls: [tool2] },
          { text: 'Done' },
        ])

        const session = await createMockSessionWithTools(
          [
            {
              name: 'first_tool',
              description: 'First',
              result: { content: [{ type: 'text', text: 'first result' }] },
            },
            {
              name: 'second_tool',
              description: 'Second',
              result: { content: [{ type: 'text', text: 'second result' }] },
            },
          ],
          { test: provider },
        )

        const historyLengths: Array<number> = []
        const iterations: Array<number> = []

        const agent = new AgentSession({
          session,
          provider,
          model: 'test-model',
          toolApproval: async (_toolCall, context) => {
            historyLengths.push(context.history.length)
            iterations.push(context.iteration)
            return true
          },
        })

        await agent.run('Use both tools')

        // First call should have fewer history events than second
        expect(iterations).toEqual([1, 2])
        expect(historyLengths[1]).toBeGreaterThan(historyLengths[0])

        await session.dispose()
      })
    })

    describe('duration tracking', () => {
      test('tracks execution duration', async () => {
        const provider = createMockProvider([{ text: 'Quick response' }])
        const session = new Session({ providers: { test: provider } })

        const agent = new AgentSession({
          session,
          provider,
          model: 'test-model',
        })

        const startTime = Date.now()
        const result = await agent.run('Test')
        const endTime = Date.now()

        expect(result.duration).toBeGreaterThanOrEqual(0)
        expect(result.duration).toBeLessThanOrEqual(endTime - startTime + 100) // Small buffer for timing
      })
    })

    describe('event timestamps', () => {
      test('all events have valid timestamps', async () => {
        const provider = createMockProvider([{ text: 'Hello' }])
        const session = new Session({ providers: { test: provider } })

        const agent = new AgentSession({
          session,
          provider,
          model: 'test-model',
        })

        const startTime = Date.now()
        const events: Array<AgentEvent> = []
        for await (const event of agent.stream('Test')) {
          events.push(event)
        }
        const endTime = Date.now()

        for (const event of events) {
          expect(event.timestamp).toBeGreaterThanOrEqual(startTime - 1)
          expect(event.timestamp).toBeLessThanOrEqual(endTime + 1)
        }

        // Timestamps should be non-decreasing
        for (let i = 1; i < events.length; i++) {
          expect(events[i].timestamp).toBeGreaterThanOrEqual(events[i - 1].timestamp)
        }
      })
    })

    describe('edge cases', () => {
      test('handles empty text response', async () => {
        const provider = createMockProvider([{ text: '', inputTokens: 5, outputTokens: 0 }])
        const session = new Session({ providers: { test: provider } })

        const agent = new AgentSession({
          session,
          provider,
          model: 'test-model',
        })

        const result = await agent.run('Generate empty response')

        expect(result.text).toBe('')
        expect(result.finishReason).toBe('complete')
      })

      test('handles no tools available', async () => {
        const provider = createMockProvider([{ text: 'I have no tools to use.' }])
        const session = new Session({ providers: { test: provider } }) // No contexts added

        const agent = new AgentSession({
          session,
          provider,
          model: 'test-model',
          toolApproval: 'auto',
        })

        const result = await agent.run('Use a tool')

        // Should still complete successfully
        expect(result.finishReason).toBe('complete')
        expect(result.toolCalls).toHaveLength(0)
      })

      test('completes immediately when already aborted', async () => {
        const provider = createMockProvider([{ text: 'Should not see this' }])
        const session = new Session({ providers: { test: provider } })

        const agent = new AgentSession({
          session,
          provider,
          model: 'test-model',
        })

        const abortController = new AbortController()
        abortController.abort('Pre-aborted')

        const result = await agent.run('Test', abortController.signal)

        expect(result.finishReason).toBe('aborted')
        expect(result.iterations).toBe(0)
      })

      test('handles very long tool arguments', async () => {
        const longData = 'x'.repeat(10000)
        const toolCall: FunctionToolCall<unknown> = {
          id: 'call-1',
          name: 'mock:process_data',
          arguments: JSON.stringify({ data: longData }),
          raw: {},
        }

        const provider = createMockProvider([
          { toolCalls: [toolCall] },
          { text: 'Processed large data' },
        ])

        const session = await createMockSessionWithTools(
          [
            {
              name: 'process_data',
              description: 'Process',
              result: { content: [{ type: 'text', text: 'OK' }] },
            },
          ],
          { test: provider },
        )

        const agent = new AgentSession({
          session,
          provider,
          model: 'test-model',
          toolApproval: 'auto',
        })

        const result = await agent.run('Process large data')

        expect(result.finishReason).toBe('complete')
        expect(result.toolCalls[0].approved).toBe(true)

        await session.dispose()
      })
    })

    describe('conversation context', () => {
      test('maintains message history across iterations', async () => {
        const toolCall: FunctionToolCall<unknown> = {
          id: 'call-1',
          name: 'mock:get_info',
          arguments: '{}',
          raw: {},
        }

        let messageCount = 0
        const provider = createMockProvider([
          { toolCalls: [toolCall] },
          { text: 'Final answer based on tool result' },
        ])

        // Override streamChat to track message count
        const originalStreamChat = provider.streamChat
        provider.streamChat = vi.fn((params) => {
          messageCount = params.messages.length
          return (originalStreamChat as (p: unknown) => unknown)(params) as StreamChatRequest<
            unknown,
            unknown
          >
        })

        const session = await createMockSessionWithTools(
          [
            {
              name: 'get_info',
              description: 'Get info',
              result: { content: [{ type: 'text', text: 'info result' }] },
            },
          ],
          { test: provider },
        )

        const agent = new AgentSession({
          session,
          provider,
          model: 'test-model',
          toolApproval: 'auto',
        })

        await agent.run('Get some info')

        // On second call, should have: user message, assistant (with tool call), tool result
        expect(messageCount).toBeGreaterThan(1)

        await session.dispose()
      })
    })

    describe('tool result content types', () => {
      test('handles tool result with image content', async () => {
        const toolCall: FunctionToolCall<unknown> = {
          id: 'call-1',
          name: 'mock:generate_image',
          arguments: '{}',
          raw: {},
        }

        const provider = createMockProvider([
          { toolCalls: [toolCall] },
          { text: 'Generated an image for you' },
        ])

        const session = await createMockSessionWithTools(
          [
            {
              name: 'generate_image',
              description: 'Generate image',
              result: {
                content: [{ type: 'image', data: 'base64encodeddata', mimeType: 'image/png' }],
              },
            },
          ],
          { test: provider },
        )

        const agent = new AgentSession({
          session,
          provider,
          model: 'test-model',
          toolApproval: 'auto',
        })

        const result = await agent.run('Generate an image')

        expect(result.finishReason).toBe('complete')
        expect(result.toolCalls[0].result?.content[0].type).toBe('image')

        await session.dispose()
      })

      test('handles tool result with multiple content items', async () => {
        const toolCall: FunctionToolCall<unknown> = {
          id: 'call-1',
          name: 'mock:analyze',
          arguments: '{}',
          raw: {},
        }

        const provider = createMockProvider([
          { toolCalls: [toolCall] },
          { text: 'Analysis complete' },
        ])

        const session = await createMockSessionWithTools(
          [
            {
              name: 'analyze',
              description: 'Analyze data',
              result: {
                content: [
                  { type: 'text', text: 'Analysis summary' },
                  { type: 'text', text: 'Detailed findings' },
                ],
              },
            },
          ],
          { test: provider },
        )

        const agent = new AgentSession({
          session,
          provider,
          model: 'test-model',
          toolApproval: 'auto',
        })

        const result = await agent.run('Analyze data')

        expect(result.toolCalls[0].result?.content).toHaveLength(2)

        await session.dispose()
      })
    })

    describe('iteration behavior', () => {
      test('iteration-complete event indicates if more tool calls pending', async () => {
        const toolCall: FunctionToolCall<unknown> = {
          id: 'call-1',
          name: 'mock:step',
          arguments: '{}',
          raw: {},
        }

        const provider = createMockProvider([{ toolCalls: [toolCall] }, { text: 'Done' }])

        const session = await createMockSessionWithTools(
          [
            {
              name: 'step',
              description: 'Step',
              result: { content: [{ type: 'text', text: 'OK' }] },
            },
          ],
          { test: provider },
        )

        const agent = new AgentSession({
          session,
          provider,
          model: 'test-model',
          toolApproval: 'auto',
        })

        const events: Array<AgentEvent> = []
        for await (const event of agent.stream('Do steps')) {
          events.push(event)
        }

        const iterCompletes = events.filter((e) => e.type === 'iteration-complete') as Array<{
          type: 'iteration-complete'
          iteration: number
          hasToolCalls: boolean
        }>

        expect(iterCompletes).toHaveLength(2)
        expect(iterCompletes[0].hasToolCalls).toBe(true) // First iteration had tool calls
        expect(iterCompletes[1].hasToolCalls).toBe(false) // Second iteration completed

        await session.dispose()
      })
    })
  })
})
