# Creating MCP Servers

Package: `@mokei/context-server`

## Installation

```bash
npm install @mokei/context-server
```

## Basic Server

The simplest way to create an MCP server is using `serveProcess()`:

`protocolVersions` is the set of revisions the server serves (order is not significant).
`'2026-07-28'` alone is enough for mokei's own host, session and CLI: the host defaults to
`'2026-07-28'`, and `mokei inspect` defaults to `'auto'`. Add `'2025-11-25'` to also serve
clients pinned to the older revision.

```typescript
import { serveProcess } from '@mokei/context-server'

serveProcess({
  name: 'my-server',
  version: '1.0.0',
  protocolVersions: ['2026-07-28'],
  tools: { /* tool definitions */ },
  prompts: { /* prompt definitions */ },
  resources: { /* resource definitions */ }
})
```

## Creating Tools

Tools are functions that LLMs can call. Use `createTool()` for type-safe tool definitions. It
takes a single parameters object: `description`, `inputSchema`, an optional `outputSchema`, and
the `handler`.

```typescript
import { createTool, serveProcess, type ToolDefinitions } from '@mokei/context-server'

const tools = {
  greet: createTool({
    description: 'Greets a user by name',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name to greet' },
        formal: { type: 'boolean', description: 'Use formal greeting' }
      },
      required: ['name'],
      additionalProperties: false
    } as const,  // as const for type inference
    handler: (req) => {
      const greeting = req.input.formal
        ? `Good day, ${req.input.name}.`
        : `Hello, ${req.input.name}!`
      return {
        content: [{ type: 'text', text: greeting }],
        isError: false
      }
    }
  })
} satisfies ToolDefinitions

serveProcess({ name: 'greeter', version: '1.0.0', protocolVersions: ['2026-07-28'], tools })
```

### Tool Handler Context

The handler receives a request object with:

```typescript
type HandlerRequest = {
  input: T                    // Validated input matching your schema
  client: ServerClient        // Access to client capabilities
  progress?: ProgressEmitter  // Report progress on long-running calls
  signal: AbortSignal         // For cancellation

  // MRTR only (2026-07-28) -- see "Multi Round-Trip Requests" below
  inputResponses?: Record<string, InputResponse>  // Answers from a previous round
  requestState?: unknown                          // State this handler minted on a previous round
  mintRequestState: (payload: unknown) => string  // Encode a payload to send with inputRequired()
}
```

### ServerClient Methods

Inside tool handlers, you can use `client` to send the client a request and `await` its answer
inline:

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
req.client.log({ level: 'info', data: 'Processing request...' })
```

Each of these request methods takes a single parameters object, and `elicit`, `createMessage`
and `listRoots` also accept `signal` and `timeout` alongside their params:

```typescript
const result = await req.client.elicit({
  message: 'Please confirm',
  requestedSchema: {
    type: 'object',
    properties: { confirm: { type: 'boolean' } }
  },
  signal: req.signal,
  timeout: 30_000,
})
```

**This whole pattern is `2025-11-25`-only.** `elicit`, `createMessage` and `listRoots` are
server-initiated requests: the server sends the client a request and awaits the answer inline,
exactly as above. `2026-07-28` has no server-initiated requests at all, so on a server
configured with `protocolVersions: ['2026-07-28']` (without `'2025-11-25'`), calling any of the
three throws `MRTRNotSupportedError` — there is nothing on the wire to send it as. Reaching the
client for input there uses multi round-trip requests instead (below).

## Multi Round-Trip Requests (MRTR)

On `2026-07-28`, a `tools/call`, `prompts/get` or `resources/read` handler that needs input from
the client suspends by **returning** `inputRequired({ inputRequests, requestState })` instead of
awaiting a `client` call, and is **re-invoked** — a fresh call, not a resumed one — once the
client retries with the answers (SEP-2322). `inputRequired` is exported from
`@mokei/context-server`.

```typescript
import { createTool, inputRequired, serveProcess, type ToolDefinitions } from '@mokei/context-server'

const tools = {
  summarize: createTool({
    description: 'Summarizes text using client-side sampling',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false
    } as const,
    handler: ({ input, inputResponses, mintRequestState, requestState }) => {
      const answer = inputResponses?.summary as { content?: { text?: string } } | undefined
      if (answer == null) {
        // First round: ask the client to sample, and mint state to recognize the retry.
        return inputRequired({
          inputRequests: {
            summary: {
              method: 'sampling/createMessage',
              params: {
                messages: [{ role: 'user', content: { type: 'text', text: `Summarize: ${input.text}` } }],
                maxTokens: 200,
              },
            },
          },
          requestState: mintRequestState({ startedAt: Date.now() }),
        })
      }
      // Re-invoked with the client's answer and the echoed requestState.
      return {
        content: [{ type: 'text', text: answer.content?.text ?? '' }],
        isError: false
      }
    }
  })
} satisfies ToolDefinitions

