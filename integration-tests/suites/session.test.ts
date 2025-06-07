import type { ModelProvider } from '@mokei/model-provider'
import { OllamaProvider, type OllamaTypes } from '@mokei/ollama-provider'
import { OpenAIProvider, type OpenAITypes } from '@mokei/openai-provider'
import { Session } from '@mokei/session'

type ProviderTypes = OllamaTypes | OpenAITypes

const FETCH_MCP_SERVER_PATH = '../mcp-servers/fetch/lib/index.js'

describe('Session', () => {
  const session = new Session<ProviderTypes>()

  beforeAll(async () => {
    await session.addContext({
      key: 'fetch',
      file: 'node',
      args: [FETCH_MCP_SERVER_PATH],
    })
  })

  describe.each([
    [
      'Ollama',
      {
        model: 'qwen3:8b',
        provider: new OllamaProvider() as ModelProvider<ProviderTypes>,
      },
    ],
    [
      'OpenAI',
      {
        model: 'qwen3-8b',
        provider: new OpenAIProvider({
          // LM Studio
          client: { baseURL: 'http://127.0.0.1:1234/v1' },
        }) as ModelProvider<ProviderTypes>,
      },
    ],
  ])('using the %s provider', (name, config) => {
    test('executes a tool call', async () => {
      const reply = await session.chat({
        provider: config.provider,
        model: config.model,
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
        input: expect.stringContaining('https://mokei.dev'),
      })

      const toolResult = await session.executeToolCall(toolCall)
      expect(toolResult).toMatchObject({
        content: [{ type: 'text', text: expect.stringContaining('Mokei') }],
        isError: false,
      })
    }, 30_000)
  })

  afterAll(async () => {
    await session.dispose()
  })
})
