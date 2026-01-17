# Creating MCP Servers

Package: `@mokei/context-server`

## Installation

```bash
npm install @mokei/context-server
```

## Basic Server

The simplest way to create an MCP server is using `serveProcess()`:

```typescript
import { serveProcess } from '@mokei/context-server'

serveProcess({
  name: 'my-server',
  version: '1.0.0',
  tools: { /* tool definitions */ },
  prompts: { /* prompt definitions */ },
  resources: { /* resource definitions */ }
})
```

## Creating Tools

Tools are functions that LLMs can call. Use `createTool()` for type-safe tool definitions:

```typescript
import { createTool, serveProcess, type ToolDefinitions } from '@mokei/context-server'

const tools = {
  greet: createTool(
    'Greets a user by name',  // description
    {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name to greet' },
        formal: { type: 'boolean', description: 'Use formal greeting' }
      },
      required: ['name'],
      additionalProperties: false
    } as const,  // as const for type inference
    (req) => {
      const greeting = req.arguments.formal 
        ? `Good day, ${req.arguments.name}.`
        : `Hello, ${req.arguments.name}!`
      return {
        content: [{ type: 'text', text: greeting }],
        isError: false
      }
    }
  )
} satisfies ToolDefinitions

serveProcess({ name: 'greeter', version: '1.0.0', tools })
```

### Tool Handler Context

The handler receives a request object with:

```typescript
type HandlerRequest = {
  arguments: T        // Validated input matching your schema
  client: ServerClient // Access to client capabilities
  signal: AbortSignal  // For cancellation
}
```

### ServerClient Methods

Inside tool handlers, you can use `client` to:

```typescript
// Request user input via elicitation
const result = await req.client.elicit({
  message: 'Please confirm',
  requestedSchema: {
    type: 'object',
    properties: { confirm: { type: 'boolean' } }
  }
})

// Request LLM sampling from the client
const message = await req.client.createMessage({
  messages: [{ role: 'user', content: { type: 'text', text: 'Summarize this' } }],
  maxTokens: 100
})

// Get workspace roots
const roots = await req.client.listRoots()

// Log messages to client
req.client.log('info', 'Processing request...')
```

### Tool Return Types

Tools must return a `CallToolResult`:

```typescript
// Text content
return {
  content: [{ type: 'text', text: 'Result text' }],
  isError: false
}

// Image content
return {
  content: [{ 
    type: 'image', 
    data: base64EncodedData, 
    mimeType: 'image/png' 
  }],
  isError: false
}

// Error response
return {
  content: [{ type: 'text', text: 'Error: Something went wrong' }],
  isError: true
}

// Structured content (for machine-readable output)
return {
  content: [{ type: 'text', text: 'Success' }],
  structuredContent: { id: 123, status: 'created' },
  isError: false
}
```

## Creating Prompts

Prompts are templates that return messages:

```typescript
import { createPrompt, serveProcess, type PromptDefinitions } from '@mokei/context-server'

const prompts = {
  code_review: createPrompt(
    'Generate a code review prompt',
    {
      type: 'object',
      properties: {
        language: { type: 'string', description: 'Programming language' },
        code: { type: 'string', description: 'Code to review' }
      },
      required: ['language', 'code']
    } as const,
    (req) => ({
      description: `Code review for ${req.arguments.language}`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Review this ${req.arguments.language} code:\n\n${req.arguments.code}`
          }
        }
      ]
    })
  )
} satisfies PromptDefinitions

serveProcess({ name: 'prompts-server', version: '1.0.0', prompts })
```

## Handling Resources

Resources provide access to data:

```typescript
import { serveProcess, type ResourceDefinitions } from '@mokei/context-server'

const resources: ResourceDefinitions = {
  // Static list of resources
  list: [
    { uri: 'file:///config.json', name: 'Configuration', mimeType: 'application/json' }
  ],
  
  // Or dynamic list function
  list: async (req) => ({
    resources: [
      { uri: 'db://users', name: 'Users', description: 'User database' }
    ]
  }),
  
  // Resource templates for parameterized URIs
  listTemplates: [
    { 
      uriTemplate: 'file:///{path}', 
      name: 'File', 
      description: 'Read any file' 
    }
  ],
  
  // Read resource content
  read: async (req) => {
    const { uri } = req.params
    if (uri === 'file:///config.json') {
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({ setting: 'value' })
        }]
      }
    }
    throw new Error(`Unknown resource: ${uri}`)
  }
}

