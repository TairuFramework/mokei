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

## Code Style Rules

### Type Definitions
Always use `type` instead of `interface`:
```typescript
// Correct
type User = {
  id: string
  name: string
}

// Avoid
interface User {
  id: string
  name: string
}
```

### Array Types
Always use `Array<T>` instead of `T[]`:
```typescript
// Correct
type Users = Array<User>
const users: Array<string> = []

// Avoid
type Users = User[]
const users: string[] = []
```

### Other Conventions
- Use TypeScript strict mode
- Use `@enkaku/schema` for JSON Schema validation (not Zod)
- Follow existing patterns in the codebase

## Key Technologies

- **TypeScript** with strict typing
- **Enkaku** for stream-based transport and async utilities
- **Node.js Streams** for process communication
- **JSON-RPC** for protocol layer
- **Turbo** for build orchestration
- **Biome** for linting and formatting
- **Vitest** for testing

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
