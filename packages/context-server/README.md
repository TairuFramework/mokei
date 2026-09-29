# Mokei MCP server

## Installation

```sh
npm install @mokei/context-server
```

## Basic Usage

```typescript
import { createTool } from '@mokei/context-server'
import { serveProcess } from '@mokei/context-server-node'

serveProcess({
  name: 'my-server',
  version: '1.0.0',
  protocolVersions: ['2026-07-28'],
  tools: {
    greet: createTool({
      description: 'Greet a user by name',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' }
        },
        required: ['name']
      } as const,
      handler: async (req) => {
        return {
          content: [{ type: 'text', text: `Hello, ${req.input.name}!` }]
        }
      }
    })
  }
})
```

## Tasks

On `2026-07-28`, pass a `TaskManager` to the server to enable the MCP Tasks extension. The
application owns the manager. Its default store is in memory; provide a persistent `TaskStore` if
tasks must survive a process restart.

Create the manager once, recover persisted work before accepting requests, and pass the same tool
definitions to `recover` and the server:

```ts
import { createTaskManager, createTool } from '@mokei/context-server'
import { serveProcess } from '@mokei/context-server-node'

const tools = {
  report: createTool({
    description: 'Build a report',
    inputSchema: { type: 'object' },
    handler: (req) => {
      if (req.task == null) throw new Error('Task support is not enabled')
      return req.task.run(async (task) => {
        await task.setStatus('Building report')
        return { content: [{ type: 'text', text: 'Report ready' }] }
      })
    },
  }),
}

const tasks = createTaskManager()
await tasks.recover(tools)

serveProcess({
  name: 'report-server',
  version: '1.0.0',
  protocolVersions: ['2026-07-28'],
  tools,
  tasks,
})
```

These examples use the default memory store, so recovery has no records to resume. To recover work
after a restart, supply a persistent `TaskStore` and a `recover` callback to `createTaskManager`.

For HTTP, `serveHTTP` owns its per-request servers, while the application passes the shared
manager to the handler and disposes it separately:

```ts
import { ContextServer, createTaskManager } from '@mokei/context-server'
import { serveHTTP } from '@mokei/http-server'

const tasks = createTaskManager()
await tasks.recover(tools)
const http = serveHTTP({
  tasks,
  createServer: ({ transport, tasks: sharedTasks }) =>
    new ContextServer({
      name: 'report-server',
      version: '1.0.0',
      protocolVersions: ['2026-07-28'],
      tools,
      tasks: sharedTasks,
      transport,
    }),
})

await http.dispose()
await tasks.dispose()
```

`req.task.run` returns immediately with a task ID while the work continues in the manager. A
persistent store and a `recover` callback are needed to resume running work after a restart.

### Structured tool output

Declare an `outputSchema` and the tool advertises it in `tools/list`, validates
its own `structuredContent`, and serializes that into a text `content` block for
clients that don't read structured results:

```ts
const tools = {
  count: createTool({
    description: 'Count the matching rows',
    inputSchema: { type: 'object', properties: { table: { type: 'string' } } } as const,
    outputSchema: {
      type: 'object',
      properties: { count: { type: 'number' } },
      required: ['count'],
    } as const,
    handler: ({ input: { table } }) => ({ structuredContent: { count: rowsIn(table) } }),
  }),
}
```

A handler that returns `structuredContent` violating its `outputSchema` — or
omits it entirely — raises an `INTERNAL_ERROR` back to the client.

## Type-Safe Client Integration

The `@mokei/context-server` package provides utilities to extract TypeScript types from your server configuration, enabling type-safe client usage.

### Extracting Types

Use `ExtractServerTypes` to derive types from your server configuration:

```typescript
import {
  createTool,
  type ExtractServerTypes,
  type ServerConfig,
  type ToolDefinitions
} from '@mokei/context-server'

const tools = {
  greet: createTool({
    description: 'Greet a user by name',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'User name' }
      },
      required: ['name'],
      additionalProperties: false
    } as const,
    handler: async (req) => {
      return {
        content: [{ type: 'text', text: `Hello, ${req.input.name}!` }]
      }
    }
  })
} satisfies ToolDefinitions

export const config = {
  name: 'my-server',
  version: '1.0.0',
  protocolVersions: ['2026-07-28'],
  tools
} satisfies ServerConfig

// Export types for client usage
export type MyServerTypes = ExtractServerTypes<typeof config>
```

### Using Extracted Types in Clients

Import the exported types to get full type safety in your client:

```typescript
import type { MyServerTypes } from './my-server'
import { ContextClient } from '@mokei/context-client'

const client = new ContextClient<MyServerTypes>({ protocolVersion: '2026-07-28', transport })

// TypeScript knows the exact shape of arguments!
const result = await client.callTool({
  name: 'greet',
  arguments: { name: 'Alice' }  // ✓ Type-checked
})

// This will error at compile time:
// arguments: { invalid: 'field' }  // ✗ Type error
```

### Available Type Utilities

- `ExtractServerTypes<T>` - Extract complete context types (Tools + Prompts)
- `ExtractToolTypes<T>` - Extract only tool argument types
- `ExtractPromptTypes<T>` - Extract only prompt argument types

## [Documentation](https://mokei.dev)
