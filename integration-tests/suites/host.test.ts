import { ContextHost } from '@mokei/host'
import { NodeContextHost } from '@mokei/host-node'
import { createFetchConfig } from '@mokei/mcp-fetch'
import type { ServerMessage } from '@mokei/model-provider'
import { fromStream } from '@sozai/generator'
import { expect, test } from 'vitest'

import {
  CHAT_MODEL,
  type ChatProviderTypes,
  createChatProvider,
  hasChatBackend,
  TOOL_CALL_PROMPT,
  TOOL_CALL_RETRY,
} from '../support/requirements.js'

const FETCH_MCP_SERVER_PATH = '../mcp-servers/fetch/lib/serve.js'

const model = CHAT_MODEL
const provider = createChatProvider()

test.skipIf(!hasChatBackend)(
  'executes a tool call after adding a local context',
  { retry: TOOL_CALL_RETRY },
  async () => {
    const host = new NodeContextHost()

    try {
      await host.addLocalContext({
        key: 'fetch',
        command: 'node',
        args: [FETCH_MCP_SERVER_PATH],
      })
      await host.setup({ key: 'fetch' })

      const tools = host.getCallableTools().map(provider.toolFromMCP)
      expect(tools).toHaveLength(1)

      const result = await provider.streamChat({
        model,
        messages: [
          {
            source: 'client',
            role: 'user',
            text: TOOL_CALL_PROMPT,
          },
        ],
        tools,
      })

      const toolChunks: Array<
        ServerMessage<ChatProviderTypes['MessagePart'], ChatProviderTypes['ToolCall']>
      > = []
      for await (const chunk of fromStream(result)) {
        if (chunk.type === 'tool-call') {
          toolChunks.push({
            source: 'server',
            role: 'assistant',
            toolCalls: chunk.toolCalls,
            raw: chunk.raw,
          })
        }
      }
      const aggregatedMessage = provider.aggregateMessage(toolChunks)

      const toolCall = aggregatedMessage.toolCalls[0]
      if (toolCall == null) {
        throw new Error('expected a tool call')
      }
      expect(toolCall).toMatchObject({
        name: 'fetch:get_markdown',
        arguments: expect.stringContaining('https://mokei.dev'),
      })

      const toolResult = await host.callNamespacedTool({
        id: toolCall.name,
        arguments: JSON.parse(toolCall.arguments),
      })
      expect(toolResult).toMatchObject({
        content: [{ type: 'text', text: expect.stringContaining('Mokei') }],
        isError: false,
      })
    } finally {
      await host.dispose()
    }
  },
)

test.skipIf(!hasChatBackend)(
  'executes a tool call after adding a direct context',
  { retry: TOOL_CALL_RETRY },
  async () => {
    const host = new ContextHost()

    try {
      host.addDirectContext({ key: 'fetch', config: createFetchConfig() })
      await host.setup({ key: 'fetch' })

      const tools = host.getCallableTools().map(provider.toolFromMCP)
      expect(tools).toHaveLength(1)

      const result = await provider.streamChat({
        model,
        messages: [
          {
            source: 'client',
            role: 'user',
            text: TOOL_CALL_PROMPT,
          },
        ],
        tools,
      })

      const toolChunks: Array<
        ServerMessage<ChatProviderTypes['MessagePart'], ChatProviderTypes['ToolCall']>
      > = []
      for await (const chunk of fromStream(result)) {
        if (chunk.type === 'tool-call') {
          toolChunks.push({
            source: 'server',
            role: 'assistant',
            toolCalls: chunk.toolCalls,
            raw: chunk.raw,
          })
        }
      }
      const aggregatedMessage = provider.aggregateMessage(toolChunks)

      const toolCall = aggregatedMessage.toolCalls[0]
      if (toolCall == null) {
        throw new Error('expected a tool call')
      }
      expect(toolCall).toMatchObject({
        name: 'fetch:get_markdown',
        arguments: expect.stringContaining('https://mokei.dev'),
      })

      const toolResult = await host.callNamespacedTool({
        id: toolCall.name,
        arguments: JSON.parse(toolCall.arguments),
      })
      expect(toolResult).toMatchObject({
        content: [{ type: 'text', text: expect.stringContaining('Mokei') }],
        isError: false,
      })
    } finally {
      await host.dispose()
    }
  },
)
