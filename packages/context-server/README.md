# Mokei MCP server

## Installation

```sh
npm install @mokei/context-server
```

## Basic Usage

```typescript
import { createTool, serveProcess } from '@mokei/context-server'

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
          content: [{ type: 'text', text: `Hello, ${req.arguments.name}!` }]
        }
      }
    })
  }
})
```

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
    handler: ({ arguments: { table } }) => ({ structuredContent: { count: rowsIn(table) } }),
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
        content: [{ type: 'text', text: `Hello, ${req.arguments.name}!` }]
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