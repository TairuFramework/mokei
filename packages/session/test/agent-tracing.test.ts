import type { CallToolResult, Tool } from '@mokei/context-protocol'
import type {
  AggregatedMessage,
  FunctionToolCall,
  MessagePart,
  ModelProvider,
  ServerMessage,
  StreamChatRequest,
} from '@mokei/model-provider'
import { SpanKind, SpanStatusCode } from '@opentelemetry/api'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { describe, expect, test } from 'vitest'

import { type AgentParams, AgentSession, Session } from '../src/index.js'
import { useTestMetrics } from './support/metrics.js'
import { useTestTracing } from './support/otel.js'

type ToolCall = { id: string; name: string }
type TestTypes = {
  Message: unknown
  MessagePart: unknown
  Model: { id: string }
  Tool: { name: string; description: string }
  ToolCall: ToolCall
}

const { exporter } = useTestTracing()
const { collect } = useTestMetrics()

// Calls tools until a tool result is in the conversation, then answers.
function provider(toolCalls: Array<FunctionToolCall<ToolCall>>): ModelProvider<TestTypes> {
  return {
    telemetry: { providerName: 'openai' },
    listModels: async () => [],
    embed: async () => ({ embeddings: [] }),
    streamChat: (params) => {
      const calls = params.messages.some((message) => message.role === 'tool') ? [] : toolCalls
      const parts: Array<MessagePart<unknown, ToolCall>> = [
        ...(calls.length > 0
          ? [{ type: 'tool-call' as const, toolCalls: calls, raw: {} }]
          : [{ type: 'text-delta' as const, text: 'done', raw: {} }]),
        { type: 'done', inputTokens: 3, outputTokens: 2, raw: {} },
      ]
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
    },
    aggregateMessage: (parts: Array<ServerMessage<unknown, ToolCall>>) => {
      return {
        source: 'aggregated',
        role: 'assistant',
        text: parts.map((part) => part.text ?? '').join(''),
        toolCalls: parts.flatMap((part) => part.toolCalls ?? []),
        inputTokens: 3,
        outputTokens: 2,
      } satisfies AggregatedMessage<ToolCall>
    },
    toolFromMCP: (tool: Tool) => ({ name: tool.name, description: tool.description ?? '' }),
  }
}

function createSession(): Session<TestTypes> {
  const session = new Session<TestTypes>({
    localTools: [
      {
        name: 'add',
        inputSchema: { type: 'object' },
        execute: async () => ({ content: [{ type: 'text', text: '3' }] }),
      },
      {
        name: 'wait',
        inputSchema: { type: 'object' },
        execute: ({ signal }) => {
          return new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
        },
      },
    ],
  })
  session.contextHost.addDirectContext({
    key: 'tools',
    protocolVersion: '2025-11-25',
    tools: [
      {
        id: 'tools:echo',
        tool: { name: 'echo', inputSchema: { type: 'object', properties: {} } },
        enabled: true,
      },
    ],
    config: {
      name: 'tools',
      version: '1.0.0',
      protocolVersions: ['2025-11-25'],
      tools: {
        echo: {
          description: 'Echo',
          inputSchema: { type: 'object' as const, properties: {} },
          handler: async (): Promise<CallToolResult> => ({ content: [] }),
        },
      },
    },
  })
  return session
}

function makeCall(name: string): FunctionToolCall<ToolCall> {
  return { id: 'call-1', name, arguments: '{}', raw: { id: 'call-1', name } }
}

function createAgent(
  session: Session<TestTypes>,
  calls: Array<FunctionToolCall<ToolCall>>,
  params: Partial<AgentParams<TestTypes>> = {},
): AgentSession<TestTypes> {
  return new AgentSession<TestTypes>({
    session,
    provider: provider(calls),
    model: 'm',
    ...params,
  })
}

function agentSpan(): ReadableSpan {
  const spans = exporter
    .getFinishedSpans()
    .filter((span) => span.attributes['gen_ai.operation.name'] === 'invoke_agent')
  expect(spans).toHaveLength(1)
  return spans[0] as ReadableSpan
}

