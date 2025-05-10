# Mokei OpenAI provider

## Installation

```sh
npm install @mokei/openai-provider
```

## Usage

```typescript
import { OpenAIProvider } from '@mokei/openai-provider'

const provider = OpenAIProvider.fromConfig({
  apiKey: 'your-api-key',
  // Optional configuration
  baseURL: 'https://api.openai.com/v1', // Default
  timeout: 30000, // Default: 30 seconds
})

// List available models
const models = await provider.listModels()

// Stream chat completion
const stream = await provider.streamChat({
  model: 'gpt-4-turbo-preview',
  messages: [
    { source: 'client', role: 'user', text: 'Hello!' }
  ],
  tools: [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get the current weather',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'The city and state, e.g. San Francisco, CA'
            }
          },
          required: ['location']
        }
      }
    }
  ]
})

for await (const part of stream) {
  if (part.type === 'text-delta') {
    console.log(part.text)
  } else if (part.type === 'tool-call') {
    console.log('Tool call:', part.toolCalls)
  }
}
```

## API

### `OpenAIProvider`

The main provider class that implements the ModelProvider interface.

#### `static fromConfig(config: OpenAIConfiguration): OpenAIProvider`

Creates a new provider instance from a configuration object.

#### `listModels(params?: RequestParams): Promise<Array<Model>>`

Lists available models.

#### `streamChat(params: StreamChatParams): StreamChatRequest`

Streams a chat completion.

#### `toolFromMCP(tool: Tool): Tool`

Converts a MCP tool to an OpenAI tool.

### Configuration

```typescript
type OpenAIConfiguration = {
  apiKey: string
  baseURL?: string
  timeout?: number | false
}
```

## License

MIT 