# Session Management

Package: `@mokei/session`

## Installation

```bash
npm install @mokei/session
```

## Overview

`Session` is a high-level abstraction that combines:
- **ContextHost**: Managing multiple MCP server connections
- **Model Providers**: AI model integration (OpenAI, Ollama)
- **Chat**: Streaming conversations with tool calling

## Basic Usage

```typescript
import { Session } from '@mokei/session'
import { OpenAIProvider } from '@mokei/openai-provider'

// Create session with providers
const session = new Session({
  providers: {
    openai: OpenAIProvider.fromConfig({ apiKey: process.env.OPENAI_API_KEY })
  }
})

// Add MCP server context
await session.addContext({
  key: 'sqlite',
  command: 'npx',
  args: ['-y', '@mokei/mcp-sqlite']
})

// Chat with tool access
const response = await session.chat({
  provider: 'openai',
  model: 'gpt-4',
  messages: [
    { source: 'client', role: 'user', text: 'Create a users table' }
  ]
})

console.log('Response:', response.text)
console.log('Tool calls:', response.toolCalls)

// Cleanup
await session.dispose()
```

## Adding Contexts

```typescript
// Add with all tools enabled
const tools = await session.addContext({
  key: 'db',
  command: 'node',
  args: ['db-server.js'],
  env: { DB_PATH: './data.db' }
})

// Add with specific tools enabled
const tools = await session.addContext({
  key: 'fs',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', './'],
  enableTools: ['read_file', 'list_directory']  // Only enable these
})

// Add with dynamic tool selection
const tools = await session.addContext({
  key: 'api',
  command: 'api-server',
  enableTools: async (availableTools) => {
    // Filter out dangerous tools
    return availableTools
      .filter(t => !t.name.includes('delete'))
      .map(t => t.name)
  }
})

// With abort signal for timeout
const controller = new AbortController()
setTimeout(() => controller.abort(), 5000)

const tools = await session.addContext({
  key: 'slow-server',
  command: 'slow-server',
  signal: controller.signal
})
```

## Remote HTTP Contexts

Connect to remote MCP servers via HTTP using the MCP Streamable HTTP transport specification.

```typescript
// Basic HTTP connection
const client = await session.contextHost.addHttpContext({
  key: 'remote-api',
  url: 'https://mcp.example.com/api',
})

// Setup tools after connecting
const tools = await session.contextHost.setup('remote-api')

// With authentication
const client = await session.contextHost.addHttpContext({
  key: 'authenticated-api',
  url: 'https://mcp.example.com/api',
  auth: { type: 'bearer', token: 'your-api-key' },
  timeout: 60000,
})

// Basic auth
const client = await session.contextHost.addHttpContext({
  key: 'basic-auth-api',
  url: 'https://mcp.example.com/api',
  auth: { type: 'basic', username: 'user', password: 'pass' },
})

// Custom header auth (e.g., API keys)
const client = await session.contextHost.addHttpContext({
  key: 'api-key-api',
  url: 'https://mcp.example.com/api',
  auth: { type: 'header', name: 'X-API-Key', value: 'your-key' },
})

// Custom headers
const client = await session.contextHost.addHttpContext({
  key: 'custom-headers',
  url: 'https://mcp.example.com/api',
  headers: {
    'X-Custom-Header': 'value',
    'X-Request-ID': crypto.randomUUID(),
  },
})
```

The HTTP transport:
- Implements MCP Streamable HTTP specification
- Manages session IDs automatically via `Mcp-Session-Id` header
- Supports JSON and SSE responses
- Includes protocol version header on all requests

## Managing Providers

```typescript
import { OllamaProvider } from '@mokei/ollama-provider'

// Add provider dynamically
session.addProvider('ollama', OllamaProvider.fromConfig({
  apiUrl: 'http://localhost:11434'
}))

// Get provider
const provider = session.getProvider('openai')

// Remove provider
session.removeProvider('ollama')

// List providers
const providerNames = [...session.providers.keys()]
```

## Local Tools

Register tools directly without setting up an MCP server. Local tools are namespaced with `local:` prefix.

### Defining Local Tools

```typescript
import { Session, type LocalToolDefinition } from '@mokei/session'

const calculateTool: LocalToolDefinition = {
  name: 'calculate',
  description: 'Evaluate a math expression',
  inputSchema: {
    type: 'object',
    properties: {
      expression: { type: 'string', description: 'Math expression to evaluate' }
    },
    required: ['expression']
  },
  execute: async ({ expression }) => {
    try {
      const result = Function(`"use strict"; return (${expression})`)()
      return { content: [{ type: 'text', text: String(result) }] }
    } catch (error) {
      return { 
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true 
      }
    }
  }
}
```

