# Managing MCP Server Connections

Package: `@mokei/host`

## Installation

```bash
npm install @mokei/host
```

## Overview

`ContextHost` manages multiple MCP server connections, handling their lifecycle, tool namespacing, and routing. It's the coordination layer between your application and multiple MCP servers.

## Basic Usage

```typescript
import { ContextHost } from '@mokei/host'

const host = new ContextHost()

// Add a local MCP server (spawned process)
await host.addLocalContext({
  key: 'sqlite',
  command: 'npx',
  args: ['-y', '@mokei/mcp-sqlite']
})

// Setup the context (initialize and discover tools)
const tools = await host.setup('sqlite')
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
const tools = await host.setup('myserver')
```

### Direct Context

Uses in-memory transport for testing or embedded servers:

```typescript
import { type ServerConfig } from '@mokei/context-server'

const config: ServerConfig = {
  name: 'embedded',
  version: '1.0.0',
  tools: { /* ... */ }
}

const client = host.addDirectContext({
  key: 'embedded',
  config
})

const tools = await host.setup('embedded')
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

const tools = await host.setup('custom')
```

## Tool Namespacing

Tools are namespaced with `contextKey:toolName` format to avoid conflicts:

```typescript
// Server exposes: 'query', 'insert'
await host.addLocalContext({ key: 'db', command: 'db-server' })
await host.setup('db')

// Tools are accessible as:
// - 'db:query'
// - 'db:insert'

const tools = host.getCallableTools()
// [{ name: 'db:query', ... }, { name: 'db:insert', ... }]
```

### Calling Namespaced Tools

```typescript
// Using namespaced tool ID
const result = await host.callNamespacedTool('db:query', { sql: 'SELECT *' })

// Or specify context and tool separately
const result = await host.callTool('db', { 
  name: 'query', 
  arguments: { sql: 'SELECT *' } 
})
```

## Managing Tools

### Enable/Disable Tools

```typescript
// Get context tools
const context = host.getContext('db')
console.log('Tools:', context.tools)

// Disable specific tools
host.disableContextTools('db', ['dangerous_operation'])

// Enable specific tools
host.enableContextTools('db', ['dangerous_operation'])

// Set exact enabled tools (disables all others)
host.setEnabledContextTools('db', ['query', 'insert'])

// Replace all context tools
host.setContextTools('db', [
  { id: 'db:query', tool: queryTool, enabled: true },
  { id: 'db:insert', tool: insertTool, enabled: false }
])
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

```typescript
// Enable all tools
const tools = await host.setup('db', true)

// Disable all tools
const tools = await host.setup('db', false)

// Enable specific tools by name
const tools = await host.setup('db', ['query', 'insert'])

// Dynamic selection based on available tools
const tools = await host.setup('db', async (availableTools) => {
  // Filter out dangerous tools
  return availableTools
    .filter(t => !t.name.includes('delete'))
    .map(t => t.name)
})
```

### Remove Context

```typescript
// Removes context and cleans up resources
await host.remove('db')
```

### List Contexts

```typescript
const keys = host.getContextKeys()
// ['sqlite', 'filesystem', 'api']
```

## Getting Prompts

```typescript
const result = await host.getPrompt('db', {
  name: 'sql_helper',
  arguments: { table: 'users' }
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
import { ContextHost } from '@mokei/host'

async function main() {
  const host = new ContextHost()
  
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
    await host.setup('sqlite', true)
    await host.setup('fs', ['read_file', 'list_directory'])  // Only enable safe tools
    
    // List all enabled tools
    const tools = host.getCallableTools()
    console.log('Available tools:')
    for (const tool of tools) {
      console.log(`  ${tool.name}: ${tool.description}`)
    }
    
    // Call a tool
    const result = await host.callNamespacedTool('sqlite:sqlite_all', {
      sql: 'SELECT * FROM users LIMIT 5'
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
