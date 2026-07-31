# Creating MCP Clients

Package: `@mokei/context-client`

## Installation

```bash
npm install @mokei/context-client
```

## Basic Client

```typescript
import { ContextClient } from '@mokei/context-client'
import { NodeStreamsTransport } from '@enkaku/node-streams-transport'

// Create transport (e.g., from spawned process)
const transport = new NodeStreamsTransport({
  streams: { readable: childProcess.stdout, writable: childProcess.stdin }
})

const client = new ContextClient({ transport, protocolVersion: '2026-07-28' })

// No handshake on 2026-07-28 — the client sets itself up lazily on its first call.
const { tools } = await client.listTools()
```

## Client Configuration

`elicit`, `createMessage` and `listRoots` are server-initiated requests, present only on
`2025-11-25` — `2026-07-28` refuses them at client setup (MRTR, SEP-2322, replaces
server-initiated requests, and mokei does not implement MRTR yet).

```typescript
import { ContextClient, type ClientParams } from '@mokei/context-client'

const client = new ContextClient({
  transport,
  protocolVersion: '2025-11-25',

  // Handle elicitation requests from server
  elicit: async ({ params, signal }) => {
    const userResponse = await promptUser(params.message)
    return { action: 'accept', content: userResponse }
  },

  // Handle sampling requests from server
  createMessage: async ({ params, signal }) => {
    const result = await myLLM.chat(params.messages)
    return {
      role: 'assistant',
      content: { type: 'text', text: result.text },
      model: 'my-model'
    }
  },

  // Provide workspace roots
  listRoots: [
    { uri: 'file:///path/to/workspace', name: 'Project Root' }
  ]
  // Or as async function:
  // listRoots: async ({ signal }) => [{ uri: '...', name: '...' }]
})
```

## Listing Tools

```typescript
const { tools } = await client.listTools()

for (const tool of tools) {
  console.log(`Tool: ${tool.name}`)
  console.log(`  Description: ${tool.description}`)
  console.log(`  Input Schema:`, tool.inputSchema)
}
```

The list methods (`listTools`, `listPrompts`, `listResources`, `listResourceTemplates`)
follow pagination automatically. Alongside `signal` and `timeout`, they accept `maxPages`
to cap how many pages are fetched, overriding the client's `listMaxPages` for that call:

```typescript
const { tools } = await client.listTools({ maxPages: 5, timeout: 10_000 })
```

## Calling Tools

```typescript
// Basic tool call
const result = await client.callTool({
  name: 'greet',
  arguments: { name: 'Alice' }
})

// Handle result
if (result.isError) {
  console.error('Tool error:', result.content)
} else {
  for (const content of result.content) {
    if (content.type === 'text') {
      console.log('Result:', content.text)
    } else if (content.type === 'image') {
      console.log('Image:', content.mimeType, content.data.length, 'bytes')
    }
  }
}

// With metadata (e.g., progress token)
const result = await client.callTool({
  name: 'long_operation',
  arguments: { data: '...' },
  _meta: { progressToken: 'op-123' }
})
```

## Listing and Using Prompts

```typescript
// List available prompts
const { prompts } = await client.listPrompts()

for (const prompt of prompts) {
  console.log(`Prompt: ${prompt.name}`)
  console.log(`  Description: ${prompt.description}`)
  console.log(`  Arguments:`, prompt.arguments)
}

// Get a prompt
const promptResult = await client.getPrompt({
  name: 'code_review',
  arguments: { language: 'typescript', code: 'const x = 1' }
})

console.log('Prompt messages:', promptResult.messages)
```

## Working with Resources

```typescript
// List resources
const { resources } = await client.listResources()

for (const resource of resources) {
  console.log(`Resource: ${resource.name}`)
  console.log(`  URI: ${resource.uri}`)
  console.log(`  MIME Type: ${resource.mimeType}`)
}

// List resource templates
const { resourceTemplates } = await client.listResourceTemplates()

// Read a resource
const { contents } = await client.readResource({ uri: 'file:///config.json' })

for (const content of contents) {
  if ('text' in content) {
    console.log('Text content:', content.text)
  } else if ('blob' in content) {
    console.log('Binary content:', content.blob.length, 'bytes')
  }
}
```

