import { OllamaProvider, type OllamaTypes } from '@mokei/ollama-provider'
import { OpenAIProvider, type OpenAITypes } from '@mokei/openai-provider'
import { Session } from '@mokei/session'

const FETCH_MCP_SERVER_PATH = '../mcp-servers/fetch/lib/index.js'

describe.each([
  [
    'Ollama',
    {
      T: {} as OllamaTypes,
      model: 'qwen3:8b',
      session: new Session<OllamaTypes>({ provider: new OllamaProvider() }),
    },
  ],
  [
    'OpenAI',
    {
      T: {} as OpenAITypes,
      model: 'qwen3-8b',
      session: new Session<OpenAITypes>({
        provider: new OpenAIProvider({
          // LM Studio
          client: { baseURL: 'http://127.0.0.1:1234/v1' },
        }),
      }),
    },
  ],
])('Using the %s provider', (name, config) => {
  const session = config.session as Session<typeof config.T>

  test('executes a tool call', async () => {
    try {
      const tools = await session.addContext({
        key: 'fetch',
        file: 'node',
        arguments: [FETCH_MCP_SERVER_PATH],
      })
      expect(tools).toHaveLength(1)

      const reply = await session.chat({
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
    } finally {
      await session.dispose()
    }
  }, 30_000)
})
