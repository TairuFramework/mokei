# Product Requirements Document: Mokei Improvements

**Document Version**: 1.0  
**Date**: January 16, 2026  
**Status**: Draft  

---

## Executive Summary

This document outlines proposed improvements to the Mokei toolkit based on competitive analysis of leading AI/MCP solutions: Vercel AI SDK, TanStack AI, and the official MCP TypeScript SDK. The goal is to strengthen Mokei's position as the premier MCP orchestration toolkit while addressing gaps that limit adoption.

Mokei occupies a unique niche as a **complete MCP orchestration toolkit** with monitoring, multi-context management, and model provider integration. However, improvements are needed to match developer experience expectations set by competing solutions.

---

## Table of Contents

1. [Competitive Analysis Summary](#competitive-analysis-summary)
2. [Mokei's Current Strengths](#mokeis-current-strengths)
3. [Identified Gaps](#identified-gaps)
4. [Proposed Improvements](#proposed-improvements)
5. [Implementation Roadmap](#implementation-roadmap)
6. [Success Metrics](#success-metrics)
7. [Appendix: Detailed Competitor Comparison](#appendix-detailed-competitor-comparison)

---

## Competitive Analysis Summary

### Vercel AI SDK
- **Focus**: AI-powered application development with extensive provider support
- **Strengths**: Agent patterns, UI integration, streaming primitives, structured output
- **Weaknesses**: Not MCP-native, tools run in-process (no isolation)

### TanStack AI
- **Focus**: Provider-agnostic SDK with tree-shakeable architecture
- **Strengths**: Bundle optimization, TanStack ecosystem integration, isomorphic tools
- **Weaknesses**: No MCP support, newer project with smaller community

### MCP TypeScript SDK v2
- **Focus**: Official MCP protocol implementation
- **Strengths**: Reference implementation, middleware packages, HTTP transport, OAuth helpers
- **Weaknesses**: Low-level only, no orchestration or provider integration

### Mokei's Position
Mokei is the only solution offering **MCP orchestration + model providers + monitoring** in a single toolkit. This is a defensible position that should be strengthened rather than pivoted.

---

## Mokei's Current Strengths

These differentiators should be preserved and enhanced:

| Strength | Description |
|----------|-------------|
| **Multi-Context Host** | Unique ability to manage multiple MCP servers with tool namespacing |
| **Monitoring Infrastructure** | Real-time observation of MCP traffic via web UI and proxy mode |
| **Process Isolation** | Tools run as separate processes, enabling fault isolation and security |
| **Tool Portability** | MCP tools work across any MCP client (Claude Desktop, etc.) |
| **Enkaku Integration** | Seamless experience for Enkaku stack users |
| **Type Safety** | Full type inference from server definitions to client usage |

---

## Identified Gaps

### Critical Gaps (Blocking Adoption)

| Gap | Impact | Competitor Reference |
|-----|--------|---------------------|
| No agent loop abstraction | Developers must implement tool loops manually | Vercel AI `ToolLoopAgent` |
| Limited provider support | Only OpenAI and Ollama; missing Anthropic (critical for MCP) | Vercel AI supports 10+ providers |
| No structured output | Cannot request typed JSON responses from models | Vercel AI `Output.object()` |

### Significant Gaps (Limiting Growth)

| Gap | Impact | Competitor Reference |
|-----|--------|---------------------|
| No React hooks | Requires manual state management for UIs | Vercel AI `useChat`, TanStack adapters |
| No HTTP transport for contexts | Cannot connect to remote MCP servers | MCP SDK v2 Streamable HTTP |
| No local tools | Must set up MCP server even for simple tools | TanStack AI isomorphic tools |
| Monolithic bundles | Larger than necessary for simple use cases | TanStack AI tree-shaking |

### Minor Gaps (Quality of Life)

| Gap | Impact | Competitor Reference |
|-----|--------|---------------------|
| No framework middleware | Manual setup for Express/Hono integration | MCP SDK middleware packages |
| No auth helpers | Custom implementation needed for authenticated servers | MCP SDK OAuth helpers |
| No tool caching | Repeated identical calls hit MCP servers | Common caching patterns |
| Limited examples | Harder onboarding for new users | Vercel AI extensive examples |

---

## Proposed Improvements

### P0: Critical (Next Release)

#### 1. Agent Loop Abstraction

**Problem**: Developers must manually implement the chat → tool call → result → continue loop.

**Solution**: Add `AgentSession` class with automatic tool execution.

```typescript
// Proposed API
import { AgentSession } from '@mokei/session'

const agent = new AgentSession({
  provider: 'openai',
  model: 'gpt-4',
  host: contextHost,
  toolApproval: 'auto', // or 'ask' or custom function
  maxIterations: 10,
})

// Run to completion
const result = await agent.run('Create a users table and insert 3 records')

// Or stream the execution
for await (const event of agent.stream('...')) {
  switch (event.type) {
    case 'text-delta': /* streaming text */ break
    case 'tool-call': /* tool being called */ break
    case 'tool-result': /* tool returned */ break
    case 'done': /* agent finished */ break
    case 'error': /* error occurred */ break
  }
}
```

**Acceptance Criteria**:
- [ ] AgentSession class with `run()` and `stream()` methods
- [ ] Configurable tool approval (auto, ask, custom function)
- [ ] Maximum iteration limit to prevent infinite loops
- [ ] Proper error handling and recovery
- [ ] Event emission for all stages

---

#### 2. Anthropic Provider

**Problem**: Anthropic Claude is central to the MCP ecosystem, yet Mokei doesn't support it.

**Solution**: Create `@mokei/anthropic-provider` package.

```typescript
import { AnthropicProvider } from '@mokei/anthropic-provider'

const provider = AnthropicProvider.fromConfig({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const session = new Session({
  providers: { anthropic: provider }
})
```

**Acceptance Criteria**:
- [ ] AnthropicProvider implementing ModelProvider interface
- [ ] Streaming chat completion support
- [ ] Tool calling support (Claude's native format)
- [ ] Proper MCP tool conversion
- [ ] Extended thinking support (Claude's reasoning mode)

---

#### 3. Structured Output Support

**Problem**: No way to request typed JSON responses from models.

**Solution**: Add output schema support to chat methods.

```typescript
import { z } from 'zod'

const response = await session.chat({
  provider: 'openai',
  model: 'gpt-4',
  messages: [...],
  output: {
    schema: z.object({
      users: z.array(z.object({
        name: z.string(),
        email: z.string().email(),
      }))
    })
  }
})

// response.structured is fully typed
console.log(response.structured.users[0].name)
```

**Acceptance Criteria**:
- [ ] Accept Zod schema in chat params
- [ ] Provider-specific implementation (OpenAI JSON mode, etc.)
- [ ] Runtime validation of response
- [ ] Typed return value
- [ ] Graceful fallback if model doesn't comply

---

### P1: Important (Following Release)

#### 4. React Hooks Package

**Problem**: No first-class React integration for building chat UIs.

**Solution**: Create `@mokei/react` package with hooks.

```typescript
import { useSession, useChat } from '@mokei/react'

function ChatComponent() {
  const session = useSession({
    providers: { openai: OpenAIProvider.fromConfig({...}) }
  })
  
  const { messages, status, send, tools } = useChat(session, {
    provider: 'openai',
    model: 'gpt-4',
  })
  
  return (
    <div>
      {messages.map(m => <Message key={m.id} message={m} />)}
      <input onSubmit={(text) => send(text)} disabled={status !== 'idle'} />
    </div>
  )
}
```

**Acceptance Criteria**:
- [ ] `useSession` hook for session lifecycle
- [ ] `useChat` hook for conversation state
- [ ] `useTools` hook for tool state management
- [ ] Proper cleanup on unmount
- [ ] SSR compatibility

---

#### 5. HTTP Transport for Contexts

**Problem**: Can only connect to local MCP servers via stdio.

**Solution**: Add HTTP transport support to ContextHost.

```typescript
await host.addHttpContext({
  key: 'remote-server',
  url: 'https://mcp.example.com/api',
  headers: { Authorization: 'Bearer ...' },
  // Optional: SSE for server-initiated messages
  streaming: true,
})
```

**Acceptance Criteria**:
- [ ] HTTP transport implementation using Enkaku
- [ ] Support for Streamable HTTP (MCP spec)
- [ ] Custom headers for authentication
- [ ] Connection retry and timeout handling
- [ ] Proper error propagation

---

#### 6. Local Tools Support

**Problem**: Must set up full MCP server even for simple inline tools.

**Solution**: Allow registering local tool handlers directly.

```typescript
const session = new Session({
  providers: { openai },
  localTools: {
    calculate: {
      description: 'Evaluate a math expression',
      inputSchema: {
        type: 'object',
        properties: { expression: { type: 'string' } },
        required: ['expression']
      },
      execute: async ({ expression }) => {
        const result = evaluate(expression)
        return { content: [{ type: 'text', text: String(result) }] }
      }
    }
  }
})
```

**Acceptance Criteria**:
- [ ] Local tool registration in Session
- [ ] Same interface as MCP tools for consistency
- [ ] Mixed local + MCP tools work together
- [ ] Tool namespacing (`local:toolName`)

---

### P2: Nice to Have (Future Releases)

#### 7. Framework Middleware

Create thin adapter packages for popular frameworks:

- `@mokei/express` - Express.js middleware
- `@mokei/hono` - Hono middleware  
- `@mokei/fastify` - Fastify plugin

```typescript
// @mokei/express
import { createMokeiRouter } from '@mokei/express'

app.use('/api/mcp', createMokeiRouter({ host }))
```

---

#### 8. Tree-Shakeable Provider Exports

Restructure providers for granular imports:

```typescript
// Full import (current)
import { OpenAIProvider } from '@mokei/openai-provider'

// Granular imports (proposed)
import { createChatProvider } from '@mokei/openai-provider/chat'
import { createEmbedProvider } from '@mokei/openai-provider/embed'
```

---

#### 9. Enhanced Error Handling

Add configurable error recovery:

```typescript
const session = new Session({
  errorHandling: {
    onToolError: 'retry', // 'retry' | 'skip' | 'abort' | custom
    maxRetries: 3,
    retryDelay: (attempt) => attempt * 1000,
    onProviderError: async (error) => {
      // Custom handling, e.g., switch providers
    }
  }
})
```

---

### P3: Future Consideration

- **OAuth/Auth Helpers**: Built-in authentication for remote MCP servers
- **Tool Result Caching**: Optional caching layer for deterministic tools
- **Context Persistence**: Save/load host configuration
- **Google Provider**: Gemini model support
- **Metrics/Telemetry**: Built-in observability hooks

---

## Implementation Roadmap

```
Q1 2026
├── January
│   └── P0: Agent Loop Abstraction (design + implementation)
├── February
│   ├── P0: Anthropic Provider
│   └── P0: Structured Output Support
└── March
    └── P1: React Hooks Package (initial release)

Q2 2026
├── April
│   ├── P1: HTTP Transport for Contexts
│   └── P1: Local Tools Support
├── May
│   └── P2: Framework Middleware
└── June
    └── P2: Tree-Shakeable Exports

Q3 2026
└── P2/P3: Error handling, auth helpers, additional providers
```

---

## Success Metrics

| Metric | Current | Target (6 months) |
|--------|---------|-------------------|
| npm weekly downloads | TBD | 2x current |
| GitHub stars | TBD | 500+ |
| Provider coverage | 2 (OpenAI, Ollama) | 4+ (add Anthropic, Google) |
| Framework integrations | 0 | 3 (React, Express, Hono) |
| Example projects | 0 | 5+ |
| Documentation pages | ~10 | 30+ |

---

## Appendix: Detailed Competitor Comparison

### Feature Matrix

| Feature | Mokei | Vercel AI | TanStack AI | MCP SDK |
|---------|-------|-----------|-------------|---------|
| MCP Server Creation | ✅ | ❌ | ❌ | ✅ |
| MCP Client | ✅ | ❌ | ❌ | ✅ |
| Multi-Context Host | ✅ | ❌ | ❌ | ❌ |
| Monitoring UI | ✅ | ❌ | ❌ | ❌ |
| Agent Loop | ❌ | ✅ | ✅ | ❌ |
| Structured Output | ❌ | ✅ | ✅ | ❌ |
| React Hooks | ❌ | ✅ | ✅ | ❌ |
| OpenAI Provider | ✅ | ✅ | ✅ | ❌ |
| Anthropic Provider | ❌ | ✅ | ✅ | ❌ |
| Ollama Provider | ✅ | ❌ | ✅ | ❌ |
| HTTP Transport | ❌ | N/A | N/A | ✅ |
| Tree-Shakeable | ❌ | ❌ | ✅ | ❌ |
| CLI Tools | ✅ | ❌ | ❌ | ❌ |
| Framework Middleware | ❌ | ❌ | ❌ | ✅ |

### Architecture Comparison

**Vercel AI SDK**
```
Provider Adapters → Generate/Stream API → UI Hooks → React/Svelte/Vue
                 ↓
            Tool Execution (in-process)
```

**TanStack AI**
```
Tree-Shakeable Adapters → Headless State → Framework Bindings
                       ↓
                  Local Tools
```

**MCP SDK**
```
Protocol Types → Server/Client → Middleware → Runtime (Express/Hono/Node)
```

**Mokei (Current)**
```
Protocol → Server/Client → Host (multi-context) → Session → Providers
                        ↓
                   Monitoring
```

**Mokei (Proposed)**
```
Protocol → Server/Client → Host → Session → Providers
                        ↓              ↓
                   Monitoring    AgentSession
                                      ↓
                                React Hooks
```

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-16 | - | Initial draft based on competitive analysis |

---

## References

- [Vercel AI SDK](https://github.com/vercel/ai) - ai-sdk.dev
- [TanStack AI](https://github.com/tanstack/ai) - tanstack.com
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) - modelcontextprotocol.io
- [Enkaku](https://www.npmjs.com/org/enkaku) - Modular RPC framework
