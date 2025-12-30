# Mokei MCP client

## Installation

```sh
npm install @mokei/context-client
```

## Basic Usage

```typescript
import { ContextClient } from '@mokei/context-client'
import { NodeStreamsTransport } from '@enkaku/node-streams-transport'

const transport = new NodeStreamsTransport({ streams })
const client = new ContextClient({ transport })

await client.initialize()

// List available tools
const { tools } = await client.listTools()

// Call a tool (untyped)
const result = await client.callTool({
  name: 'tool_name',
  arguments: { key: 'value' }
})
```

## Type-Safe Usage

For the best developer experience, use type-safe clients by importing server types.

### Using Server Types

If your server exports types using `ExtractServerTypes` from `@mokei/context-server`:

```typescript
import type { FetchServerTypes } from '@mokei/mcp-fetch'
import { ContextClient } from '@mokei/context-client'

// Create a typed client
const client = new ContextClient<FetchServerTypes>({ transport })
await client.initialize()

// Now all tool calls are type-checked!
const result = await client.callTool({
  name: 'get_markdown',
  arguments: { url: 'https://example.com' }  // ✓ Fully typed
})

// TypeScript will error on invalid arguments:
// arguments: { invalid: 'field' }  // ✗ Compile error
```

### Custom Context Types

You can also define custom context types manually:

```typescript
import { ContextClient, type ContextTypes } from '@mokei/context-client'

type MyContextTypes = {
  Tools: {
    greet: { name: string }
    calculate: { x: number; y: number }
  }
  Prompts: {
    welcome: { userName: string }
  }
}

const client = new ContextClient<MyContextTypes>({ transport })
await client.initialize()

// Typed tool calls
await client.callTool({
  name: 'greet',
  arguments: { name: 'Alice' }
})

// Typed prompt calls
await client.getPrompt({
  name: 'welcome',
  arguments: { userName: 'Bob' }
})
```

### Benefits of Type Safety

- **Autocomplete**: IDE suggests available tool/prompt names and argument fields
- **Compile-time errors**: Catch typos and invalid arguments before runtime
- **Refactoring safety**: Changes to server schemas are caught at compile time
- **Documentation**: Types serve as inline documentation

## API Reference

### Client Methods

- `initialize()` - Initialize the client connection
- `listTools()` - List available tools from the server
- `callTool(params)` - Call a tool with arguments
- `listPrompts()` - List available prompts from the server
- `getPrompt(params)` - Get a prompt with arguments
- `listResources()` - List available resources
- `readResource(params)` - Read a resource by URI

### Type Parameters

- `ContextTypes` - Define tool and prompt argument types
- `UnknownContextTypes` - Default untyped context (all tools/prompts accept `Record<string, unknown>`)

## [Documentation](https://mokei.dev)