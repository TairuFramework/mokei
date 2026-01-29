# AGENTS.md

This file provides guidance to AI coding assistants (Claude Code, Cursor, Copilot, etc.) when working with code in this repository.

## Project Overview

Mokei is a TypeScript toolkit for creating, interacting with, and monitoring clients and servers using the Model Context Protocol (MCP). It provides a comprehensive framework for building MCP-based applications with AI model integration.

**Repository**: https://github.com/TairuFramework/mokei
**Documentation**: See `docs/` folder or `llms.txt` for LLM-optimized docs

## Quick Reference

### Development Commands

| Command | Purpose |
|---------|---------|
| `pnpm build` | Full build (types + JS) |
| `pnpm build:types` | Build TypeScript declarations only |
| `pnpm build:js` | Build JavaScript using Turbo |
| `pnpm test` | Run tests |
| `pnpm lint` | Run Biome linter with auto-fix |
| `pnpm run -r <command>` | Run command across all workspace packages |

### Package Structure

```
packages/
├── context-protocol/     # MCP protocol definitions and types
├── context-rpc/          # JSON-RPC implementation
├── context-server/       # MCP server implementation
├── context-client/       # MCP client implementation
├── host/                 # Multi-context orchestrator
├── session/              # High-level chat + MCP abstraction
├── model-provider/       # Provider interface definitions
├── openai-provider/      # OpenAI integration
├── anthropic-provider/   # Anthropic Claude integration
└── ollama-provider/      # Ollama integration
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     AgentSession                             │
│  (Automatic agent loop with tool execution)                  │
├─────────────────────────────────────────────────────────────┤
│                        Session                               │
│  (High-level abstraction for chat + MCP)                    │
├─────────────────────────────────────────────────────────────┤
│                     ContextHost                              │
│  (Manages multiple MCP server connections)                   │
├─────────────────────────────────────────────────────────────┤
│   ContextClient          │          Model Providers          │
│   (MCP client)           │   (OpenAI, Anthropic, Ollama)    │
├──────────────────────────┼──────────────────────────────────┤
│   ContextServer          │                                   │
│   (MCP server)           │                                   │
└─────────────────────────────────────────────────────────────┘
```

### Communication Flow

1. Host spawns MCP server processes via stdio streams (or connects via HTTP)
2. Client initializes connection and discovers tools/prompts
3. Tools are namespaced as `contextKey:toolName` (or `local:toolName` for local tools)
4. Session routes tool calls to appropriate MCP servers
5. Results are aggregated and returned to model providers

### Architecture Patterns

#### MCP Server Creation
- Use `createTool` and `createPrompt` factory functions
- Implement proper schema validation for all tools
- Follow the transport abstraction pattern

#### Tool System
- Tools are namespaced as `contextKey:toolName`
- Each context maintains its own tool registry
- Use `callNamespacedTool` for routing tool calls

#### Context Management
- Use `ContextHost` for managing multiple MCP server connections
- Implement proper context lifecycle management
- Handle context enable/disable states

#### Tool Registration
- Register tools with proper schemas
- Implement tool execution handlers
- Handle tool discovery and listing

#### Error Handling
- Implement comprehensive error propagation through the RPC layer
- Ensure proper process cleanup on failures
- Include signal handling for graceful shutdown

#### Resource Management
- Use hierarchical disposal pattern for resource cleanup
- Implement proper cleanup in `dispose()` methods
- Handle process lifecycle correctly with `nano-spawn`

## Code Style Rules

### Type Definitions
Always use `type` instead of `interface` for all type definitions:
```typescript
// Correct
type User = {
  id: string
  name: string
  email: string
}

type UserOrAdmin = User | Admin

// Avoid
interface User {
  id: string
  name: string
  email: string
}
```

### Array Types
Always use `Array<T>` instead of `T[]` for all array type annotations:
```typescript
// Correct
type Users = Array<User>
const users: Array<string> = []
const matrix: Array<Array<number>> = []
const handlers: Array<(data: string) => void> = []

// Avoid
type Users = User[]
const users: string[] = []
const matrix: number[][] = []
const handlers: ((data: string) => void)[] = []
```

### Function Types
Use `type` for function type definitions with explicit syntax:
```typescript
// Correct
type EventHandler = (event: Event) => void
type AsyncProcessor<T> = (data: T) => Promise<void>

// Avoid
interface EventHandler {
  (event: Event): void
}
```

### Generic Types
Use `type` for generic type definitions, applying array syntax rules:
```typescript
// Correct
type Result<T, E = Error> = {
  success: boolean
  data?: T
  error?: E
}

type ResultArray<T> = Array<Result<T>>

// Avoid
interface Result<T, E = Error> {
  success: boolean
  data?: T
  error?: E
}

type ResultArray<T> = Result<T>[]
```

### TypeScript Patterns
- Use strict TypeScript configuration
- Implement proper type guards
- Use branded types for domain-specific values
- Use proper async/await patterns
- Handle promise rejections appropriately
- Implement timeout handling for long-running operations

### Event Handling
- Use EventEmitter for session events
- Implement proper event cleanup
- Handle event propagation correctly

### Other Conventions
- Use `@enkaku/schema` for JSON Schema validation (not Zod)
- Follow existing patterns in the codebase

## Code Organization

### Package Structure Conventions
- Keep packages focused on single responsibilities
- Use `src/` for source code, `lib/` for compiled output
- Include proper `package.json` with exports

### Import Patterns
- Use relative imports within packages
- Use package names for cross-package imports
- Maintain clean dependency graphs

### Testing
- Integration tests in `integration-tests/`
- Unit tests in each package's `test/` directory
- Use **Vitest** for testing

## Key Technologies

- **TypeScript** with strict typing
- **Enkaku** for stream-based transport and async utilities
- **Node.js Streams** for process communication
- **JSON-RPC** for protocol layer
- **Turbo** for build orchestration
- **Biome** for linting and formatting
- **Vitest** for testing
- **nano-spawn** for process lifecycle management

## Where to Find Things

| Looking for... | Location |
|----------------|----------|
| Protocol types | `packages/context-protocol/src/` |
| Server creation | `packages/context-server/src/` |
| Client implementation | `packages/context-client/src/` |
| Host orchestration | `packages/host/src/` |
| Session/Agent | `packages/session/src/` |
| Provider interface | `packages/model-provider/src/` |
| CLI commands | `mokei/src/commands/` |
| Tests | `packages/*/test/` |
| Integration tests | `integration-tests/` |

## Documentation

For detailed API documentation, see:
- `docs/index.md` - Documentation overview
- `docs/guides/` - Topic-specific guides
- `docs/plans/roadmap.md` - Project roadmap and design decisions
- `llms.txt` - LLM-optimized documentation index

## CLI Commands

```bash
mokei context monitor    # Monitor MCP server contexts
mokei context inspect    # Inspect available tools and prompts
mokei chat openai        # Interactive chat with OpenAI
mokei chat ollama        # Interactive chat with Ollama
mokei chat anthropic     # Interactive chat with Anthropic
```
