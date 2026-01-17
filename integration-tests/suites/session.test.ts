import { AnthropicProvider, type AnthropicTypes } from '@mokei/anthropic-provider'
import type { ModelProvider } from '@mokei/model-provider'
import { OllamaProvider, type OllamaTypes } from '@mokei/ollama-provider'
import { OpenAIProvider, type OpenAITypes } from '@mokei/openai-provider'
import { Session } from '@mokei/session'
import { beforeAll, describe, expect, test } from 'vitest'

type ProviderTypes = AnthropicTypes | OllamaTypes | OpenAITypes

const FETCH_MCP_SERVER_PATH = '../mcp-servers/fetch/lib/index.js'

// Ollama Anthropic and OpenAI compatibility endpoint
const baseURL = 'http://localhost:11434/v1'
const anthropicProvider = new AnthropicProvider({
  client: { baseURL },
}) as ModelProvider<ProviderTypes>
const openaiProvider = new OpenAIProvider({ client: { baseURL } }) as ModelProvider<ProviderTypes>

describe('Session', () => {
  const session = new Session<ProviderTypes>()

  beforeAll(async () => {
    await session.addContext({
      key: 'fetch',
      command: 'node',
      args: [FETCH_MCP_SERVER_PATH],
    })

    return async () => {
      await session.dispose()
    }
  })

  describe.each([
    ['Ollama', { provider: new OllamaProvider() as ModelProvider<ProviderTypes> }],
    ['Anthropic', { provider: anthropicProvider }],
    ['OpenAI', { provider: openaiProvider }],
  ])('using the %s provider', (_name, config) => {
    test('executes a tool call', async () => {
      const reply = await session.chat({
        provider: config.provider,
        model: 'ministral-3:8b',
        messages: [
          {
            source: 'client',
            role: 'user',
            text: 'Provide a short summary of what https://mokei.dev does',
          },
        ],
      })

      const toolCall = reply.toolCalls[0]
      expect(toolCall).toMatchObject({
        name: 'fetch:get_markdown',
        arguments: expect.stringContaining('https://mokei.dev'),
      })

      const toolResult = await session.executeToolCall(toolCall)
      expect(toolResult).toMatchObject({
        content: [{ type: 'text', text: expect.stringContaining('Mokei') }],
        isError: false,
      })
    }, 30_000)
  })
})
