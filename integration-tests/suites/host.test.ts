import { fromStream } from '@enkaku/generator'
import { ContextHost } from '@mokei/host'
import { config as fetchConfig } from '@mokei/mcp-fetch/config'
import type { ServerMessage } from '@mokei/model-provider'
import { OllamaProvider, type OllamaTypes } from '@mokei/ollama-provider'
import { expect, test } from 'vitest'

const FETCH_MCP_SERVER_PATH = '../mcp-servers/fetch/lib/index.js'

const model = 'ministral-3:8b'
const provider = new OllamaProvider()

test('executes a tool call after adding a local context', async () => {
  const host = new ContextHost()

  try {
    await host.addLocalContext({
      key: 'fetch',
      command: 'node',
      args: [FETCH_MCP_SERVER_PATH],
    })
    await host.setup('fetch')

    const tools = host.getCallableTools().map(provider.toolFromMCP)
    expect(tools).toHaveLength(1)

    const result = await provider.streamChat({
      model,
      messages: [
        {
          source: 'client',
          role: 'user',
          text: 'Provide a short summary of what https://mokei.dev does',
        },
      ],
      tools,
    })

    const toolChunks: Array<ServerMessage<OllamaTypes['MessagePart'], OllamaTypes['ToolCall']>> = []
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
    expect(toolCall).toMatchObject({
      name: 'fetch:get_markdown',
      arguments: expect.stringContaining('https://mokei.dev'),
    })

    const toolResult = await host.callNamespacedTool(toolCall.name, JSON.parse(toolCall.arguments))
    expect(toolResult).toMatchObject({
      content: [{ type: 'text', text: expect.stringContaining('Mokei') }],
      isError: false,
    })
  } finally {
    await host.dispose()
  }
})

test('executes a tool call after adding a direct context', async () => {
  const host = new ContextHost()

  try {
    host.addDirectContext({ key: 'fetch', config: fetchConfig })
    await host.setup('fetch')

    const tools = host.getCallableTools().map(provider.toolFromMCP)
    expect(tools).toHaveLength(1)

    const result = await provider.streamChat({
      model,
      messages: [
        {
          source: 'client',
          role: 'user',
          text: 'Provide a short summary of what https://mokei.dev does',
        },
      ],
      tools,
    })

    const toolChunks: Array<ServerMessage<OllamaTypes['MessagePart'], OllamaTypes['ToolCall']>> = []
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
    expect(toolCall).toMatchObject({
      name: 'fetch:get_markdown',
      arguments: expect.stringContaining('https://mokei.dev'),
    })

    const toolResult = await host.callNamespacedTool(toolCall.name, JSON.parse(toolCall.arguments))
    expect(toolResult).toMatchObject({
      content: [{ type: 'text', text: expect.stringContaining('Mokei') }],
      isError: false,
    })
  } finally {
    await host.dispose()
  }
})
