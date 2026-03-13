# Mokei Roadmap

**Last Updated**: January 17, 2025

## Overview

Mokei is the premier MCP orchestration toolkit, providing **MCP orchestration + model providers + monitoring** in a single package. This document outlines our vision, completed work, and planned features.

### Project Vision

Mokei occupies a unique niche as a complete MCP orchestration toolkit with:
- Multi-context host for managing multiple MCP servers
- Real-time monitoring infrastructure
- Process isolation for security and fault tolerance
- Tool portability across MCP clients
- Full type safety from server definitions to client usage

### Competitive Position

| Capability | Mokei | Vercel AI | TanStack AI | MCP SDK |
|------------|-------|-----------|-------------|---------|
| MCP Server Creation | Yes | No | No | Yes |
| MCP Client | Yes | No | No | Yes |
| Multi-Context Host | Yes | No | No | No |
| Monitoring UI | Yes | No | No | No |
| Agent Loop | Yes | Yes | Yes | No |
| Structured Output | Yes | Yes | Yes | No |
| OpenAI Provider | Yes | Yes | Yes | No |
| Anthropic Provider | Yes | Yes | Yes | No |
| Ollama Provider | Yes | No | Yes | No |
| HTTP Transport | Yes | N/A | N/A | Yes |
| Local Tools | Yes | Yes | Yes | No |
| CLI Tools | Yes | No | No | No |

---

## Completed Work

### Phase 1: P0 Features (Critical)

#### 1.1 Agent Loop Abstraction
**Status**: Complete (33 tests)

`AgentSession` class with automatic tool execution loop:
- `run()` and `stream()` methods
- Configurable tool approval (`auto`, `ask`, `never`, custom function)
- Maximum iteration limits
- Proper error handling and recovery
- Event emission for all stages

**Files**: `packages/session/src/agent-session.ts`, `packages/session/src/agent-types.ts`

#### 1.2 Anthropic Provider
**Status**: Complete (15 tests)

`@mokei/anthropic-provider` package:
- Streaming chat completion support
- Tool calling support (Claude's native format)
- Extended thinking support
- Proper MCP tool conversion

**Files**: `packages/anthropic-provider/`

#### 1.3 Structured Output Support
**Status**: Complete (8 tests)

Using `@enkaku/schema` for JSON Schema validation:
- OpenAI: `response_format: { type: 'json_schema' }`
- Anthropic: Forced tool call with `tool_choice`
- Ollama: `format` parameter with JSON schema

**Files**: `packages/model-provider/src/index.ts`, provider implementations

### Phase 2: P1 Features (Important)

#### 2.1 Local Tools Support
**Status**: Complete (31 tests)

Local tool registration without MCP server:
- `local:` namespace prefix
- Same interface as MCP tools
- Mixed local + MCP tools work together

**Files**: `packages/host/src/local-tools.ts`, `packages/session/src/session.ts`

#### 2.2 HTTP Transport
**Status**: Complete (18 tests)

MCP Streamable HTTP transport:
- Session management via `Mcp-Session-Id` header
- Support for JSON and SSE responses
- Authentication options (Bearer, Basic, Custom Header)

**Files**: `packages/host/src/http-transport.ts`, `packages/host/src/http-context.ts`

---

## Planned Work

### Phase 3: P2 Features (Nice to Have)

#### 3.1 Framework Middleware
Thin adapter packages for popular frameworks:
- `@mokei/express` - Express.js middleware
- `@mokei/hono` - Hono middleware
- `@mokei/fastify` - Fastify plugin

#### 3.2 Tree-Shakeable Exports
Restructure providers for granular imports:
```typescript
import { createChatProvider } from '@mokei/openai-provider/chat'
import { createEmbedProvider } from '@mokei/openai-provider/embed'
```

#### 3.3 Enhanced Error Handling
Configurable error recovery:
- Retry strategies
- Circuit breaker for failing tools
- Provider failover

### Phase 4: P3 Features (Future)

- OAuth/Auth Helpers for remote MCP servers
- Tool Result Caching for deterministic tools
- Context Persistence (save/load host configuration)
- Google Provider (Gemini model support)
- Metrics/Telemetry hooks

---

## Design Decisions

### UI Agnostic Design
Mokei is designed to be UI framework agnostic. It provides core abstractions (Session, AgentSession, providers) that work with any UI framework or no framework at all. Framework-specific integrations (React hooks, Vue composables) are left to consumers.

### Enkaku Schema over Zod
The project uses `@enkaku/schema` for JSON Schema validation:
- `createValidator()` for runtime validation
- `FromSchema<>` for type inference
- `asType()` for type assertions

This integrates naturally with MCP's JSON Schema-based tool definitions.

### Provider Pattern
All providers follow the same structure:
- `client.ts` - Low-level API client with HTTP calls
- `provider.ts` - Implements `ModelProvider<T>` interface
- `config.ts` - Configuration schema with validation
- `types.ts` - API-specific types

### Streaming Pattern
Use `TransformStream` to convert provider-specific stream events to `MessagePart<>` types for consistent handling across providers.

---

## Test Summary

| Package | Tests | Description |
|---------|-------|-------------|
| `@mokei/session` | 41 | AgentSession (33) + Local Tools (8) |
| `@mokei/anthropic-provider` | 15 | Provider, config, types |
| `@mokei/model-provider` | 8 | Structured output validation |
| `@mokei/host` | 41 | Local tools (23) + HTTP transport (18) |
| **Total New Tests** | **105** | |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Provider coverage | 4+ (OpenAI, Anthropic, Ollama, Google) |
| Framework integrations | 3 (Express, Hono, Fastify) |
| Example projects | 5+ |
| Documentation pages | 30+ |