serveProcess({ name: 'summarizer', version: '1.0.0', protocolVersions: ['2026-07-28'], tools })
```

`inputRequests` keys are handler-chosen; `inputResponses` echoes them back keyed the same way.
`requestState` is an opaque string the client only stores and re-sends verbatim — mint it with
`mintRequestState` (JSON-stringifies by default) and read it back, already resolved, from
`requestState` on the next round. Since it round-trips through the client, protect its integrity
with a `requestState: { mint, verify }` hook on `ContextServer`/`serveProcess` before letting it
influence authorization or business logic — unconfigured, the raw string reaches the handler
untrusted. A request whose embedded `inputRequests` needs a capability the client never declared
fails fast with `-32021` (`MissingRequiredClientCapabilityError`) rather than round-tripping to
find out.

Prompt and resource `read` handlers can suspend the same way — `PromptHandlerReturn` and
`ReadResourceHandler` both admit `InputRequiredResult` alongside their ordinary result type,
matching the three methods SEP-2322 allows to suspend (`tools/call`, `prompts/get`,
`resources/read`).

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

Prompts are templates that return messages. `createPrompt()` also takes a single parameters
object: `description`, an optional `argumentsSchema`, and the `handler`.

```typescript
import { createPrompt, serveProcess, type PromptDefinitions } from '@mokei/context-server'

const prompts = {
  code_review: createPrompt({
    description: 'Generate a code review prompt',
    argumentsSchema: {
      type: 'object',
      properties: {
        language: { type: 'string', description: 'Programming language' },
        code: { type: 'string', description: 'Code to review' }
      },
      required: ['language', 'code']
    } as const,
    handler: (req) => ({
      description: `Code review for ${req.input.language}`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Review this ${req.input.language} code:\n\n${req.input.code}`
          }
        }
      ]
    })
  })
} satisfies PromptDefinitions

serveProcess({ name: 'prompts-server', version: '1.0.0', protocolVersions: ['2026-07-28'], prompts })
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

serveProcess({ name: 'resource-server', version: '1.0.0', protocolVersions: ['2026-07-28'], resources })
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

serveProcess({ name: 'server', version: '1.0.0', protocolVersions: ['2026-07-28'], complete, prompts })
```

## Advanced: ContextServer Class

For more control, use the `ContextServer` class directly:

```typescript
import { ContextServer, type ServerConfig, type ServerTransport } from '@mokei/context-server'
import { NodeStreamsTransport } from '@enkaku/node-streams'

const config: ServerConfig = {
  name: 'my-server',
  version: '1.0.0',
  protocolVersions: ['2026-07-28'],
  tools: { /* ... */ }
}

const transport = new NodeStreamsTransport({
  streams: { readable: process.stdin, writable: process.stdout }
}) as ServerTransport

const server = new ContextServer({ ...config, transport })

// Listen for events. 'initialize' fires only when this server also serves 2025-11-25 —
// 2026-07-28 has no handshake to emit it from.
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
  myTool: createTool({ /* description, inputSchema, handler */ })
} satisfies ToolDefinitions

const config = {
  name: 'typed-server',
  version: '1.0.0',
  protocolVersions: ['2026-07-28'],
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

const client = new ContextClient<MyServerTypes>({ transport, protocolVersion: '2026-07-28' })
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
  sqlite_all: createTool({
    description: 'Execute SQL and return all results as array',
    inputSchema: sqlSchema,
    handler: (req) => {
      const results = db.prepare(req.input.sql).all(req.input.parameters ?? {})
      return { content: [{ type: 'text', text: JSON.stringify(results) }], isError: false }
    }
  }),
  sqlite_run: createTool({
    description: 'Execute SQL and return change summary',
    inputSchema: sqlSchema,
    handler: (req) => {
      const changes = db.prepare(req.input.sql).run(req.input.parameters ?? {})
      return { content: [{ type: 'text', text: JSON.stringify(changes) }], isError: false }
    }
  })
} satisfies ToolDefinitions

const config = {
  name: 'sqlite',
  version: '0.1.0',
  protocolVersions: ['2026-07-28'],
  tools,
} satisfies ServerConfig

export type SqliteServerTypes = ExtractServerTypes<typeof config>

serveProcess(config)
```
