# Creating MCP Clients

Package: `@mokei/context-client`

## Installation

```bash
npm install @mokei/context-client
```

## Basic Client

```typescript
import { ContextClient, type ClientTransport } from '@mokei/context-client'
import { NodeStreamsTransport } from '@enkaku/node-streams'

// Create transport (e.g., from spawned process)
const transport = new NodeStreamsTransport({
  streams: { readable: childProcess.stdout, writable: childProcess.stdin }
}) as ClientTransport

const client = new ContextClient({ transport, protocolVersion: '2026-07-28' })

// No handshake on 2026-07-28 — the client sets itself up lazily on its first call, opening
// with one `server/discover` bounded by `setupTimeout` so a server that never answers fails
// instead of hanging.
const { tools } = await client.listTools()
```

## HTTP Client

To reach a server over the MCP Streamable HTTP transport, use `createHTTPClient` from
`@mokei/http-client` instead of building a transport by hand. `protocolVersion` is required
there too:

```typescript
import { createHTTPClient } from '@mokei/http-client'

const client = createHTTPClient({
  url: 'https://mcp.example.com/mcp',
  protocolVersion: '2026-07-28',
})

const { tools } = await client.listTools()
```

Pass `protocolVersion: 'auto'` to probe the server, or `'2025-11-25'` to pin the older
revision — which, unlike `2026-07-28`, needs an explicit `await client.initialize()` first.

Everything below applies to an HTTP client exactly as it does to a stdio one: the returned
value is a `ContextClient`. One exception: `createHTTPClient` only forwards `protocolVersion`
to the underlying `ContextClient` — handler options like `elicit`, `createMessage` and
`listRoots` (below) have nowhere to go through it. To configure those over HTTP, build the
transport and client separately instead:

```typescript
import { ContextClient, type ClientTransport } from '@mokei/context-client'
import { HTTPTransport } from '@mokei/http-client'

const transport = new HTTPTransport({ url: 'https://mcp.example.com/mcp' }) as ClientTransport

const client = new ContextClient({
  transport,
  protocolVersion: '2026-07-28',
  elicit: async ({ params, signal }) => { /* ... */ },
})
```

## Client Configuration

`elicit`, `createMessage` and `listRoots` handle input a server asks for mid-call. On
`2025-11-25` a server asks by sending the client a request directly. On `2026-07-28`, which has
no server-initiated requests, a server asks by suspending its `tools/call` / `prompts/get` /
`resources/read` with a terminal `resultType: 'input_required'` result (MRTR, SEP-2322); the
client answers by re-sending the same call with the results. The handlers below have the same
signature either way — an auto-fulfilment driver dispatches a `2026-07-28` suspension's embedded
requests to them and retries automatically, so `callTool`/`getPrompt`/`readResource` return the
same result type on both revisions. Pass `inputRequired: { autoFulfill: false }` to
`ContextClient` to opt out and drive rounds yourself (see "Multi round-trip requests" below).

```typescript
import { ContextClient, type ClientParams } from '@mokei/context-client'

const client = new ContextClient({
  transport,
  protocolVersion: '2026-07-28',

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

## Multi Round-Trip Requests (MRTR)

On `2026-07-28`, `callTool`, `getPrompt` and `readResource` requests can involve more than one
wire round trip when the server needs client input to finish (SEP-2322). By default this is
invisible: the client's `createMessage`/`elicit`/`listRoots` handlers configured above answer the
server's embedded requests and the call retries on its own, so the caller just `await`s the same
result it would get on `2025-11-25`.

To drive rounds yourself instead — for example to show a progress indicator per round — pass
`allowInputRequired: true`. `callTool`/`getPrompt`/`readResource` keep their ordinary result
type, so a suspension needs a cast to check `resultType`:

```typescript
const result = await client.callTool({
  name: 'long_operation',
  arguments: { data: '...' },
  allowInputRequired: true,
})

const suspended = result as unknown as { resultType: string; inputRequests?: unknown; requestState?: string }
if (suspended.resultType === 'input_required') {
  // suspended.inputRequests holds the embedded requests to fulfil; suspended.requestState (if
  // present) must be echoed back on the retry, unchanged, alongside inputResponses.
}
```

Cap the number of rounds a call may take (default 10, matching `maxRounds`) or opt out of
auto-fulfilment for every call from a client via the constructor:

```typescript
const client = new ContextClient({
  transport,
  protocolVersion: '2026-07-28',
  inputRequired: { autoFulfill: false, maxRounds: 5 },
  // ...
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
import type { SQLiteServerTypes } from '@mokei/mcp-sqlite'
import { ContextClient } from '@mokei/context-client'

const client = new ContextClient<SQLiteServerTypes>({ transport, protocolVersion: '2026-07-28' })

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
import { ContextClient, type ClientTransport } from '@mokei/context-client'
import { spawn } from 'node:child_process'
import { NodeStreamsTransport } from '@enkaku/node-streams'

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
  }) as ClientTransport
  
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