### Registering at Construction

```typescript
const session = new Session({
  providers: { openai },
  localTools: [
    calculateTool,
    {
      name: 'echo',
      description: 'Echo the input back',
      inputSchema: {
        type: 'object',
        properties: { message: { type: 'string' } }
      },
      execute: async ({ message }) => ({
        content: [{ type: 'text', text: message as string }]
      })
    }
  ]
})
```

### Dynamic Registration

```typescript
// Add a single tool
session.addLocalTool({
  name: 'getCurrentTime',
  description: 'Get the current time',
  inputSchema: { type: 'object' },
  execute: async () => ({
    content: [{ type: 'text', text: new Date().toISOString() }]
  })
})

// Add multiple tools
session.addLocalTools([tool1, tool2, tool3])

// Remove a tool
session.removeLocalTool('getCurrentTime')
```

### Mixed Local and MCP Tools

Local tools work alongside MCP server tools:

```typescript
const session = new Session({
  providers: { openai },
  localTools: [calculateTool]
})

// Add MCP server
await session.addContext({
  key: 'sqlite',
  command: 'npx',
  args: ['-y', '@mokei/mcp-sqlite']
})

// Both tools available
const tools = session.contextHost.getCallableTools()
// ['local:calculate', 'sqlite:query', 'sqlite:execute', ...]
```

### Executing Local Tools

Local tools are executed the same way as MCP tools:

```typescript
const result = await session.executeToolCall({
  id: 'call-1',
  name: 'local:calculate',
  arguments: JSON.stringify({ expression: '2 + 2' }),
  raw: {}
})

console.log(result.content[0].text)  // "4"
```

### Tool Annotations

Provide hints about tool behavior:

```typescript
const safeTool: LocalToolDefinition = {
  name: 'readConfig',
  description: 'Read configuration file',
  inputSchema: { type: 'object' },
  annotations: {
    readOnlyHint: true,      // Doesn't modify anything
    idempotentHint: true,    // Same result on repeated calls
    openWorldHint: false,    // Closed domain (local files only)
    title: 'Read Config'     // UI display name
  },
  execute: async () => ({
    content: [{ type: 'text', text: '{}' }]
  })
}
```

## Chat API

### Basic Chat

```typescript
const response = await session.chat({
  provider: 'openai',
  model: 'gpt-4',
  messages: [
    { source: 'client', role: 'user', text: 'Hello!' }
  ]
})

console.log(response.text)        // Response text
console.log(response.toolCalls)   // Any tool calls requested
console.log(response.inputTokens) // Tokens used for input
console.log(response.outputTokens)// Tokens used for output
```

### With Custom Tools

```typescript
// Get tools formatted for the provider
const tools = session.getToolsForProvider(session.getProvider('openai'))

// Or let session include all enabled MCP tools automatically
const response = await session.chat({
  provider: 'openai',
  model: 'gpt-4',
  messages: [...],
  tools  // Optional: override default tools
})
```

### Handling Tool Calls

```typescript
const response = await session.chat({
  provider: 'openai',
  model: 'gpt-4',
  messages: [{ source: 'client', role: 'user', text: 'List all users' }]
})

if (response.toolCalls.length > 0) {
  // Execute each tool call
  for (const toolCall of response.toolCalls) {
    console.log(`Executing ${toolCall.name}...`)
    
    const result = await session.executeToolCall(toolCall)
    
    if (result.isError) {
      console.error('Tool error:', result.content)
    } else {
      console.log('Tool result:', result.content)
    }
  }
}
```

### Conversation Loop

```typescript
async function conversationLoop(session: Session, userMessage: string) {
  const messages: Array<Message> = [
    { source: 'client', role: 'user', text: userMessage }
  ]
  
  while (true) {
    const response = await session.chat({
      provider: 'openai',
      model: 'gpt-4',
      messages
    })
    
    // Add assistant response to history
    messages.push({
      source: 'aggregated',
      role: 'assistant',
      text: response.text,
      toolCalls: response.toolCalls
    })
    
    // If no tool calls, we're done
    if (response.toolCalls.length === 0) {
      return response.text
    }
    
    // Execute tool calls and add results
    for (const toolCall of response.toolCalls) {
      const result = await session.executeToolCall(toolCall)
      messages.push({
        source: 'client',
        role: 'user',
        text: JSON.stringify(result.content),
        toolCallId: toolCall.id
      })
    }
  }
}
```

### Request Management

