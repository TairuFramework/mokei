# Mokei MCP client

## Installation

```sh
npm install @mokei/context-client
```

## Basic Usage

```typescript
import { ContextClient, type ClientTransport } from '@mokei/context-client'
import { NodeStreamsTransport } from '@enkaku/node-streams'

const transport = new NodeStreamsTransport({ streams }) as ClientTransport
const client = new ContextClient({ protocolVersion: '2026-07-28', transport })

// No handshake on 2026-07-28 — the client sets itself up lazily on its first call, opening
// with one `server/discover` bounded by `setupTimeout` so a server that never answers fails
// instead of hanging. `requestTimeout` bounds every request made after setup (unset means
// unbounded — a `tools/call` can legitimately run for minutes); `setupTimeout` always covers
// setup itself regardless of `requestTimeout`.

// List available tools
const { tools } = await client.listTools()

// Call a tool (untyped)
const result = await client.callTool({
  name: 'tool_name',
  arguments: { key: 'value' }
})
```

On `2026-07-28`, `callTool` waits for a task automatically and returns its final tool result. To
manage the wait yourself, set `task: 'handle'` to receive the task creation result, then call
`client.tasks.wait`:

```ts
const task = await client.callTool({
  name: 'long_running_tool',
  arguments: { key: 'value' },
  task: 'handle',
})

if (task.resultType === 'task') {
  const result = await client.tasks.wait(task.taskId)
}
```

The client listens for task status notifications while waiting and polls when listening is
unavailable. Use `client.tasks.get(taskId)` to inspect the current status without waiting.

Tasks are opt-in. The client declares the Tasks extension only when created with `tasks: true`;
the default is `false`. With `tasks: false`, `client.tasks.*`, `waitForTask` and listening with
`taskIds` throw `MethodNotInRevisionError` (its hint names the extension) without contacting the
server.

```ts
const client = new ContextClient({ protocolVersion: '2026-07-28', transport, tasks: true })
```

Use `client.getServerExtension(definition)` to read the settings a server declared for an
extension (for example `TASKS` from `@mokei/context-protocol`). It returns `null` when the server
did not declare it, or declared an unknown `revision`.

## Type-Safe Usage

For the best developer experience, use type-safe clients by importing server types.

### Using Server Types

If your server exports types using `ExtractServerTypes` from `@mokei/context-server`:

```typescript
import type { FetchServerTypes } from '@mokei/mcp-fetch'
import { ContextClient } from '@mokei/context-client'

// Create a typed client
const client = new ContextClient<FetchServerTypes>({ protocolVersion: '2026-07-28', transport })

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

const client = new ContextClient<MyContextTypes>({ protocolVersion: '2026-07-28', transport })

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

- `initialize()` - Initialize the client connection (`2025-11-25` only — `2026-07-28` has no
  handshake and throws if called; setup happens lazily on the first request)
- `listTools()` - List available tools from the server
- `callTool(params)` - Call a tool with arguments
- `listPrompts()` - List available prompts from the server
- `getPrompt(params)` - Get a prompt with arguments
- `listResources()` - List available resources
- `readResource(params)` - Read a resource by URI

- `listSkills()` - List the skills the server serves (needs `skills: true`, `2026-07-28`)
- `getSkill(uri)` - Fetch one skill entry; reads no file
- `readSkillFile(entry, uri)` - Read a skill file and verify it against the entry
- `readResourceDirectory(params)` - List a directory resource (server must declare `directoryRead`)

### Type Parameters

- `ContextTypes` - Define tool and prompt argument types
- `UnknownContextTypes` - Default untyped context (all tools/prompts accept `Record<string, unknown>`)

## Skills

Pass `skills: true` to declare the `io.modelcontextprotocol/skills` extension (`2026-07-28` only).
Skill content is untrusted: `readSkillFile` reads a file only if the entry lists it, then checks
size and SHA-256 digest (and the frontmatter for `SKILL.md`). It throws `SkillVerificationError`
and never returns content that fails a check. Nothing is read before it is asked for.

```typescript
const client = new ContextClient({ protocolVersion: '2026-07-28', transport, skills: true })

const { skills } = await client.listSkills()
const entry = skills[0]
const file = await client.readSkillFile(entry, entry.uri) // verified SKILL.md
```

## [Documentation](https://mokei.dev)

## Tracing payloads

MCP tracing payload capture defaults to `off` for library clients and hosts.
Set `tracing.payloads` to `on` or a byte cap to include redacted request and response content.
The daemon explicitly passes its configuration value, which defaults to `on`.
