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
  hasChatBackend,
  TOOL_CALL_PROMPT,
  TOOL_CALL_RETRY,
} from '../support/requirements.js'

const FETCH_MCP_SERVER_PATH = '../mcp-servers/fetch/lib/serve.js'

const model = CHAT_MODEL

/**
 * One local server reached several ways. Both backends serve OpenAI- (`/v1/chat/completions`)
 * and Anthropic-compatible (`/v1/messages`) endpoints; ollama adds its own native API, which
 * llama-server has no equivalent of.
 */
const providers: Array<[string, ModelProvider<ChatProviderTypes>]> = [
  [
    'OpenAI-compatible',
    new OpenAIProvider({
      client: { baseURL: chatBackend.openaiBaseURL },
    }) as ModelProvider<ChatProviderTypes>,
  ],
  [
    'Anthropic-compatible',
    new AnthropicProvider({
      client: { baseURL: chatBackend.openaiBaseURL },
    }) as ModelProvider<ChatProviderTypes>,
  ],
]
if (chatBackend.kind === 'ollama') {
  providers.unshift([
    'Ollama native',
    new OllamaProvider({
      client: { baseURL: chatBackend.baseURL },
    }) as ModelProvider<ChatProviderTypes>,
  ])
}

describe.skipIf(!hasChatBackend)('Session', { retry: TOOL_CALL_RETRY }, () => {
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
            text: TOOL_CALL_PROMPT,
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
