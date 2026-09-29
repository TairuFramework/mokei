import { NodeContextHost } from '@mokei/host-node'
import type {
  AggregatedMessage,
  MessagePart,
  ModelProvider,
  ServerMessage,
  StreamChatRequest,
} from '@mokei/model-provider'
import { type AgentEvent, AgentSession, Session } from '@mokei/session'
import { NodeSession } from '@mokei/session-node'
import { describe, expect, test, vi } from 'vitest'

import {
  MOKEI_STDIO_SERVER_ELICITATION_PATH,
  startMokeiElicitationHTTPServer,
} from '../support/interop/servers.ts'
import {
  ELICITATION_PARAMS,
  ELICITATION_TOOL_NAME,
} from '../support/interop/session-elicitation-fixture.ts'

type ToolCall = { id: string; name: string }
type TestTypes = {
  Message: unknown
  MessagePart: unknown
  Model: { id: string }
  Tool: { name: string; description: string }
  ToolCall: ToolCall
}

const ACCEPT = { action: 'accept' as const, content: { answer: 'accepted' } }
const TOOL_ID = `questions:${ELICITATION_TOOL_NAME}`

function provider(): ModelProvider<TestTypes> {
  return {
    listModels: async () => [{ id: 'test-model', raw: { id: 'test-model' } }],
    embed: async () => ({ embeddings: [] }),
    streamChat: (params: { messages: Array<{ role: string }> }) => {
      const firstTurn = !params.messages.some((message) => message.role === 'tool')
      const parts: Array<MessagePart<unknown, ToolCall>> = firstTurn
        ? [
            {
              type: 'tool-call',
              toolCalls: [
                {
                  id: 'ask-1',
                  name: TOOL_ID,
                  arguments: '{}',
                  raw: { id: 'ask-1', name: TOOL_ID },
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
    },
    aggregateMessage: (
      parts: Array<ServerMessage<unknown, ToolCall>>,
    ): AggregatedMessage<ToolCall> => ({
      source: 'aggregated',
      role: 'assistant',
      text: parts.map((part) => part.text ?? '').join(''),
      toolCalls: parts.flatMap((part) => part.toolCalls ?? []),
      inputTokens: 1,
      outputTokens: 1,
    }),
    toolFromMCP: (tool) => ({ name: tool.name, description: tool.description ?? '' }),
  }
}

function textResult(result: {
  content: Array<{ type: string; text?: string }>
}): Record<string, unknown> {
  const text = result.content.find((part) => part.type === 'text')?.text
  if (text == null) throw new Error('Missing text result')
  return JSON.parse(text) as Record<string, unknown>
}

function relevant(events: Array<AgentEvent>): Array<AgentEvent> {
  return events.filter(
    (event) =>
      event.type.startsWith('elicitation-') ||
      event.type === 'tool-call-start' ||
      event.type === 'tool-call-complete' ||
      event.type === 'tool-call-error',
  )
}

function expectAgentOrder(streamed: Array<AgentEvent>, observed: Array<AgentEvent>): void {
  const events = relevant(streamed)
  expect(events).toEqual(relevant(observed))
  expect(events.map((event) => event.type)).toEqual([
    'tool-call-start',
    'elicitation-request',
    'elicitation-response',
    'tool-call-complete',
  ])
  expect(events[1]).toMatchObject({
    key: 'questions',
    params: ELICITATION_PARAMS,
    toolCall: { name: TOOL_ID },
  })
  expect(events[2]).toMatchObject({
    key: 'questions',
    action: 'accept',
    requestID: events[1]?.type === 'elicitation-request' ? events[1].requestID : undefined,
  })
}

describe('session elicitation across protocol revisions', () => {
  test('Session answers 2025 server-initiated elicitation over stdio', async () => {
    const handler = vi.fn(() => ACCEPT)
    const host = new NodeContextHost({ elicit: handler })
    const session = new Session({ contextHost: host })
    try {
      await host.addLocalContext({
        key: 'questions',
        command: process.execPath,
        args: [MOKEI_STDIO_SERVER_ELICITATION_PATH],
        protocolVersion: '2025-11-25',
      })
      const result = await host.callTool({
        key: 'questions',
        name: ELICITATION_TOOL_NAME,
        arguments: {},
      })
      expect(textResult(result)).toMatchObject({
        clientCapabilities: { elicitation: {} },
        response: ACCEPT,
      })
      expect(handler).toHaveBeenCalledWith({
        key: 'questions',
        params: ELICITATION_PARAMS,
        signal: expect.any(AbortSignal),
      })
    } finally {
      await session.dispose()
    }
  })

  test('NodeSession answers 2025 server-initiated elicitation over stdio', async () => {
    const handler = vi.fn(() => ACCEPT)
    const session = new NodeSession({ elicit: handler })
    try {
      await session.addContext({
        key: 'questions',
        command: process.execPath,
        args: [MOKEI_STDIO_SERVER_ELICITATION_PATH],
        protocolVersion: '2025-11-25',
      })
      const result = await session.contextHost.callTool({
        key: 'questions',
        name: ELICITATION_TOOL_NAME,
        arguments: {},
      })
      expect(textResult(result)).toMatchObject({
        clientCapabilities: { elicitation: {} },
        response: ACCEPT,
      })
      expect(handler).toHaveBeenCalledWith({
        key: 'questions',
        params: ELICITATION_PARAMS,
        signal: expect.any(AbortSignal),
      })
    } finally {
      await session.dispose()
    }
  })

  test('default NodeSession agent constructs without an override', async () => {
    const session = new NodeSession<TestTypes>()
    const agent = new AgentSession({ session, provider: provider(), model: 'test-model' })
    expect(agent).toBeInstanceOf(AgentSession)
    await agent.dispose()
    await session.dispose()
  })

  test('AgentSession streams 2025 elicitation and answer', async () => {
    const session = new NodeSession<TestTypes>({ elicit: true })
    const observed: Array<AgentEvent> = []
    const agent = new AgentSession({
      session,
      provider: provider(),
      model: 'test-model',
      onElicitation: () => ACCEPT,
      onEvent: (event) => observed.push(event),
    })
    try {
      await session.addContext({
        key: 'questions',
        command: process.execPath,
        args: [MOKEI_STDIO_SERVER_ELICITATION_PATH],
        protocolVersion: '2025-11-25',
      })
      const streamed: Array<AgentEvent> = []
      for await (const event of agent.stream({ prompt: 'ask' })) streamed.push(event)
      expectAgentOrder(streamed, observed)
      const complete = relevant(streamed).at(-1)
      if (complete?.type !== 'tool-call-complete') throw new Error('Missing tool result')
      expect(textResult(complete.result)).toMatchObject({
        clientCapabilities: { elicitation: {} },
        response: ACCEPT,
      })
    } finally {
      await agent.dispose()
      await session.dispose()
    }
  })

  test('Session answers 2026 MRTR elicitation over HTTP', async () => {
    const server = await startMokeiElicitationHTTPServer()
    const handler = vi.fn(() => ACCEPT)
    const session = new Session({ elicit: handler })
    const sent: Array<Record<string, unknown>> = []
    try {
      await session.addHTTPContext({
        key: 'questions',
        url: server.url,
        protocolVersion: '2026-07-28',
        fetchMiddleware: (next) => async (url, init) => {
          if (typeof init?.body === 'string')
            sent.push(JSON.parse(init.body) as Record<string, unknown>)
          return next(url, init)
        },
      })
      const result = await session.contextHost.callTool({
        key: 'questions',
        name: ELICITATION_TOOL_NAME,
        arguments: {},
      })
      expect(textResult(result)).toEqual({
        response: ACCEPT,
        requestState: JSON.stringify({ asked: true }),
        expectedState: JSON.stringify({ asked: true }),
      })
      expect(server.inputResponses).toEqual([ACCEPT])
      expect(handler).toHaveBeenCalledWith({
        key: 'questions',
        params: ELICITATION_PARAMS,
        signal: expect.any(AbortSignal),
      })
      const calls = sent.filter((item) => item.method === 'tools/call')
      // The initial call and the MRTR retry each declare the capability.
      expect(calls).toHaveLength(2)
      for (const call of calls) {
        expect(
          (call.params as { _meta?: Record<string, unknown> })?._meta?.[
            'io.modelcontextprotocol/clientCapabilities'
          ],
        ).toMatchObject({ elicitation: {} })
      }
    } finally {
      await session.dispose()
      await server.dispose()
    }
  })

  test('AgentSession streams 2026 MRTR elicitation and answer', async () => {
    const server = await startMokeiElicitationHTTPServer()
    const session = new Session<TestTypes>({ elicit: true })
    const observed: Array<AgentEvent> = []
    const agent = new AgentSession({
      session,
      provider: provider(),
      model: 'test-model',
      onElicitation: () => ACCEPT,
      onEvent: (event) => observed.push(event),
    })
    try {
      await session.addHTTPContext({
        key: 'questions',
        url: server.url,
        protocolVersion: '2026-07-28',
      })
      const streamed: Array<AgentEvent> = []
      for await (const event of agent.stream({ prompt: 'ask' })) streamed.push(event)
      expectAgentOrder(streamed, observed)
      const complete = relevant(streamed).at(-1)
      if (complete?.type !== 'tool-call-complete') throw new Error('Missing tool result')
      expect(textResult(complete.result)).toMatchObject({
        response: ACCEPT,
        requestState: JSON.stringify({ asked: true }),
      })
      expect(server.inputResponses).toEqual([ACCEPT])
    } finally {
      await agent.dispose()
      await session.dispose()
      await server.dispose()
    }
  })

  test('2025 callback rejection returns reverse RPC error', async () => {
    const session = new NodeSession<TestTypes>({ elicit: true })
    const observed: Array<AgentEvent> = []
    const agent = new AgentSession({
      session,
      provider: provider(),
      model: 'test-model',
      onElicitation: () => {
        throw new Error('answer rejected')
      },
      onEvent: (event) => observed.push(event),
    })
    try {
      await session.addContext({
        key: 'questions',
        command: process.execPath,
        args: [MOKEI_STDIO_SERVER_ELICITATION_PATH],
        protocolVersion: '2025-11-25',
      })
      const streamed: Array<AgentEvent> = []
      for await (const event of agent.stream({ prompt: 'ask' })) streamed.push(event)
      expect(relevant(streamed)).toEqual(relevant(observed))
      expect(relevant(streamed).map((event) => event.type)).toEqual([
        'tool-call-start',
        'elicitation-request',
        'elicitation-error',
        'tool-call-complete',
      ])
      const complete = relevant(streamed).at(-1)
      if (complete?.type !== 'tool-call-complete') throw new Error('Missing tool result')
      expect(textResult(complete.result).error).toContain('answer rejected')
    } finally {
      await agent.dispose()
      await session.dispose()
    }
  })

  test('2026 callback rejection fails MRTR locally without an input response', async () => {
    const server = await startMokeiElicitationHTTPServer()
    const session = new Session<TestTypes>({ elicit: true })
    const observed: Array<AgentEvent> = []
    const agent = new AgentSession({
      session,
      provider: provider(),
      model: 'test-model',
      onElicitation: () => {
        throw new Error('answer rejected')
      },
      onEvent: (event) => observed.push(event),
    })
    try {
      await session.addHTTPContext({
        key: 'questions',
        url: server.url,
        protocolVersion: '2026-07-28',
      })
      const streamed: Array<AgentEvent> = []
      for await (const event of agent.stream({ prompt: 'ask' })) streamed.push(event)
      expect(relevant(streamed)).toEqual(relevant(observed))
      expect(relevant(streamed).map((event) => event.type)).toEqual([
        'tool-call-start',
        'elicitation-request',
        'elicitation-error',
        'tool-call-error',
      ])
      expect(server.inputResponses).toEqual([])
      const terminal = relevant(streamed).at(-1)
      if (terminal?.type !== 'tool-call-error') throw new Error('Missing tool error')
      expect(terminal.error.message).toContain('answer rejected')
    } finally {
      await agent.dispose()
      await session.dispose()
      await server.dispose()
    }
  })
})
