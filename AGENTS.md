# AGENTS.md

Mokei is a comprehensive TypeScript toolkit for the Model Context Protocol (MCP). It provides LLM provider abstraction, tool orchestration, and multi-provider support (OpenAI, Anthropic, Ollama, Llama) through a unified session and agent architecture built on typed MCP server/client communication.

## Key Concepts

- **MCP Server/Client Architecture** -- Servers expose tools and prompts; clients connect and discover them. The `ContextHost` orchestrates multiple server connections simultaneously.
- **Tool Namespacing** -- Tools are namespaced as `contextKey:toolName` (or `local:toolName` for local tools), enabling multiple contexts to coexist without name collisions.
- **Context Management** -- `ContextHost` manages MCP server lifecycles, including spawning processes, initializing connections, and handling enable/disable states.
- **Provider Abstraction** -- A unified `ModelProvider` interface wraps OpenAI, Anthropic, Ollama, and Llama (local GGUF via node-llama-cpp), allowing the `Session` and `AgentSession` layers to work with any backend interchangeably.
- **Session and Agent Layers** -- `Session` provides high-level chat + MCP abstraction; `AgentSession` adds an automatic agent loop with tool execution.

## Package Overview

```
packages/
+-- context-protocol/     # MCP protocol definitions and types
+-- context-rpc/          # JSON-RPC implementation
+-- context-server/       # MCP server implementation
+-- context-client/       # MCP client implementation
+-- host/                 # Multi-context orchestrator
+-- host-protocol/        # Host <-> monitor protocol types
+-- host-monitor/         # Monitor UI for host contexts
+-- http-client/          # MCP Streamable HTTP client transport
+-- http-server/          # MCP Streamable HTTP server transport
+-- session/              # High-level chat + MCP abstraction
+-- model-provider/       # Provider interface definitions
+-- openai-provider/      # OpenAI integration
+-- anthropic-provider/   # Anthropic Claude integration
+-- ollama-provider/      # Ollama integration
+-- llama-provider/       # Local GGUF inference via node-llama-cpp
+-- logger/               # Shared logger utility
+-- cli/                  # mokei CLI (chat, inspect, monitor, proxy commands)
```

## Quick Commands

| Command | Purpose |
|---------|---------|
| `pnpm build` | Full build (types + JS) |
| `pnpm test` | Run all tests |
| `pnpm lint` | Lint and format |

## Important Guardrails

**DO NOT:**
- Use `interface` for type definitions (use `type`)
- Use lowercase abbreviations in names (`ID` not `Id`, `HTTP` not `Http`, `JWT` not `Jwt`)
- Use `T[]` instead of `Array<T>`
- Use `any` type -- use `unknown`, `Record<string, unknown>`, or a more specific type
- Use `npm`/`npx` -- always use `pnpm`/`pnpx`
- Edit generated files (`.gen.ts`, `__generated__/`, `lib/`, `schema.graphql`)
- Create new packages without checking with the user -- keep functionality in existing packages

## Additional Context

Load these files based on your current task:

| Task | Files to read |
|------|---------------|
| Planning | `docs/agents/architecture.md`, `docs/agents/enkaku.md` |
| Implementation | `docs/agents/conventions.md`, `docs/agents/development.md`, `docs/agents/enkaku.md` |
| Review | `docs/agents/conventions.md`, `docs/agents/architecture.md`, `docs/agents/development.md` |
