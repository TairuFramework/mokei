import { AnthropicProvider } from '@mokei/anthropic-provider'
import type { ModelProvider } from '@mokei/model-provider'
import { OllamaProvider } from '@mokei/ollama-provider'
import { OpenAIProvider } from '@mokei/openai-provider'
import { Session } from '@mokei/session'
import { beforeAll, describe, expect, test } from 'vitest'

import {
  CHAT_MODEL,
  type ChatProviderTypes,
  chatBackend,
  createChatProvider,
  hasChatBackend,
} from '../support/requirements.js'

const FETCH_MCP_SERVER_PATH = '../mcp-servers/fetch/lib/serve.js'

const model = CHAT_MODEL

/**
 * Against ollama this is one local server reached three ways: its native API plus its
 * OpenAI and Anthropic compatibility endpoints. llama-server serves the OpenAI-compatible
 * API only, so it contributes a single entry.
 */
const providers: Array<[string, ModelProvider<ChatProviderTypes>]> =
  chatBackend.kind === 'ollama'
    ? [
        [
          'Ollama',
          new OllamaProvider({
            client: { baseURL: chatBackend.baseURL },
          }) as ModelProvider<ChatProviderTypes>,
        ],
        [
          'Anthropic-compatible',
          new AnthropicProvider({
            client: { baseURL: chatBackend.openaiBaseURL },
          }) as ModelProvider<ChatProviderTypes>,
        ],
        [
          'OpenAI-compatible',
          new OpenAIProvider({
            client: { baseURL: chatBackend.openaiBaseURL },
          }) as ModelProvider<ChatProviderTypes>,
        ],
      ]
    : [['OpenAI-compatible', createChatProvider()]]

describe.skipIf(!hasChatBackend)('Session', () => {
  const session = new Session<ChatProviderTypes>()

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

  describe.each(providers)('using the %s provider', (_name, provider) => {
    test('executes a tool call', async () => {
      const reply = await session.chat({
        provider,
        model,
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

      const toolResult = await session.executeToolCall({ toolCall })
      expect(toolResult).toMatchObject({
        content: [{ type: 'text', text: expect.stringContaining('Mokei') }],
        isError: false,
      })
    }, 30_000)
  })
})
