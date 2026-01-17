# Agent Session

Package: `@mokei/session`

## Installation

```bash
npm install @mokei/session
```

## Overview

`AgentSession` provides an automatic agent loop that handles chat completion, tool calling, and iteration until the task is complete. It abstracts away the manual loop of:

1. Send message to model
2. Check for tool calls
3. Execute tools
4. Send results back
5. Repeat until done

## Basic Usage

```typescript
import { AgentSession } from '@mokei/session'
import { ContextHost } from '@mokei/host'
import { OpenAIProvider } from '@mokei/openai-provider'

// Set up host with MCP servers
const host = new ContextHost()
await host.addLocalContext({
  key: 'sqlite',
  command: 'npx',
  args: ['-y', '@mokei/mcp-sqlite']
})
await host.setup('sqlite')

// Create provider
const provider = OpenAIProvider.fromConfig({
  apiKey: process.env.OPENAI_API_KEY
})

// Create agent
const agent = new AgentSession({
  provider,
  model: 'gpt-4',
  host,
})

// Run to completion
const result = await agent.run('Create a users table and insert 3 sample records')

console.log('Final response:', result.text)
console.log('Iterations:', result.iterations)
console.log('Tool calls:', result.toolCalls.length)
```

## Configuration

```typescript
import { AgentSession, type AgentParams } from '@mokei/session'

const agent = new AgentSession({
  // Required
  provider: openaiProvider,     // ModelProvider instance or key from providers map
  model: 'gpt-4',               // Model identifier
  host: contextHost,            // ContextHost with MCP servers

  // Optional
  systemPrompt: 'You are a helpful assistant.',  // Prepended to messages
  toolApproval: 'auto',         // Tool approval strategy (default: 'auto')
  maxIterations: 10,            // Max iterations before stopping (default: 10)
  timeout: 300000,              // Timeout in ms (default: 5 minutes)
  onEvent: (event) => {         // Callback for each event
    console.log(event.type)
  }
})
```

## Tool Approval Strategies

Control how tool calls are approved:

### `'auto'` (default)

Execute all tools automatically without prompting:

```typescript
const agent = new AgentSession({
  provider,
  model: 'gpt-4',
  host,
  toolApproval: 'auto'
})
```

### `'never'`

Never execute tools (dry run mode):

```typescript
const agent = new AgentSession({
  provider,
  model: 'gpt-4',
  host,
  toolApproval: 'never'
})
```

### `'ask'`

Emit a pending event before each tool call. Currently auto-approves after emitting:

```typescript
const agent = new AgentSession({
  provider,
  model: 'gpt-4',
  host,
  toolApproval: 'ask'
})

// Listen for pending events
agent.events.on('event', (event) => {
  if (event.type === 'tool-call-pending') {
    console.log('Tool call pending:', event.toolCall.name)
  }
})
```

### Custom Function

Provide a function to decide approval:

```typescript
const agent = new AgentSession({
  provider,
  model: 'gpt-4',
  host,
  toolApproval: async (toolCall, context) => {
    // Check the tool being called
    if (toolCall.name.includes('delete')) {
      return { approved: false, reason: 'Deletion not allowed' }
    }

    // Check iteration count
    if (context.iteration > 5) {
      return false  // Deny after 5 iterations
    }

    // Access tool definition
    console.log('Tool description:', context.tool?.tool.description)

    // Review history
    const errorCount = context.history.filter(e => e.type === 'tool-call-error').length
    if (errorCount > 2) {
      return { approved: false, reason: 'Too many errors' }
    }

    return true  // Approve
  }
})
```

## Streaming Events

Use `stream()` to receive events as they occur:

```typescript
for await (const event of agent.stream('Create a users table')) {
  switch (event.type) {
    case 'start':
      console.log('Starting with prompt:', event.prompt)
      break

    case 'iteration-start':
      console.log(`\n--- Iteration ${event.iteration} ---`)
      break

    case 'text-delta':
      process.stdout.write(event.text)
      break

    case 'text-complete':
      console.log('\nText complete:', event.text.length, 'chars')
      break

    case 'tool-call-approved':
      console.log('Approved:', event.toolCall.name)
      break

    case 'tool-call-denied':
      console.log('Denied:', event.toolCall.name, event.reason)
      break

    case 'tool-call-start':
      console.log('Executing:', event.toolCall.name)
      break

    case 'tool-call-complete':
      console.log('Result:', event.result.content)
      break

    case 'tool-call-error':
      console.error('Error:', event.error.message)
      break

    case 'iteration-complete':
      console.log(`Iteration ${event.iteration} complete, has tools:`, event.hasToolCalls)
      break

    case 'max-iterations':
      console.log('Hit max iterations limit')
      break

    case 'timeout':
      console.log('Execution timed out')
      break

    case 'complete':
      console.log('\n=== Complete ===')
      console.log('Text:', event.result.text)
      console.log('Iterations:', event.result.iterations)
      console.log('Finish reason:', event.result.finishReason)
      break

    case 'error':
      console.error('Agent error:', event.error)
      break
  }
}
```

