# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mokei is a TypeScript toolkit for creating, interacting with, and monitoring clients and servers using the Model Context Protocol (MCP). It provides a comprehensive framework for building MCP-based applications with AI model integration.

## Common Development Commands

### Building
- `pnpm build` - Full build (types + JS)
- `pnpm build:types` - Build TypeScript declarations
- `pnpm build:js` - Build JavaScript using Turbo
- `pnpm build:ci` - CI build with type checking

### Testing
- `pnpm test` - Run tests for packages
- `pnpm test:ci` - Run tests in CI mode

### Linting
- `pnpm lint` - Run Biome linter with auto-fix across all packages

### Package Management
- Uses pnpm workspace with catalog dependencies
- `pnpm install` - Install dependencies
- `pnpm run -r <command>` - Run command in all packages

## Core Architecture

### Key Components
- **Context Protocol** (`@mokei/context-protocol`): MCP protocol definitions and TypeScript types
- **Context Client/Server** (`@mokei/context-client`, `@mokei/context-server`): Client and server implementations
- **Host System** (`@mokei/host`): Central orchestrator managing multiple MCP server connections
- **Session Management** (`@mokei/session`): High-level abstraction combining hosts with model providers
- **Model Providers** (`@mokei/openai-provider`, `@mokei/ollama-provider`): AI model integration
- **CLI** (`mokei`): Command-line interface built with oclif

### Communication Flow
1. Host spawns MCP server processes via stdio streams
2. Client initializes connection and discovers tools/prompts
3. Tools are namespaced as `contextKey:toolName`
4. Session routes tool calls to appropriate MCP servers
5. Results are aggregated and returned to model providers

### Key Technologies
- **TypeScript** with strict typing
- **Enkaku** for stream-based transport and async utilities
- **Node.js Streams** for process communication
- **JSON-RPC** for protocol layer
- **Turbo** for build orchestration
- **Biome** for linting and formatting

## Development Patterns

### MCP Server Creation
- Use `createTool` and `createPrompt` factory functions
- Implement proper schema validation
- Follow the transport abstraction pattern

### Tool System
- Each context maintains its own tool registry
- Tools are enabled/disabled per context
- Global tool registry aggregates all enabled tools
- Tool calls are routed back to originating context

### Error Handling
- Comprehensive error propagation through RPC layer
- Process cleanup on failures
- Signal handling for graceful shutdown

### Testing
- Integration tests in `integration-tests/`
- Unit tests in each package's `test/` directory
- Uses Jest with SWC for TypeScript compilation

## Important Implementation Details

### Process Management
- MCP servers run as separate processes using `nano-spawn`
- Stdio-based communication with automatic cleanup
- Proper resource disposal with hierarchical cleanup

### Monorepo Structure
- Uses pnpm workspace with catalog dependencies
- Packages are in `packages/`, `mcp-servers/`, and standalone dirs
- Shared TypeScript configuration with path mapping

### Build System
- TypeScript compilation with declaration maps
- Turbo for incremental builds
- SWC for fast compilation

## TypeScript Code Style Rules

### Type Definitions
- **Always use `type` instead of `interface`** for defining types
  ```typescript
  // ✅ Correct
  type User = {
    id: string;
    name: string;
  };
  
  // ❌ Avoid
  interface User {
    id: string;
    name: string;
  }
  ```

### Array Types
- **Always use `Array<T>` instead of `T[]`** for array type annotations
  ```typescript
  // ✅ Correct
  type Users = Array<User>;
  const users: Array<string> = [];
  
  // ❌ Avoid
  type Users = User[];
  const users: string[] = [];
  ```

## CLI Usage
- `mokei context monitor` - Monitor MCP server contexts
- `mokei context inspect` - Inspect available tools and prompts
- `mokei chat openai` - Interactive chat with OpenAI integration
- `mokei chat ollama` - Interactive chat with Ollama integration