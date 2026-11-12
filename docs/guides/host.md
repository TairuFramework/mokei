# Managing MCP Server Connections

Packages: `@mokei/host` (React Native / browser-safe surface) and `@mokei/host-node` (Node stdio / daemon layer)

## Installation

```bash
npm install @mokei/host-node
```

> `@mokei/host` exposes the RN/browser-safe `ContextHost` (direct + HTTP contexts). Spawning a
> local MCP server as a child process needs `@mokei/host-node`, which re-exports a
> `NodeContextHost` (a `ContextHost` subclass adding `addLocalContext`) plus the daemon
> (`createClient`/`runDaemon`) and `ProxyHost`. The examples below use local spawning, so they
> import from `@mokei/host-node`.

## Overview

`ContextHost` (and its Node subclass `NodeContextHost`) manages multiple MCP server connections, handling their lifecycle, tool namespacing, and routing. It's the coordination layer between your application and multiple MCP servers.

## Basic Usage

```typescript
import { NodeContextHost } from '@mokei/host-node'

const host = new NodeContextHost()

// Add a local MCP server (spawned process)
await host.addLocalContext({
  key: 'sqlite',
  command: 'npx',
  args: ['-y', '@mokei/mcp-sqlite']
})

// Setup the context (initialize and discover tools)
const tools = await host.setup({ key: 'sqlite' })
console.log('Available tools:', tools.map(t => t.tool.name))

// Cleanup when done
await host.dispose()
```

## Adding Contexts

### Local Process Context

Spawns a child process running the MCP server:

```typescript
const client = await host.addLocalContext({
  key: 'myserver',           // Unique identifier
  command: 'node',           // Command to run
  args: ['server.js'],       // Command arguments
  env: { API_KEY: '...' }    // Environment variables (optional)
})

// Initialize and get tools
const tools = await host.setup({ key: 'myserver' })
```

On Windows, libuv still adds a few non-sensitive system variables (`PATH`, `TEMP`, `USERPROFILE`, `USERNAME`, `SYSTEMROOT`), and `env` keys that differ only by case can collide.

### HTTP Context

Connects to a server over the MCP Streamable HTTP transport:

```typescript
const client = await host.addHTTPContext({
  key: 'remote',
  url: 'https://mcp.example.com/mcp',
  auth: { type: 'bearer', token: 'your-api-key' },  // optional
  timeout: 60_000,                                  // optional
})

const tools = await host.setup({ key: 'remote' })
```

### Direct Context

Uses in-memory transport for testing or embedded servers:

```typescript
import { type ServerConfig } from '@mokei/context-server'

const config: ServerConfig = {
  name: 'embedded',
  version: '1.0.0',
  protocolVersions: ['2026-07-28'],
  tools: { /* ... */ }
}

const client = host.addDirectContext({
  key: 'embedded',
  config
})

const tools = await host.setup({ key: 'embedded' })
```

### Custom Transport Context

For custom transports (WebSocket, HTTP, etc.):

```typescript
import { type ClientTransport } from '@mokei/context-client'

const transport: ClientTransport = /* your transport */

const client = host.createContext({
  key: 'custom',
  transport,
  dispose: async () => {
    // Custom cleanup
  }
})

const tools = await host.setup({ key: 'custom' })
```

## Protocol Revisions

`addLocalContext`, `addHTTPContext` and `addDirectContext` each take an optional
`protocolVersion`, defaulting to `'auto'`: the client probes the server and speaks the newest
revision both sides support. Pin a revision to skip the probe:

```typescript
// Pin the older revision
await host.addLocalContext({
  key: 'older-server',
  command: 'node',
  args: ['old-server.js'],
  protocolVersion: '2025-11-25',
})

// Or let the host work out which revision the server serves
await host.addHTTPContext({
  key: 'unknown',
  url: 'https://mcp.example.com/mcp',
  protocolVersion: 'auto',
})
```

