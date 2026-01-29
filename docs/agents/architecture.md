# Architecture

## Project Overview

Mokei is a TypeScript toolkit for creating, interacting with, and monitoring clients and servers using the Model Context Protocol (MCP). It provides a comprehensive framework for building MCP-based applications with AI model integration.

**Repository**: https://github.com/TairuFramework/mokei
**Documentation**: See `docs/` folder or `llms.txt` for LLM-optimized docs

---

## Architecture

```
+-------------------------------------------------------------+
|                     AgentSession                             |
|  (Automatic agent loop with tool execution)                  |
+-------------------------------------------------------------+
|                        Session                               |
|  (High-level abstraction for chat + MCP)                    |
+-------------------------------------------------------------+
|                     ContextHost                              |
|  (Manages multiple MCP server connections)                   |
+----------------------------+---------------------------------+
|   ContextClient            |          Model Providers         |
|   (MCP client)             |   (OpenAI, Anthropic, Ollama)   |
+----------------------------+---------------------------------+
|   ContextServer            |                                  |
|   (MCP server)             |                                  |
+-------------------------------------------------------------+
```

### Communication Flow

1. Host spawns MCP server processes via stdio streams (or connects via HTTP)
2. Client initializes connection and discovers tools/prompts
3. Tools are namespaced as `contextKey:toolName` (or `local:toolName` for local tools)
4. Session routes tool calls to appropriate MCP servers
5. Results are aggregated and returned to model providers

---

## Architecture Patterns

### MCP Server Creation
- Use `createTool` and `createPrompt` factory functions
- Implement proper schema validation for all tools
- Follow the transport abstraction pattern

### Tool System
- Tools are namespaced as `contextKey:toolName`
- Each context maintains its own tool registry
- Use `callNamespacedTool` for routing tool calls

### Context Management
- Use `ContextHost` for managing multiple MCP server connections
- Implement proper context lifecycle management
- Handle context enable/disable states

### Tool Registration
- Register tools with proper schemas
- Implement tool execution handlers
- Handle tool discovery and listing

### Error Handling
- Implement comprehensive error propagation through the RPC layer
- Ensure proper process cleanup on failures
- Include signal handling for graceful shutdown

### Resource Management
- Use hierarchical disposal pattern for resource cleanup
- Implement proper cleanup in `dispose()` methods
- Handle process lifecycle correctly with `nano-spawn`

---

## Package Structure

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

---

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

---

## CLI Commands

```bash
mokei context monitor    # Monitor MCP server contexts
mokei context inspect    # Inspect available tools and prompts
mokei chat openai        # Interactive chat with OpenAI
mokei chat ollama        # Interactive chat with Ollama
mokei chat anthropic     # Interactive chat with Anthropic
```

---

## Integration with External Providers

Mokei supports multiple LLM providers through a unified provider interface:

- **OpenAI** (`packages/openai-provider/`) -- Integration with OpenAI models
- **Anthropic** (`packages/anthropic-provider/`) -- Integration with Anthropic Claude models
- **Ollama** (`packages/ollama-provider/`) -- Integration with locally-running Ollama models

Each provider implements the `ModelProvider` interface defined in `packages/model-provider/`, enabling consistent usage across different LLM backends.
