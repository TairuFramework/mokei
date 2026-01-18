# @mokei/anthropic-provider

Anthropic Claude provider for Mokei.

## Installation

```bash
npm install @mokei/anthropic-provider
```

## Usage

### Basic Chat

```typescript
import { AnthropicProvider } from '@mokei/anthropic-provider'

const provider = AnthropicProvider.fromConfig({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// List available models
const models = await provider.listModels()
console.log(models)

// Stream a chat completion
const request = provider.streamChat({
  model: 'claude-sonnet-4-20250514',
  messages: [
    { source: 'client', role: 'user', text: 'Hello, Claude!' }
  ],
})

for await (const stream of await request) {
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value.type === 'text-delta') {
      process.stdout.write(value.text)
    }
  }
}
```

### With Tool Calling

```typescript
import { AnthropicProvider } from '@mokei/anthropic-provider'
import { ContextHost } from '@mokei/host'
import { AgentSession } from '@mokei/session'

const provider = AnthropicProvider.fromConfig({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const host = new ContextHost()
// ... add MCP contexts

const agent = new AgentSession({
  provider,
  model: 'claude-sonnet-4-20250514',
  host,
  systemPrompt: 'You are a helpful assistant.',
})

const result = await agent.run('What files are in the current directory?')
console.log(result.text)
```

### Configuration Options

```typescript
import { AnthropicProvider } from '@mokei/anthropic-provider'

const provider = AnthropicProvider.fromConfig({
  // Required: Your Anthropic API key
  apiKey: 'sk-ant-...',
  
  // Optional: Base URL (default: https://api.anthropic.com/v1)
  baseURL: 'https://api.anthropic.com/v1',
  
  // Optional: Request timeout in ms (default: 60000)
  timeout: 60000,
  
  // Optional: Anthropic API version (default: 2023-06-01)
  anthropicVersion: '2023-06-01',
})
```

## Extended Thinking

Claude models with extended thinking capabilities will emit `reasoning-delta` events during streaming, which are captured in the `reasoning` field of aggregated messages.

## Limitations

- **No Embeddings**: Anthropic doesn't provide an embeddings API. Use OpenAI or another provider for embeddings.

## License

MIT