function childNames(parent: ReadableSpan): Array<string> {
  return exporter
    .getFinishedSpans()
    .filter((span) => span.parentSpanContext?.spanId === parent.spanContext().spanId)
    .sort((a, b) => a.startTime[0] - b.startTime[0] || a.startTime[1] - b.startTime[1])
    .map((span) => span.name)
}

describe('invoke_agent spans', () => {
  test('wraps a run with inference and MCP tool spans as children', async () => {
    const session = createSession()
    const agent = createAgent(session, [makeCall('tools:echo')], {
      name: 'helper',
      description: 'Helps out',
    })

    await agent.run({ prompt: 'go', conversationID: 'conv-1' })

    const root = agentSpan()
    expect(root.name).toBe('invoke_agent helper')
    expect(root.kind).toBe(SpanKind.INTERNAL)
    expect(root.status.code).toBe(SpanStatusCode.UNSET)
    expect(root.attributes).toMatchObject({
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.agent.name': 'helper',
      'gen_ai.agent.description': 'Helps out',
      'gen_ai.request.model': 'm',
      'gen_ai.conversation.id': 'conv-1',
      'gen_ai.usage.input_tokens': 6,
      'gen_ai.usage.output_tokens': 4,
    })
    expect(root.attributes['error.type']).toBeUndefined()
    expect(root.attributes['gen_ai.provider.name']).toBeUndefined()
    // The direct context connects lazily, so its `initialize` request runs inside the tool call.
    expect(childNames(root).filter((name) => name !== 'initialize')).toEqual([
      'chat m',
      'tools/call echo',
      'chat m',
    ])

    const tool = exporter.getFinishedSpans().find((span) => span.name === 'tools/call echo')
    expect(tool?.attributes).toMatchObject({
      'gen_ai.agent.name': 'helper',
      'gen_ai.conversation.id': 'conv-1',
      'gen_ai.tool.call.id': 'call-1',
    })
    await agent.dispose()
    await session.dispose()
  })

  test('local tools get an execute_tool child span', async () => {
    const session = createSession()
    const agent = createAgent(session, [makeCall('local:add')], { name: 'helper' })

    await agent.run({ prompt: 'go' })

    const root = agentSpan()
    expect(childNames(root)).toEqual(['chat m', 'execute_tool add', 'chat m'])
    const tool = exporter.getFinishedSpans().find((span) => span.name === 'execute_tool add')
    expect(tool?.attributes['gen_ai.agent.name']).toBe('helper')
    expect(tool?.attributes['gen_ai.conversation.id']).toBeUndefined()
    await agent.dispose()
    await session.dispose()
  })

  test('unnamed agent without conversation ID', async () => {
    const session = createSession()
    const agent = createAgent(session, [])

    await agent.run({ prompt: 'go' })

    const root = agentSpan()
    expect(root.name).toBe('invoke_agent')
    expect(root.attributes['gen_ai.agent.name']).toBeUndefined()
    expect(root.attributes['gen_ai.agent.description']).toBeUndefined()
    expect(root.attributes['gen_ai.conversation.id']).toBeUndefined()
    expect(childNames(root)).toEqual(['chat m'])
    await agent.dispose()
    await session.dispose()
  })

  test('timeout sets error.type timeout', async () => {
    const session = createSession()
    const agent = createAgent(session, [makeCall('tools:echo')], {
      timeout: 20,
      toolApproval: () => new Promise<boolean>(() => {}),
    })

    await expect(agent.run({ prompt: 'go' })).rejects.toThrow()

    const root = agentSpan()
    expect(root.attributes['error.type']).toBe('timeout')
    expect(root.status.code).toBe(SpanStatusCode.ERROR)
    await agent.dispose()
    await session.dispose()
  })

  test('aborted run sets error.type cancelled', async () => {
    const session = createSession()
    const agent = createAgent(session, [])
    const controller = new AbortController()
    controller.abort()

    const result = await agent.run({ prompt: 'go', signal: controller.signal })

    expect(result.finishReason).toBe('aborted')
    const root = agentSpan()
    expect(root.attributes['error.type']).toBe('cancelled')
    expect(root.status.code).toBe(SpanStatusCode.ERROR)
    await agent.dispose()
    await session.dispose()
  })

  test('max iterations sets error.type max_iterations', async () => {
    const session = createSession()
    const agent = createAgent(session, [makeCall('local:add')], { maxIterations: 1 })

    const result = await agent.run({ prompt: 'go' })

    expect(result.finishReason).toBe('max-iterations')
    expect(agentSpan().attributes['error.type']).toBe('max_iterations')
    await agent.dispose()
    await session.dispose()
  })

  test('abandoned stream ends the span as cancelled', async () => {
    const session = createSession()
    const agent = createAgent(session, [])

    for await (const event of agent.stream({ prompt: 'go' })) {
      if (event.type === 'start') break
    }

    expect(agentSpan().attributes['error.type']).toBe('cancelled')
    await agent.dispose()
    await session.dispose()
  })

  test('abandoning mid-tool ends the span once as cancelled', async () => {
    const session = createSession()
    const agent = createAgent(session, [makeCall('local:wait')])

    for await (const event of agent.stream({ prompt: 'go' })) {
      if (event.type === 'tool-call-start') break
    }
    // Let the aborted tool call settle before counting spans.
    await new Promise((resolve) => setTimeout(resolve, 10))

    const root = agentSpan()
    expect(root.attributes['error.type']).toBe('cancelled')
    expect(root.status.code).toBe(SpanStatusCode.ERROR)
    expect(childNames(root)).toEqual(['chat m', 'execute_tool wait'])
    await agent.dispose()
    await session.dispose()
  })

  test('thrown errors use the error name', async () => {
    class BoomError extends Error {
      name = 'BoomError'
    }
    const session = createSession()
    const failing = provider([])
    failing.streamChat = () => {
      throw new BoomError('boom')
    }
    const agent = new AgentSession<TestTypes>({ session, provider: failing, model: 'm' })

    await expect(agent.run({ prompt: 'go' })).rejects.toThrow('boom')

    expect(agentSpan().attributes['error.type']).toBe('BoomError')
    await agent.dispose()
    await session.dispose()
  })
})