serveProcess({ name: 'resource-server', version: '1.0.0', resources })
```

## Autocompletion Support

Implement completion for arguments:

```typescript
import { serveProcess, type CompleteHandler } from '@mokei/context-server'

const complete: CompleteHandler = async (req) => {
  const { ref, argument } = req.params
  
  if (ref.type === 'ref/prompt' && ref.name === 'code_review') {
    if (argument.name === 'language') {
      const languages = ['typescript', 'python', 'rust', 'go']
      const matching = languages.filter(l => l.startsWith(argument.value))
      return { completion: { values: matching } }
    }
  }
  
  return { completion: { values: [] } }
}

serveProcess({ name: 'server', version: '1.0.0', complete, prompts })
```

## Advanced: ContextServer Class

For more control, use the `ContextServer` class directly:

```typescript
import { ContextServer, type ServerConfig } from '@mokei/context-server'
import { NodeStreamsTransport } from '@enkaku/node-streams-transport'

const config: ServerConfig = {
  name: 'my-server',
  version: '1.0.0',
  tools: { /* ... */ }
}

const transport = new NodeStreamsTransport({
  streams: { readable: process.stdin, writable: process.stdout }
})

const server = new ContextServer({ ...config, transport })

// Listen for events
server.events.on('initialize', (params) => {
  console.error('Client connected:', params.clientInfo.name)
})

server.events.on('log', (log) => {
  console.error(`[${log.level}]`, log.data)
})
```

## Type-Safe Client Types

Export types for clients to use:

```typescript
import { 
  createTool, 
  serveProcess,
  type ServerConfig,
  type ToolDefinitions,
  type ExtractServerTypes 
} from '@mokei/context-server'

const tools = {
  myTool: createTool(/* ... */)
} satisfies ToolDefinitions

const config = {
  name: 'typed-server',
  version: '1.0.0',
  tools
} satisfies ServerConfig

// Export for client usage
export type MyServerTypes = ExtractServerTypes<typeof config>

serveProcess(config)
```

Clients can then import the type:

```typescript
import type { MyServerTypes } from './server'
import { ContextClient } from '@mokei/context-client'

const client = new ContextClient<MyServerTypes>({ transport })
// Tool calls are now fully typed
```

## Complete Example: SQLite Server

```typescript
import { DatabaseSync } from 'node:sqlite'
import { parseArgs } from 'node:util'
import {
  createTool,
  serveProcess,
  type Schema,
  type ServerConfig,
  type ToolDefinitions,
  type ExtractServerTypes
} from '@mokei/context-server'

const args = parseArgs({ options: { db: { type: 'string' } } })
const db = new DatabaseSync(args.values.db ?? ':memory:')

const sqlSchema = {
  type: 'object',
  properties: {
    sql: { type: 'string', description: 'SQL statement' },
    parameters: {
      type: 'object',
      additionalProperties: {
        anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }]
      },
      description: 'Named parameters'
    }
  },
  required: ['sql'],
  additionalProperties: false
} as const satisfies Schema

const tools = {
  sqlite_all: createTool(
    'Execute SQL and return all results as array',
    sqlSchema,
    (req) => {
      const results = db.prepare(req.arguments.sql).all(req.arguments.parameters ?? {})
      return { content: [{ type: 'text', text: JSON.stringify(results) }], isError: false }
    }
  ),
  sqlite_run: createTool(
    'Execute SQL and return change summary',
    sqlSchema,
    (req) => {
      const changes = db.prepare(req.arguments.sql).run(req.arguments.parameters ?? {})
      return { content: [{ type: 'text', text: JSON.stringify(changes) }], isError: false }
    }
  )
} satisfies ToolDefinitions

const config = { name: 'sqlite', version: '0.1.0', tools } satisfies ServerConfig

export type SqliteServerTypes = ExtractServerTypes<typeof config>

serveProcess(config)
```
