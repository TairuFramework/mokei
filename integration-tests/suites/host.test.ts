import { fromStream } from '@enkaku/generator'
import { ContextHost } from '@mokei/host'
import { config as fetchConfig } from '@mokei/mcp-fetch/config'
import type { ServerMessage } from '@mokei/model-provider'
import { OpenAIProvider, type OpenAITypes } from '@mokei/openai-provider'

const FETCH_MCP_SERVER_PATH = '../mcp-servers/fetch/lib/index.js'

test('executes a tool call after adding a local context', async () => {
  const host = new ContextHost()
  const provider = new OpenAIProvider({
    // LM Studio
    client: { baseURL: 'http://127.0.0.1:1234/v1' },
  })

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
      model: 'qwen3-8b',
      messages: [
        {
          source: 'client',
          role: 'user',
          text: 'Provide a short summary of what https://mokei.dev does',
        },
      ],
      tools,
    })

    const toolChunks: Array<ServerMessage<OpenAITypes['MessagePart'], OpenAITypes['ToolCall']>> = []
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
}, 120_000)

test('executes a tool call after adding a direct context', async () => {
  const host = new ContextHost()
  const provider = new OpenAIProvider({
    // LM Studio
    client: { baseURL: 'http://127.0.0.1:1234/v1' },
  })

  try {
    host.addDirectContext({ key: 'fetch', config: fetchConfig })
    await host.setup('fetch')

    const tools = host.getCallableTools().map(provider.toolFromMCP)
    expect(tools).toHaveLength(1)

    const result = await provider.streamChat({
      model: 'qwen3-8b',
      messages: [
        {
          source: 'client',
          role: 'user',
          text: 'Provide a short summary of what https://mokei.dev does',
        },
      ],
      tools,
    })

    const toolChunks: Array<ServerMessage<OpenAITypes['MessagePart'], OpenAITypes['ToolCall']>> = []
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
}, 120_000)