```typescript
// Check if chat is active
if (session.activeChatRequest !== null) {
  console.log('Chat in progress...')
}

// Abort active request to start new one
const response = await session.chat({
  provider: 'openai',
  model: 'gpt-4',
  messages: [...],
  abortActiveRequest: true  // Cancel any ongoing chat
})

// With abort signal
const controller = new AbortController()
setTimeout(() => controller.abort(), 30000)

const response = await session.chat({
  provider: 'openai',
  model: 'gpt-4',
  messages: [...],
  signal: controller.signal
})
```

## Events

```typescript
// Context added
session.events.on('context-added', ({ key, tools }) => {
  console.log(`Context ${key} added with tools:`, tools.map(t => t.tool.name))
})

// Context removed
session.events.on('context-removed', ({ key }) => {
  console.log(`Context ${key} removed`)
})

// Message streaming (for real-time UI updates)
session.events.on('message-part', (part) => {
  switch (part.type) {
    case 'text-delta':
      process.stdout.write(part.text)
      break
    case 'tool-call':
      console.log('Tool call:', part.toolCalls)
      break
    case 'reasoning-delta':
      console.log('Reasoning:', part.reasoning)
      break
    case 'done':
      console.log(`\nDone. Tokens: ${part.inputTokens}/${part.outputTokens}`)
      break
    case 'error':
      console.error('Error:', part.error)
      break
  }
})
```

## Accessing Host Directly

For advanced operations, access the underlying `ContextHost`:

```typescript
const host = session.contextHost

// List contexts
const keys = host.getContextKeys()

// Get all enabled tools
const tools = host.getEnabledTools()

// Disable specific tools
host.disableContextTools('db', ['drop_table'])

// Call tool directly (bypassing provider)
const result = await host.callNamespacedTool('db:query', { sql: 'SELECT 1' })
```

## Complete Example

```typescript
import { Session } from '@mokei/session'
import { OpenAIProvider } from '@mokei/openai-provider'
import * as readline from 'node:readline'

async function main() {
  // Create session
  const session = new Session({
    providers: {
      openai: OpenAIProvider.fromConfig({ 
        apiKey: process.env.OPENAI_API_KEY! 
      })
    }
  })
  
  // Add MCP server
  await session.addContext({
    key: 'sqlite',
    command: 'npx',
    args: ['-y', '@mokei/mcp-sqlite']
  })
  
  // Stream message parts
  session.events.on('message-part', (part) => {
    if (part.type === 'text-delta') {
      process.stdout.write(part.text)
    }
  })
  
  // Chat interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })
  
  const messages: Array<any> = []
  
  const askQuestion = () => {
    rl.question('\nYou: ', async (input) => {
      if (input === 'exit') {
        await session.dispose()
        rl.close()
        return
      }
      
      messages.push({ source: 'client', role: 'user', text: input })
      
      process.stdout.write('\nAssistant: ')
      
      const response = await session.chat({
        provider: 'openai',
        model: 'gpt-4',
        messages
      })
      
      messages.push({
        source: 'aggregated',
        role: 'assistant',
        text: response.text,
        toolCalls: response.toolCalls
      })
      
      // Handle tool calls
      for (const toolCall of response.toolCalls) {
        console.log(`\n[Calling ${toolCall.name}...]`)
        const result = await session.executeToolCall(toolCall)
        console.log('[Result]:', JSON.stringify(result.content))
        
        messages.push({
          source: 'client',
          role: 'user',
          text: JSON.stringify(result.content),
          toolCallId: toolCall.id
        })
        
        // Continue conversation with tool result
        process.stdout.write('\nAssistant: ')
        const followUp = await session.chat({
          provider: 'openai',
          model: 'gpt-4',
          messages
        })
        
        messages.push({
          source: 'aggregated',
          role: 'assistant',
          text: followUp.text,
          toolCalls: followUp.toolCalls
        })
      }
      
      console.log()
      askQuestion()
    })
  }
  
  console.log('Chat with AI (type "exit" to quit)')
  console.log('Available tools:', session.contextHost.getCallableTools().map(t => t.name))
  askQuestion()
}

main().catch(console.error)
```

## Types

### Message Types

```typescript
// User message
type ClientMessage = {
  source: 'client'
  role: 'user'
  text: string
  toolCallId?: string  // For tool results
}

// Assistant response (aggregated from stream)
type AggregatedMessage<ToolCall> = {
  source: 'aggregated'
  role: 'assistant'
  text: string
  toolCalls: Array<FunctionToolCall<ToolCall>>
  doneReason?: string
  inputTokens: number
  outputTokens: number
}

// Tool call
type FunctionToolCall<T> = {
  name: string       // Namespaced: 'context:tool'
  arguments: string  // JSON string
  id?: string        // Call ID for matching results
  raw: T            // Provider-specific data
}
```
