# Quick Start

Get up and running with Mokei in minutes.

## Installation

```bash
npm install @mokei/session @mokei/openai-provider
# or
pnpm add @mokei/session @mokei/openai-provider
```

## Basic Usage

### 1. Create a Session with a Model Provider

```typescript
import { Session } from '@mokei/session'
import { OpenAIProvider } from '@mokei/openai-provider'

const session = new Session({
  providers: {
    openai: OpenAIProvider.fromConfig({
      apiKey: process.env.OPENAI_API_KEY
    })
  }
})
```

### 2. Add an MCP Server Context

```typescript
await session.addContext({
  key: 'myserver',
  command: 'node',
  args: ['my-mcp-server.js']
})
```

### 3. Chat with Tool Access

```typescript
const response = await session.chat({
  provider: 'openai',
  model: 'gpt-4',
  messages: [
    { source: 'client', role: 'user', text: 'Hello, what tools do you have?' }
  ]
})

console.log(response.text)
```

## Using the Agent Loop

For tasks requiring multiple tool calls, use `AgentSession`:

```typescript
import { AgentSession } from '@mokei/session'

const agent = new AgentSession({
  provider: openaiProvider,
  model: 'gpt-4',
  host: session.host,
  toolApproval: 'auto',
  maxIterations: 10
})

// Run to completion
const result = await agent.run('Create a users table and insert 3 records')
console.log(result.text)
console.log(`Completed in ${result.iterations} iterations`)
```

## Creating an MCP Server

```typescript
import { createTool, serveProcess } from '@mokei/context-server'

const tools = {
  greet: createTool(
    'Greets a user by name',
    {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name to greet' }
      },
      required: ['name']
    },
    (req) => ({
      content: [{ type: 'text', text: `Hello, ${req.arguments.name}!` }],
      isError: false
    })
  )
}

serveProcess({ name: 'my-server', version: '1.0.0', tools })
```

## Using Local Tools

For simple tools that don't need a separate MCP server:

```typescript
const session = new Session({
  providers: { openai: openaiProvider },
  localTools: [{
    name: 'calculate',
    description: 'Evaluate a math expression',
    inputSchema: {
      type: 'object',
      properties: { expression: { type: 'string' } },
      required: ['expression']
    },
    execute: async ({ expression }) => ({
      content: [{ type: 'text', text: String(eval(expression)) }]
    })
  }]
})
```

## Next Steps

- [Creating MCP Servers](server.md) - Full server creation guide
- [Session Guide](session.md) - Detailed session usage
- [Agent Guide](agent.md) - Agent loop patterns
- [Model Providers](providers.md) - OpenAI, Anthropic, Ollama setup
