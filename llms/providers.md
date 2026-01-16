# Model Providers

Packages:
- `@mokei/model-provider` - Base types and interfaces
- `@mokei/openai-provider` - OpenAI API integration
- `@mokei/ollama-provider` - Ollama local models integration

## Installation

```bash
# Base types (optional, included with providers)
npm install @mokei/model-provider

# OpenAI provider
npm install @mokei/openai-provider

# Ollama provider  
npm install @mokei/ollama-provider
```

## OpenAI Provider

### Configuration

```typescript
import { OpenAIProvider } from '@mokei/openai-provider'

// From configuration
const provider = OpenAIProvider.fromConfig({
  apiKey: process.env.OPENAI_API_KEY,      // Required
  baseURL: 'https://api.openai.com/v1',    // Optional, default shown
  timeout: 30000                            // Optional, ms (false = no timeout)
})

// Or with custom client
import { OpenAIClient } from '@mokei/openai-provider'

const client = new OpenAIClient({ apiKey: '...' })
const provider = new OpenAIProvider({ client })
```

### Listing Models

```typescript
const models = await provider.listModels()

for (const model of models) {
  console.log(model.id)      // 'gpt-4', 'gpt-3.5-turbo', etc.
  console.log(model.raw)     // Full OpenAI model object
}
```

### Streaming Chat

```typescript
const request = provider.streamChat({
  model: 'gpt-4',
  messages: [
    { source: 'client', role: 'user', text: 'Hello!' }
  ],
  tools: [/* provider-specific tool format */]
})

// Get stream
const stream = await request

// Process stream
const reader = stream.getReader()
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  
  switch (value.type) {
    case 'text-delta':
      process.stdout.write(value.text)
      break
    case 'tool-call':
      console.log('Tool calls:', value.toolCalls)
      break
    case 'done':
      console.log(`Tokens: ${value.inputTokens}/${value.outputTokens}`)
      break
    case 'error':
      console.error('Error:', value.error)
      break
  }
}

// Abort if needed
request.abort()
```

### Embeddings

```typescript
const result = await provider.embed({
  model: 'text-embedding-ada-002',
  input: 'Hello, world!'
})

console.log(result.embeddings[0])  // [0.123, -0.456, ...]

// Multiple inputs
const result = await provider.embed({
  model: 'text-embedding-ada-002',
  input: ['Hello', 'World']
})
// result.embeddings[0], result.embeddings[1]
```

### Converting MCP Tools

```typescript
import type { Tool } from '@mokei/context-protocol'

const mcpTool: Tool = {
  name: 'greet',
  description: 'Greets a user',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name']
  }
}

const openAITool = provider.toolFromMCP(mcpTool)
// { type: 'function', function: { name: 'greet', description: '...', parameters: {...} } }
```

## Ollama Provider

### Configuration

```typescript
import { OllamaProvider } from '@mokei/ollama-provider'

// From configuration
const provider = OllamaProvider.fromConfig({
  baseURL: 'http://localhost:11434/api',   // Optional, default shown
  timeout: 30000                            // Optional, ms
})

// Default (localhost)
const provider = new OllamaProvider()
```

### Listing Models

```typescript
const models = await provider.listModels()

for (const model of models) {
  console.log(model.id)      // 'llama3.1:8b', 'mistral:7b', etc.
  console.log(model.raw)     // Full Ollama model object
}
```

### Streaming Chat

```typescript
const request = provider.streamChat({
  model: 'llama3.1:8b',
  messages: [
    { source: 'client', role: 'user', text: 'Hello!' }
  ],
  tools: [/* provider-specific tool format */]
})

const stream = await request

const reader = stream.getReader()
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  
  switch (value.type) {
    case 'text-delta':
      process.stdout.write(value.text)
      break
    case 'reasoning-delta':
      // For thinking models (e.g., deepseek-r1)
      console.log('Thinking:', value.reasoning)
      break
    case 'tool-call':
      console.log('Tool calls:', value.toolCalls)
      break
    case 'done':
      console.log(`Tokens: ${value.inputTokens}/${value.outputTokens}`)
      break
  }
}
```

### Embeddings

```typescript
const result = await provider.embed({
  model: 'nomic-embed-text',
  input: 'Hello, world!'
})

console.log(result.embeddings[0])
```

## Common Interface

All providers implement `ModelProvider<T>`:

```typescript
type ModelProvider<T extends ProviderTypes> = {
  // List available models
  listModels(params?: RequestParams): Promise<Array<Model<T['Model']>>>
  
  // Stream chat completion
  streamChat(params: StreamChatParams<...>): StreamChatRequest<...>
  
  // Generate embeddings
  embed(params: EmbedParams): Promise<EmbedResponse>
  
  // Aggregate streamed message parts into single response
  aggregateMessage(parts: Array<ServerMessage<...>>): AggregatedMessage<...>
  
  // Convert MCP tool to provider format
  toolFromMCP(tool: Tool): T['Tool']
}
```

## Message Types

### Client Messages

```typescript
// Text message from user/system
type ClientTextMessage = {
  source: 'client'
  role: 'system' | 'user'
  text: string
}

// Tool result message
type ClientToolMessage = {
  source: 'client'
  role: 'tool'
  toolCallID: string
  toolCallName: string
  text: string
}
```

### Server Messages (Streamed)

```typescript
type ServerMessage<RawMessage, RawToolCall> = {
  source: 'server'
  role: 'assistant'
  text?: string
  reasoning?: string
  toolCalls?: Array<FunctionToolCall<RawToolCall>>
  doneReason?: string
  inputTokens?: number
  outputTokens?: number
  raw: RawMessage
}
```

### Aggregated Messages

```typescript
type AggregatedMessage<RawToolCall> = {
  source: 'aggregated'
  role: 'assistant'
  text: string
  reasoning?: string
  toolCalls: Array<FunctionToolCall<RawToolCall>>
  doneReason?: string
  inputTokens: number
  outputTokens: number
}
```

### Message Parts (Stream Events)

```typescript
type MessagePart<RawMessagePart, RawToolCall> =
  | { type: 'text-delta'; text: string; raw: RawMessagePart }
  | { type: 'reasoning-delta'; reasoning: string; raw: RawMessagePart }
  | { type: 'tool-call'; toolCalls: Array<FunctionToolCall<RawToolCall>>; raw: RawMessagePart }
  | { type: 'done'; reason?: string; inputTokens: number; outputTokens: number }
  | { type: 'error'; error: unknown }
  | { type: 'unsupported'; raw: RawMessagePart }
```

## Complete Example

```typescript
import { OpenAIProvider } from '@mokei/openai-provider'
import type { AggregatedMessage, Message, ServerMessage } from '@mokei/model-provider'

async function chat(provider: OpenAIProvider, userMessage: string) {
  const messages: Array<Message<any, any>> = [
    { source: 'client', role: 'user', text: userMessage }
  ]
  
  const request = provider.streamChat({
    model: 'gpt-4',
    messages
  })
  
  const stream = await request
  const parts: Array<ServerMessage<any, any>> = []
  
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    
    if (value.type === 'text-delta') {
      process.stdout.write(value.text)
      parts.push({
        source: 'server',
        role: 'assistant',
        text: value.text,
        raw: value.raw
      })
    } else if (value.type === 'tool-call') {
      parts.push({
        source: 'server',
        role: 'assistant',
        toolCalls: value.toolCalls,
        raw: value.raw
      })
    } else if (value.type === 'done') {
      parts.push({
        source: 'server',
        role: 'assistant',
        doneReason: value.reason,
        inputTokens: value.inputTokens,
        outputTokens: value.outputTokens,
        raw: value.raw
      })
    }
  }
  
  // Aggregate all parts into single message
  const response = provider.aggregateMessage(parts)
  console.log('\n\nFinal response:', response.text)
  console.log('Tool calls:', response.toolCalls)
  console.log(`Tokens: ${response.inputTokens} in / ${response.outputTokens} out`)
  
  return response
}

const provider = OpenAIProvider.fromConfig({ apiKey: process.env.OPENAI_API_KEY })
await chat(provider, 'What is 2 + 2?')
```

## Using with Session

The recommended way to use providers is through `Session`:

```typescript
import { Session } from '@mokei/session'
import { OpenAIProvider } from '@mokei/openai-provider'
import { OllamaProvider } from '@mokei/ollama-provider'

const session = new Session({
  providers: {
    openai: OpenAIProvider.fromConfig({ apiKey: '...' }),
    ollama: new OllamaProvider()
  }
})

// Use OpenAI
const response1 = await session.chat({
  provider: 'openai',
  model: 'gpt-4',
  messages: [...]
})

// Use Ollama
const response2 = await session.chat({
  provider: 'ollama',
  model: 'llama3.1:8b',
  messages: [...]
})
```