## Event Types

All events include a `timestamp` field (Unix ms).

| Event Type | Description | Additional Fields |
|------------|-------------|-------------------|
| `start` | Agent begins execution | `prompt` |
| `iteration-start` | New iteration begins | `iteration` |
| `text-delta` | Streaming text chunk | `text` |
| `text-complete` | Full text for iteration | `text` |
| `tool-call-pending` | Tool awaiting approval | `toolCall` |
| `tool-call-approved` | Tool was approved | `toolCall` |
| `tool-call-denied` | Tool was denied | `toolCall`, `reason?` |
| `tool-call-start` | Tool execution begins | `toolCall` |
| `tool-call-complete` | Tool executed successfully | `toolCall`, `result` |
| `tool-call-error` | Tool execution failed | `toolCall`, `error` |
| `iteration-complete` | Iteration finished | `iteration`, `hasToolCalls` |
| `max-iterations` | Hit iteration limit | `iteration` |
| `timeout` | Execution timed out | - |
| `complete` | Agent finished | `result` |
| `error` | Error occurred | `error` |

## Result Type

```typescript
type AgentResult = {
  text: string              // Final text response
  iterations: number        // Total iterations executed
  toolCalls: Array<{        // All tool calls made
    call: FunctionToolCall<unknown>
    result?: CallToolResult
    approved: boolean
    denialReason?: string
    error?: Error
  }>
  inputTokens: number       // Total input tokens
  outputTokens: number      // Total output tokens
  duration: number          // Execution time (ms)
  finishReason: 'complete' | 'max-iterations' | 'timeout' | 'aborted' | 'error'
}
```

## Cancellation

### Using AbortSignal

```typescript
const controller = new AbortController()

// Cancel after 10 seconds
setTimeout(() => controller.abort(), 10000)

const result = await agent.run('Complex task', controller.signal)

if (result.finishReason === 'aborted') {
  console.log('Agent was cancelled')
}
```

### Timeout

```typescript
const agent = new AgentSession({
  provider,
  model: 'gpt-4',
  host,
  timeout: 60000  // 1 minute
})

const result = await agent.run('Task')

if (result.finishReason === 'timeout') {
  console.log('Agent timed out')
}
```

## Event Emitter

Subscribe to events via the `events` property:

```typescript
agent.events.on('event', (event) => {
  // Handle all events
  console.log(`[${event.type}]`, event.timestamp)
})

// Run agent
await agent.run('Do something')
```

## Complete Example

```typescript
import { AgentSession } from '@mokei/session'
import { ContextHost } from '@mokei/host'
import { OpenAIProvider } from '@mokei/openai-provider'

async function main() {
  // Setup
  const host = new ContextHost()
  await host.addLocalContext({
    key: 'sqlite',
    command: 'npx',
    args: ['-y', '@mokei/mcp-sqlite', '--db', ':memory:']
  })
  await host.setup('sqlite')

  const provider = OpenAIProvider.fromConfig({
    apiKey: process.env.OPENAI_API_KEY!
  })

  // Create agent with custom approval
  const agent = new AgentSession({
    provider,
    model: 'gpt-4',
    host,
    systemPrompt: 'You are a database assistant. Use the sqlite tools to help users.',
    maxIterations: 5,
    toolApproval: async (toolCall) => {
      // Only allow SELECT queries
      const args = JSON.parse(toolCall.arguments)
      if (args.sql && !args.sql.trim().toUpperCase().startsWith('SELECT')) {
        return { approved: false, reason: 'Only SELECT queries allowed' }
      }
      return true
    }
  })

  // Stream execution
  console.log('Starting agent...\n')

  for await (const event of agent.stream('Show me all tables in the database')) {
    if (event.type === 'text-delta') {
      process.stdout.write(event.text)
    } else if (event.type === 'tool-call-approved') {
      console.log(`\n[Calling ${event.toolCall.name}...]`)
    } else if (event.type === 'tool-call-denied') {
      console.log(`\n[Denied: ${event.reason}]`)
    } else if (event.type === 'complete') {
      console.log(`\n\n--- Done in ${event.result.iterations} iterations ---`)
    }
  }

  // Cleanup
  await host.dispose()
}

main().catch(console.error)
```

## Default Values

```typescript
import { AGENT_DEFAULTS } from '@mokei/session'

console.log(AGENT_DEFAULTS)
// {
//   maxIterations: 10,
//   timeout: 300000,  // 5 minutes
//   toolApproval: 'auto'
// }
```