`'auto'` is resolved per context: the host does not share a resolution between contexts, so
each `'auto'` context probes its own server.

## Tool Namespacing

Tools are namespaced with `contextKey:toolName` format to avoid conflicts:

```typescript
// Server exposes: 'query', 'insert'
await host.addLocalContext({ key: 'db', command: 'db-server' })
await host.setup({ key: 'db' })

// Tools are accessible as:
// - 'db:query'
// - 'db:insert'

const tools = host.getCallableTools()
// [{ name: 'db:query', ... }, { name: 'db:insert', ... }]
```

### Calling Namespaced Tools

```typescript
// Using namespaced tool ID
const result = await host.callNamespacedTool({
  id: 'db:query',
  arguments: { sql: 'SELECT *' },
})

// Or address the context and tool separately
const result = await host.callTool({
  key: 'db',
  name: 'query',
  arguments: { sql: 'SELECT *' },
})
```

## Managing Tools

### Enable/Disable Tools

```typescript
// Get context tools
const context = host.getContext('db')
console.log('Tools:', context.tools)

// Disable specific tools
host.disableContextTools({ key: 'db', toolNames: ['dangerous_operation'] })

// Enable specific tools
host.enableContextTools({ key: 'db', toolNames: ['dangerous_operation'] })

// Set exact enabled tools (disables all others)
host.setEnabledContextTools({ key: 'db', toolNames: ['query', 'insert'] })

// Replace all context tools
host.setContextTools({
  key: 'db',
  tools: [
    { id: 'db:query', tool: queryTool, enabled: true },
    { id: 'db:insert', tool: insertTool, enabled: false }
  ]
})
```

### Query Tools

```typescript
// Get all enabled tools across all contexts
const enabledTools = host.getEnabledTools()
// Returns ContextTool[] with { id, tool, enabled }

// Get callable tools (MCP Tool format with namespaced names)
const callableTools = host.getCallableTools()
// Returns Tool[] ready for model providers
```

## Context Lifecycle

### Setup with Tool Selection

`setup()` takes the context `key` plus an optional `enableTools` selector. It also accepts
`signal`, `timeout` and `maxPages`, which are forwarded to the underlying `listTools` call.

```typescript
// Enable all tools (the default)
const tools = await host.setup({ key: 'db', enableTools: true })

// Disable all tools
const tools = await host.setup({ key: 'db', enableTools: false })

// Enable specific tools by name
const tools = await host.setup({ key: 'db', enableTools: ['query', 'insert'] })

// Dynamic selection based on available tools
const tools = await host.setup({
  key: 'db',
  enableTools: async (availableTools) => {
    // Filter out dangerous tools
    return availableTools
      .filter(t => !t.name.includes('delete'))
      .map(t => t.name)
  },
})

// With a timeout on tool discovery
const tools = await host.setup({ key: 'db', timeout: 10_000 })
```

### Remove Context

```typescript
// Removes context and cleans up resources
await host.remove('db')
```

### Reconnect

Reconnect is off by default. Pass `reconnect: true` (defaults) or `reconnect: ReconnectOptions` to
`addLocalContext`, `addHTTPContext` or `addDirectContext` to rebuild a context whose connection is
lost, instead of removing it:

```typescript
await host.addHTTPContext({
  key: 'remote',
  url: 'https://mcp.example.com/mcp',
  reconnect: { maxAttempts: 5, initialDelayMs: 250, maxDelayMs: 5_000, gateTimeoutMs: 10_000 },
})
```

The values shown are the defaults. Delays double with full jitter. The controller arms once
`setup()` has committed the context's tools.

- Calls made while a reconnect runs wait at a gate for up to `gateTimeoutMs`, then fail with
  `ContextUnavailableError`. A reconnect that spends every attempt ends with
  `ReconnectExhaustedError`.