## Completions

```typescript
// Get argument completions
const { completion } = await client.complete({
  ref: { type: 'ref/prompt', name: 'code_review' },
  argument: { name: 'language', value: 'type' }
})

console.log('Suggestions:', completion.values)
// ['typescript']
```

## Logging

`setLoggingLevel` requires `logging/setLevel`, present only on `2025-11-25` — `2026-07-28`
carries the log level in each request's `_meta` instead and refuses this call.

```typescript
// Set logging level
await client.setLoggingLevel({ level: 'debug' })

// Listen for log messages from server
client.events.on('log', (log) => {
  console.log(`[${log.level}]`, log.data)
})
```

## Handling Notifications

```typescript
// Get readable stream of notifications
const notifications = client.notifications

const reader = notifications.getReader()
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  
  switch (value.method) {
    case 'notifications/resources/updated':
      console.log('Resource updated:', value.params.uri)
      break
    case 'notifications/tools/list_changed':
      console.log('Tools changed, refreshing...')
      const { tools } = await client.listTools()
      break
  }
}
```

## Type-Safe Client

When the server exports types, use them for full type safety:

```typescript
import type { SqliteServerTypes } from '@mokei/mcp-sqlite'
import { ContextClient } from '@mokei/context-client'

const client = new ContextClient<SqliteServerTypes>({ transport, protocolVersion: '2026-07-28' })

// Fully typed tool call
const result = await client.callTool({
  name: 'sqlite_all',  // autocomplete available
  arguments: { 
    sql: 'SELECT * FROM users',  // typed
    parameters: { id: 1 }        // typed
  }
})
```

## Request Cancellation

Every request method takes an optional `signal` and `timeout` alongside its params. Both
cancel the request in flight and notify the server.

```typescript
const controller = new AbortController()

const request = client.callTool({
  name: 'long_operation',
  arguments: { data: '...' },
  signal: controller.signal,
})

// Cancel after 5 seconds
setTimeout(() => controller.abort(), 5000)

try {
  const result = await request
} catch (err) {
  if (err.name === 'AbortError') {
    console.log('Request was cancelled')
  }
}
```

A `timeout` rejects the request with a `RequestTimeoutError` on its own:

```typescript
const result = await client.callTool({
  name: 'long_operation',
  arguments: { data: '...' },
  timeout: 5000,
})
```

## Events

The `initialized` event fires only from `2025-11-25`'s handshake — `2026-07-28` has no
handshake, so it never fires there; use `discover()` for server identity and capabilities
instead.

```typescript
// When server initialization completes (2025-11-25 only)
client.events.on('initialized', (result) => {
  console.log('Server capabilities:', result.capabilities)
})

// Log messages from server
client.events.on('log', (log) => {
  console.log(`[${log.level}]`, log.data, log.logger)
})
```

## Complete Example

```typescript
import { ContextClient } from '@mokei/context-client'
import { spawn } from 'node:child_process'
import { NodeStreamsTransport } from '@enkaku/node-streams-transport'

async function main() {
  // Spawn MCP server
  const serverProcess = spawn('node', ['server.js'], {
    stdio: ['pipe', 'pipe', 'inherit']
  })
  
  // Create transport
  const transport = new NodeStreamsTransport({
    streams: { 
      readable: serverProcess.stdout!, 
      writable: serverProcess.stdin! 
    }
  })
  
  // Create the client — no handshake on 2026-07-28, setup happens lazily on first call
  const client = new ContextClient({ transport, protocolVersion: '2026-07-28' })

  // List available tools
  const { tools } = await client.listTools()
  console.log('Available tools:', tools.map(t => t.name))
  
  // Call a tool
  if (tools.some(t => t.name === 'greet')) {
    const result = await client.callTool({
      name: 'greet',
      arguments: { name: 'World' }
    })
    console.log('Greeting:', result.content[0])
  }
  
  // Cleanup
  await transport.dispose()
  serverProcess.kill()
}

main().catch(console.error)
```
