# AGENTS.md

Mokei is a comprehensive TypeScript toolkit for the Model Context Protocol (MCP). It provides LLM provider abstraction, tool orchestration, and multi-provider support (OpenAI, Anthropic, Ollama) through a unified session and agent architecture built on typed MCP server/client communication.

## Key Concepts

- **MCP Server/Client Architecture** -- Servers expose tools and prompts; clients connect and discover them. The `ContextHost` orchestrates multiple server connections simultaneously.
- **Tool Namespacing** -- Tools are namespaced as `contextKey:toolName` (or `local:toolName` for local tools), enabling multiple contexts to coexist without name collisions.
- **Context Management** -- `ContextHost` manages MCP server lifecycles, including spawning processes, initializing connections, and handling enable/disable states.
- **Provider Abstraction** -- A unified `ModelProvider` interface wraps OpenAI, Anthropic, and Ollama, allowing the `Session` and `AgentSession` layers to work with any backend interchangeably.
- **Session and Agent Layers** -- `Session` provides high-level chat + MCP abstraction; `AgentSession` adds an automatic agent loop with tool execution.

## Package Overview

```
packages/
+-- context-protocol/     # MCP protocol definitions and types
+-- context-rpc/          # JSON-RPC implementation
+-- context-server/       # MCP server implementation
+-- context-client/       # MCP client implementation
+-- host/                 # Multi-context orchestrator
+-- session/              # High-level chat + MCP abstraction
+-- model-provider/       # Provider interface definitions
+-- openai-provider/      # OpenAI integration
+-- anthropic-provider/   # Anthropic Claude integration
+-- ollama-provider/      # Ollama integration
```

## Quick Commands

| Command | Purpose |
|---------|---------|
| `pnpm build` | Full build (types + JS) |
| `pnpm test` | Run all tests |
| `pnpm lint` | Lint and format |

## Additional Context

Load these files based on your current task:

| Task | Files to read |
|------|---------------|
| Planning | `docs/agents/architecture.md`, `docs/agents/enkaku.md` |
| Implementation | `docs/agents/conventions.md`, `docs/agents/development.md`, `docs/agents/enkaku.md` |
| Review | `docs/agents/conventions.md`, `docs/agents/architecture.md`, `docs/agents/development.md` |