- Events: `context:reconnecting` (`key`, `attempt`, `error`), `context:reconnected` (`key`,
  `attempts`), then on a terminal failure `context:failed` once followed by `context:removed`
  once. Reconnect off keeps today's behaviour; HTTP and direct contexts now emit `context:added`.
- A client returned earlier by `add*Context` or `getContext(key).client` is not gated and goes
  stale after a reconnect. `getContext(key).client` always returns the current client.
- Reconnect attempts never open a sign-in: a server that wants one ends the reconnect with
  `context:failed` carrying an `AuthRequiredError`.
- A task created before the loss rejects with `TaskInterruptedError` (it carries `taskID`); the
  task may still be running on the server.
- `host.subscribeResource` and `host.unsubscribeResource` record the desired subscriptions, which
  are restored on the new client. A URI the new server refuses, or cannot subscribe to because it
  lacks `resources.subscribe`, is dropped with `resource:subscription-lost`.
- Pass `connectivity` to the host (`isOnline()`, optional `subscribe()`) so a reconnect waits for
  the network instead of burning attempts.

For stdio contexts, `reconnect` also accepts `respawn`, called once per loss with the previous
spawn params. Return new params (used for every attempt of that loss), or `false` to end the
reconnect with `context:failed`. Throwing `ReconnectDeclinedError` from a custom factory does the
same.

### List Contexts

```typescript
const keys = host.getContextKeys()
// ['sqlite', 'filesystem', 'api']
```

## Getting Prompts

```typescript
const result = await host.getPrompt({
  key: 'db',
  name: 'sql_helper',
  arguments: { table: 'users' },
})

console.log('Prompt messages:', result.messages)
```

## Accessing Client Directly

For advanced use cases, access the underlying `ContextClient`:

```typescript
const context = host.getContext('db')
const client = context.client

// Use client methods directly
const { tools } = await client.listTools()
const { prompts } = await client.listPrompts()
const { resources } = await client.listResources()
```

## Complete Example

```typescript
import { NodeContextHost } from '@mokei/host-node'

async function main() {
  const host = new NodeContextHost()
  
  try {
    // Add multiple MCP servers
    await host.addLocalContext({
      key: 'sqlite',
      command: 'npx',
      args: ['-y', '@mokei/mcp-sqlite', '--db', 'data.db']
    })
    
    await host.addLocalContext({
      key: 'fs',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', './']
    })
    
    // Setup both contexts
    await host.setup({ key: 'sqlite', enableTools: true })
    // Only enable safe tools
    await host.setup({ key: 'fs', enableTools: ['read_file', 'list_directory'] })
    
    // List all enabled tools
    const tools = host.getCallableTools()
    console.log('Available tools:')
    for (const tool of tools) {
      console.log(`  ${tool.name}: ${tool.description}`)
    }
    
    // Call a tool
    const result = await host.callNamespacedTool({
      id: 'sqlite:sqlite_all',
      arguments: { sql: 'SELECT * FROM users LIMIT 5' },
    })
    console.log('Query result:', result.content)
    
  } finally {
    // Clean up all contexts
    await host.dispose()
  }
}

main().catch(console.error)
```

## Types

### ContextTool

```typescript
type ContextTool = {
  id: string        // Namespaced ID: 'contextKey:toolName'
  tool: Tool        // MCP Tool definition
  enabled: boolean  // Whether tool is enabled
  allow?: AllowToolCalls  // 'always' | 'ask' | 'never'
}
```

### HostedContext

```typescript
type HostedContext<T extends ContextTypes = UnknownContextTypes> = {
  client: ContextClient<T>  // MCP client
  disposer: Disposer        // Cleanup handler
  tools: Array<ContextTool> // Registered tools
}
```

### Utility Functions

```typescript
import { getContextToolID, getContextToolInfo } from '@mokei/host'

// Create namespaced tool ID
const id = getContextToolID('db', 'query')  // 'db:query'

// Parse namespaced tool ID
const [contextKey, toolName] = getContextToolInfo('db:query')
// ['db', 'query']
```