describe('agent metrics', () => {
  test('records invoke_agent and execute_tool metrics', async () => {
    const session = createSession()
    const agent = createAgent(session, [makeCall('tools:echo')], { name: 'helper' })

    await agent.run({ prompt: 'go' })

    const collected = await collect()
    const attributes = { 'gen_ai.agent.name': 'helper', 'gen_ai.request.model': 'm' }
    const duration = collected.get('gen_ai.invoke_agent.duration')
    expect(duration).toHaveLength(1)
    expect(duration?.[0]?.attributes).toEqual(attributes)
    expect(duration?.[0]?.value).toMatchObject({ count: 1 })

    const inference = collected.get('gen_ai.invoke_agent.inference_calls')
    expect(inference?.[0]?.attributes).toEqual(attributes)
    expect(inference?.[0]?.value).toMatchObject({ count: 1, sum: 2 })

    const tools = collected.get('gen_ai.invoke_agent.tool_calls')
    expect(tools?.[0]?.value).toMatchObject({ count: 1, sum: 1 })

    const toolDuration = collected.get('gen_ai.execute_tool.duration')
    expect(toolDuration).toHaveLength(1)
    expect(toolDuration?.[0]?.attributes).toEqual({
      'gen_ai.tool.name': 'echo',
      'gen_ai.tool.type': 'function',
      'gen_ai.agent.name': 'helper',
    })
    await agent.dispose()
    await session.dispose()
  })

  test('failed runs carry error.type on the duration metric', async () => {
    const session = createSession()
    const agent = createAgent(session, [makeCall('local:add')], { maxIterations: 1 })

    await agent.run({ prompt: 'go' })

    const collected = await collect()
    expect(collected.get('gen_ai.invoke_agent.duration')?.[0]?.attributes).toMatchObject({
      'error.type': 'max_iterations',
    })
    await agent.dispose()
    await session.dispose()
  })
})
