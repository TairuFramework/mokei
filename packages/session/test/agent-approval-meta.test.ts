import type { CallToolResult, Tool } from '@mokei/context-protocol'
import type {
  AggregatedMessage,
  FunctionToolCall,
  MessagePart,
  ModelProvider,
  ServerMessage,
  StreamChatRequest,
} from '@mokei/model-provider'
import { describe, expect, test, vi } from 'vitest'

import { AgentSession, Session } from '../src/index.js'

type ToolCall = { id: string; name: string }
type TestTypes = {
  Message: unknown
  MessagePart: unknown
  Model: { id: string }
  Tool: { name: string; description: string }
  ToolCall: ToolCall
}

const grant = { 'dev.mokei/flow-grant': 't1' }

function provider(toolCalls: Array<FunctionToolCall<ToolCall>>): ModelProvider<TestTypes> {
  return {
    listModels: vi.fn(async () => [{ id: 'test-model', raw: { id: 'test-model' } }]),
    embed: vi.fn(async () => ({ embeddings: [] })),
    streamChat: vi.fn((params: { messages: Array<{ role: string }> }) => {
      const calls = params.messages.some((message) => message.role === 'tool') ? [] : toolCalls
      const parts: Array<MessagePart<unknown, ToolCall>> = [
        ...(calls.length > 0
          ? [{ type: 'tool-call' as const, toolCalls: calls, raw: {} }]
          : [{ type: 'text-delta' as const, text: 'done', raw: {} }]),
        { type: 'done', inputTokens: 1, outputTokens: 1, raw: {} },
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

function createSession(seenMeta: Array<Record<string, unknown>>) {
  const session = new Session<TestTypes>()
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
          description: 'Echo request metadata',
          inputSchema: { type: 'object' as const, properties: {} },
          handler: async ({ meta }: { meta: Record<string, unknown> }): Promise<CallToolResult> => {
            seenMeta.push(meta)
            return { content: [] }
          },
        },
      },
    },
  })
  return session
}

function makeCall(id: string): FunctionToolCall<ToolCall> {
  return { id, name: 'tools:echo', arguments: '{}', raw: { id, name: 'echo' } }
}

describe('AgentSession approval metadata', () => {
  test('approval meta is sent as _meta on that call only', async () => {
    const seenMeta: Array<Record<string, unknown>> = []
    const session = createSession(seenMeta)
    const agent = new AgentSession({
      session,
      provider: provider([makeCall('call-1'), makeCall('call-2')]),
      model: 'test-model',
      toolApproval: vi
        .fn()
        .mockResolvedValueOnce({ approved: true, meta: grant })
        .mockResolvedValueOnce(true),
    })

    await agent.run({ prompt: 'echo' })

    expect(seenMeta).toEqual([grant, {}])
    await agent.dispose()
    await session.dispose()
  })

  test('meta survives a consumer resuming after tool-call-approved', async () => {
    const seenMeta: Array<Record<string, unknown>> = []
    const session = createSession(seenMeta)
    const agent = new AgentSession({
      session,
      provider: provider([makeCall('call-1')]),
      model: 'test-model',
      toolApproval: async () => ({ approved: true, meta: grant }),
    })
    const stream = agent.stream({ prompt: 'echo' })

    let event = await stream.next()
    while (!event.done && event.value.type !== 'tool-call-approved') event = await stream.next()
    expect(event.done).toBe(false)
    await Promise.resolve()

    for await (const _event of stream) {
      // Resume the stream after approval to ensure the decision is retained.
    }

    expect(seenMeta).toEqual([grant])
    await agent.dispose()
    await session.dispose()
  })

  test('run() forwards approval meta', async () => {
    const seenMeta: Array<Record<string, unknown>> = []
    const session = createSession(seenMeta)
    const agent = new AgentSession({
      session,
      provider: provider([makeCall('call-1')]),
      model: 'test-model',
      toolApproval: async () => ({ approved: true, meta: grant }),
    })

    await agent.run({ prompt: 'echo' })

    expect(seenMeta).toEqual([grant])
    await agent.dispose()
    await session.dispose()
  })

  test('Session.executeToolCall forwards _meta', async () => {
    const seenMeta: Array<Record<string, unknown>> = []
    const session = new Session<TestTypes>({
      localTools: [
        {
          name: 'echo',
          inputSchema: { type: 'object' },
          execute: async ({ meta }) => {
            seenMeta.push(meta)
            return { content: [] }
          },
        },
      ],
    })

    await session.executeToolCall({
      toolCall: {
        id: 'call-1',
        name: 'local:echo',
        arguments: '{}',
        raw: { id: 'call-1', name: 'echo' },
      },
      _meta: grant,
    })

    expect(seenMeta).toEqual([grant])
    await session.dispose()
  })
})
