# Implementation Plan: Mokei Improvements

**Based on**: PRD.md  
**Created**: January 16, 2026  
**Status**: Planning  

---

## Overview

This document provides detailed implementation steps for the improvements outlined in the PRD. Each feature includes:
- Prerequisites and dependencies
- Step-by-step implementation tasks
- Verification criteria
- Testing requirements

---

## Table of Contents

1. [Phase 1: P0 Features (Critical)](#phase-1-p0-features-critical)
   - [1.1 Agent Loop Abstraction](#11-agent-loop-abstraction)
   - [1.2 Anthropic Provider](#12-anthropic-provider)
   - [1.3 Structured Output Support](#13-structured-output-support)
2. [Phase 2: P1 Features (Important)](#phase-2-p1-features-important)
   - [2.1 React Hooks Package](#21-react-hooks-package)
   - [2.2 HTTP Transport for Contexts](#22-http-transport-for-contexts)
   - [2.3 Local Tools Support](#23-local-tools-support)
3. [Phase 3: P2 Features (Nice to Have)](#phase-3-p2-features-nice-to-have)
4. [Testing Strategy](#testing-strategy)
5. [Release Checklist](#release-checklist)

---

## Phase 1: P0 Features (Critical)

### 1.1 Agent Loop Abstraction

**Package**: `@mokei/session` (extend existing)  
**Estimated Effort**: 2-3 weeks  
**Dependencies**: None (builds on existing Session)

#### Step 1.1.1: Define Agent Types

**Tasks**:
- [ ] Create `AgentParams` type with configuration options
- [ ] Create `AgentEvent` union type for stream events
- [ ] Create `AgentResult` type for final output
- [ ] Create `ToolApproval` type for approval strategies

**File**: `packages/session/src/agent-types.ts`

```typescript
// Types to implement
export type ToolApprovalStrategy = 
  | 'auto'           // Execute all tools automatically
  | 'ask'            // Emit event and wait for approval
  | 'never'          // Never execute tools (dry run)
  | ToolApprovalFn   // Custom function

export type ToolApprovalFn = (
  toolCall: FunctionToolCall<unknown>,
  context: { iteration: number; history: Array<AgentEvent> }
) => Promise<boolean | { approved: boolean; reason?: string }>

export type AgentParams<T extends ProviderTypes = ProviderTypes> = {
  provider: string | ModelProvider<T>
  model: string
  host: ContextHost
  systemPrompt?: string
  toolApproval?: ToolApprovalStrategy
  maxIterations?: number  // Default: 10
  timeout?: number        // Default: 5 minutes
  onEvent?: (event: AgentEvent) => void
}

export type AgentEvent =
  | { type: 'start'; prompt: string; timestamp: number }
  | { type: 'iteration-start'; iteration: number; timestamp: number }
  | { type: 'text-delta'; text: string; timestamp: number }
  | { type: 'text-complete'; text: string; timestamp: number }
  | { type: 'tool-call-pending'; toolCall: FunctionToolCall<unknown>; timestamp: number }
  | { type: 'tool-call-approved'; toolCall: FunctionToolCall<unknown>; timestamp: number }
  | { type: 'tool-call-denied'; toolCall: FunctionToolCall<unknown>; reason?: string; timestamp: number }
  | { type: 'tool-call-start'; toolCall: FunctionToolCall<unknown>; timestamp: number }
  | { type: 'tool-call-complete'; toolCall: FunctionToolCall<unknown>; result: CallToolResult; timestamp: number }
  | { type: 'tool-call-error'; toolCall: FunctionToolCall<unknown>; error: Error; timestamp: number }
  | { type: 'iteration-complete'; iteration: number; timestamp: number }
  | { type: 'complete'; result: AgentResult; timestamp: number }
  | { type: 'error'; error: Error; timestamp: number }
  | { type: 'timeout'; timestamp: number }
  | { type: 'max-iterations'; iteration: number; timestamp: number }

export type AgentResult = {
  text: string
  iterations: number
  toolCalls: Array<{
    call: FunctionToolCall<unknown>
    result: CallToolResult
    approved: boolean
  }>
  inputTokens: number
  outputTokens: number
  duration: number
}
```

**Verification Criteria**:
- [ ] All types compile without errors
- [ ] Types are exported from package index
- [ ] JSDoc comments added for all public types

---

#### Step 1.1.2: Implement AgentSession Class

**Tasks**:
- [ ] Create `AgentSession` class extending `Disposer`
- [ ] Implement `run(prompt: string)` method for one-shot execution
- [ ] Implement `stream(prompt: string)` method returning `AsyncIterable<AgentEvent>`
- [ ] Implement tool approval logic with all strategies
- [ ] Implement iteration tracking and limits
- [ ] Implement timeout handling
- [ ] Add proper cleanup on abort/dispose

**File**: `packages/session/src/agent-session.ts`

```typescript
// Core implementation structure
export class AgentSession<T extends ProviderTypes = ProviderTypes> extends Disposer {
  #params: Required<AgentParams<T>>
  #session: Session<T>
  
  constructor(params: AgentParams<T>) {
    // Initialize with defaults
  }
  
  async run(prompt: string, signal?: AbortSignal): Promise<AgentResult> {
    // Collect all events from stream and return final result
  }
  
  async *stream(prompt: string, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    // Main agent loop:
    // 1. Send message to model
    // 2. If tool calls, handle approval
    // 3. Execute approved tools
    // 4. Continue until no tool calls or max iterations
  }
  
  #shouldContinue(iteration: number, response: AggregatedMessage<T['ToolCall']>): boolean {
    // Check iteration limit and whether there are pending tool calls
  }
  
  async #approveToolCall(toolCall: FunctionToolCall<unknown>, context: object): Promise<boolean> {
    // Handle approval based on strategy
  }
}
```

**Verification Criteria**:
- [ ] `run()` executes complete agent loop and returns result
- [ ] `stream()` yields events for each stage
- [ ] Tool approval strategies work correctly:
  - [ ] `'auto'` executes all tools without prompting
  - [ ] `'ask'` emits pending event and waits
  - [ ] `'never'` skips all tool execution
  - [ ] Custom function is called with correct context
- [ ] Max iterations limit is respected
- [ ] Timeout aborts execution
- [ ] AbortSignal cancels execution
- [ ] Resources are cleaned up on completion/error

---

#### Step 1.1.3: Add Unit Tests

**File**: `packages/session/test/agent-session.test.ts`

**Test Cases**:
- [ ] Basic run without tools completes in 1 iteration
- [ ] Run with tools executes tool and continues
- [ ] Max iterations stops execution
- [ ] Timeout aborts execution
- [ ] AbortSignal cancels execution
- [ ] Tool approval 'auto' executes all tools
- [ ] Tool approval 'never' skips all tools
- [ ] Tool approval custom function is called
- [ ] Stream yields correct event sequence
- [ ] Error in tool execution is handled
- [ ] Multiple tool calls in single response
- [ ] Nested tool calls across iterations

**Verification Criteria**:
- [ ] All tests pass
- [ ] Code coverage > 80%
- [ ] Edge cases covered

---

#### Step 1.1.4: Add Integration Tests

**File**: `integration-tests/suites/agent-session.test.ts`

**Test Cases**:
- [ ] Agent with real MCP server (sqlite)
- [ ] Multi-step task (create table, insert, query)
- [ ] Agent with multiple contexts
- [ ] Timeout with slow tool

**Verification Criteria**:
- [ ] Tests pass with real MCP servers
- [ ] Cleanup works correctly

---

#### Step 1.1.5: Documentation

**Tasks**:
- [ ] Add `llms/agent.md` documentation file
- [ ] Update `llms.txt` with agent section
- [ ] Add JSDoc comments to all public APIs
- [ ] Create example in documentation

**Verification Criteria**:
- [ ] Documentation builds without errors
- [ ] Examples are runnable
- [ ] API reference is complete

---

### 1.2 Anthropic Provider

**Package**: `@mokei/anthropic-provider` (new)  
**Estimated Effort**: 1-2 weeks  
**Dependencies**: None

#### Step 1.2.1: Create Package Structure

**Tasks**:
- [ ] Create `packages/anthropic-provider/` directory
- [ ] Initialize `package.json` with dependencies
- [ ] Create `tsconfig.json` extending root config
- [ ] Add package to workspace

**Files to create**:
```
packages/anthropic-provider/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts
    ├── client.ts
    ├── config.ts
    ├── provider.ts
    └── types.ts
```

**package.json dependencies**:
```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30.0",
    "@enkaku/schema": "catalog:",
    "@mokei/model-provider": "workspace:^"
  }
}
```

**Verification Criteria**:
- [ ] Package builds successfully
- [ ] Package is recognized in workspace
- [ ] TypeScript compilation works

---

#### Step 1.2.2: Implement AnthropicClient

**File**: `packages/anthropic-provider/src/client.ts`

**Tasks**:
- [ ] Create `AnthropicClient` wrapper class
- [ ] Implement `createMessage()` with streaming
- [ ] Handle tool use blocks in responses
- [ ] Handle extended thinking (if model supports)

**Verification Criteria**:
- [ ] Client can create streaming messages
- [ ] Tool use blocks are parsed correctly
- [ ] Extended thinking content is captured
- [ ] Error responses are handled

---

#### Step 1.2.3: Implement AnthropicProvider

**File**: `packages/anthropic-provider/src/provider.ts`

**Tasks**:
- [ ] Implement `ModelProvider<AnthropicTypes>` interface
- [ ] Implement `listModels()` - return known Claude models
- [ ] Implement `streamChat()` with proper message conversion
- [ ] Implement `aggregateMessage()` for response assembly
- [ ] Implement `toolFromMCP()` for MCP → Anthropic tool conversion
- [ ] Handle Anthropic-specific message format (content blocks)

**Message Format Conversion**:
```typescript
// Mokei message format
{ source: 'client', role: 'user', text: 'Hello' }

// Anthropic format
{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }
```

**Tool Format Conversion**:
```typescript
// MCP tool
{
  name: 'query',
  description: 'Query database',
  inputSchema: { type: 'object', properties: {...} }
}

// Anthropic tool
{
  name: 'query',
  description: 'Query database',
  input_schema: { type: 'object', properties: {...} }
}
```

**Verification Criteria**:
- [ ] All ModelProvider methods implemented
- [ ] Message conversion is bidirectional
- [ ] Tool conversion produces valid Anthropic format
- [ ] Streaming works correctly
- [ ] Token counts are captured

---

#### Step 1.2.4: Add Unit Tests

**File**: `packages/anthropic-provider/test/provider.test.ts`

**Test Cases**:
- [ ] Provider initialization from config
- [ ] Message format conversion
- [ ] Tool format conversion
- [ ] Stream chat basic flow (mocked)
- [ ] Aggregate message assembly
- [ ] Error handling

**Verification Criteria**:
- [ ] All tests pass
- [ ] Mocked tests don't require API key

---

#### Step 1.2.5: Add Integration Tests

**File**: `packages/anthropic-provider/test/integration.test.ts`

**Test Cases** (requires API key, skipped in CI):
- [ ] Real API call with streaming
- [ ] Tool calling with real model
- [ ] Extended thinking capture

**Verification Criteria**:
- [ ] Tests pass with valid API key
- [ ] Tests skip gracefully without key

---

#### Step 1.2.6: Documentation

**Tasks**:
- [ ] Create `packages/anthropic-provider/README.md`
- [ ] Update `llms/providers.md` with Anthropic section
- [ ] Add to package table in `llms.txt`

**Verification Criteria**:
- [ ] README has usage examples
- [ ] Provider docs are complete

---

### 1.3 Structured Output Support

**Package**: `@mokei/model-provider`, `@mokei/session`, providers  
**Estimated Effort**: 1-2 weeks  
**Dependencies**: Zod (new dependency)

#### Step 1.3.1: Add Zod Dependency

**Tasks**:
- [ ] Add `zod` to workspace catalog
- [ ] Add as peer dependency to relevant packages
- [ ] Create schema utility types

**Verification Criteria**:
- [ ] Zod is available in packages
- [ ] Types work with Zod schemas

---

#### Step 1.3.2: Define Structured Output Types

**File**: `packages/model-provider/src/structured.ts`

**Tasks**:
- [ ] Create `StructuredOutputParams<T>` type
- [ ] Create `StructuredOutputResult<T>` type
- [ ] Create utility for Zod → JSON Schema conversion

```typescript
import type { z } from 'zod'

export type StructuredOutputParams<T extends z.ZodType> = {
  schema: T
  name?: string        // For OpenAI function calling mode
  description?: string
  strict?: boolean     // Require exact schema match
}

export type StructuredOutputResult<T extends z.ZodType> = {
  structured: z.infer<T>
  raw: string
  parseError?: Error  // If validation failed but we got JSON
}
```

**Verification Criteria**:
- [ ] Types compile correctly
- [ ] Zod type inference works

---

#### Step 1.3.3: Update Provider Interface

**File**: `packages/model-provider/src/index.ts`

**Tasks**:
- [ ] Add optional `output` param to `StreamChatParams`
- [ ] Add `structured` field to aggregated response
- [ ] Define provider-agnostic structured output handling

**Verification Criteria**:
- [ ] Interface changes are backward compatible
- [ ] Existing code continues to work

---

#### Step 1.3.4: Implement in OpenAI Provider

**File**: `packages/openai-provider/src/provider.ts`

**Tasks**:
- [ ] Detect structured output params in `streamChat()`
- [ ] Use OpenAI's JSON mode or function calling for structured output
- [ ] Parse and validate response with Zod schema
- [ ] Include structured result in aggregated message

**Implementation approach**:
```typescript
// Option 1: response_format with json_schema (GPT-4o+)
response_format: {
  type: 'json_schema',
  json_schema: {
    name: params.output.name ?? 'response',
    schema: zodToJsonSchema(params.output.schema),
    strict: params.output.strict ?? true
  }
}

// Option 2: Fallback - function calling
tools: [{
  type: 'function',
  function: {
    name: 'respond',
    parameters: zodToJsonSchema(params.output.schema)
  }
}],
tool_choice: { type: 'function', function: { name: 'respond' } }
```

**Verification Criteria**:
- [ ] Structured output works with GPT-4o
- [ ] Fallback works with older models
- [ ] Validation errors are reported
- [ ] Schema is enforced

---

#### Step 1.3.5: Implement in Ollama Provider

**File**: `packages/ollama-provider/src/provider.ts`

**Tasks**:
- [ ] Use Ollama's JSON mode when structured output requested
- [ ] Parse response as JSON
- [ ] Validate against Zod schema

**Verification Criteria**:
- [ ] Works with models supporting JSON mode
- [ ] Graceful error for unsupported models

---

#### Step 1.3.6: Implement in Anthropic Provider

**File**: `packages/anthropic-provider/src/provider.ts`

**Tasks**:
- [ ] Use tool_choice to force JSON response
- [ ] Parse and validate tool response

**Verification Criteria**:
- [ ] Structured output works with Claude models

---

#### Step 1.3.7: Update Session

**File**: `packages/session/src/session.ts`

**Tasks**:
- [ ] Pass structured output params to provider
- [ ] Include structured result in chat response

**Verification Criteria**:
- [ ] Session.chat() supports output param
- [ ] Type inference works end-to-end

---

#### Step 1.3.8: Add Tests

**Test Cases**:
- [ ] Simple object schema
- [ ] Nested object schema
- [ ] Array schema
- [ ] Optional fields
- [ ] Validation failure handling
- [ ] Provider-specific behavior

**Verification Criteria**:
- [ ] All providers handle structured output
- [ ] Type inference is correct

---

#### Step 1.3.9: Documentation

**Tasks**:
- [ ] Add structured output section to provider docs
- [ ] Add examples with different schema types
- [ ] Document provider-specific limitations

**Verification Criteria**:
- [ ] Examples are runnable
- [ ] Limitations are documented

---

## Phase 2: P1 Features (Important)

### 2.1 React Hooks Package

**Package**: `@mokei/react` (new)  
**Estimated Effort**: 2-3 weeks  
**Dependencies**: P0 features complete

#### Step 2.1.1: Create Package Structure

**Tasks**:
- [ ] Create `packages/react/` directory
- [ ] Initialize package with React peer dependency
- [ ] Set up build for ESM/CJS dual export

**Files**:
```
packages/react/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts
    ├── context.tsx
    ├── use-session.ts
    ├── use-chat.ts
    ├── use-agent.ts
    └── use-tools.ts
```

**Verification Criteria**:
- [ ] Package builds for both ESM and CJS
- [ ] React is peer dependency (not bundled)

---

#### Step 2.1.2: Implement SessionProvider Context

**File**: `packages/react/src/context.tsx`

**Tasks**:
- [ ] Create `SessionContext` 
- [ ] Create `SessionProvider` component
- [ ] Create `useSessionContext` hook

```typescript
export const SessionProvider: React.FC<{
  session: Session
  children: React.ReactNode
}> = ({ session, children }) => {
  // Manage session lifecycle
  // Cleanup on unmount
}
```

**Verification Criteria**:
- [ ] Context provides session instance
- [ ] Cleanup on unmount

---

#### Step 2.1.3: Implement useChat Hook

**File**: `packages/react/src/use-chat.ts`

**Tasks**:
- [ ] Track messages state
- [ ] Track loading/streaming state
- [ ] Implement `send()` function
- [ ] Handle streaming updates
- [ ] Handle errors

```typescript
export function useChat(params: UseChatParams): UseChatReturn {
  const [messages, setMessages] = useState<Message[]>([])
  const [status, setStatus] = useState<ChatStatus>('idle')
  const [error, setError] = useState<Error | null>(null)
  
  const send = useCallback(async (text: string) => {
    // Add user message
    // Call session.chat()
    // Update messages with response
    // Handle tool calls if needed
  }, [])
  
  return { messages, status, error, send, retry, stop }
}
```

**Verification Criteria**:
- [ ] Messages state updates correctly
- [ ] Streaming updates are reflected
- [ ] Error state is managed
- [ ] Cleanup prevents state updates after unmount

---

#### Step 2.1.4: Implement useAgent Hook

**File**: `packages/react/src/use-agent.ts`

**Tasks**:
- [ ] Wrap AgentSession for React
- [ ] Track agent events
- [ ] Provide run/stop controls

**Verification Criteria**:
- [ ] Agent events trigger re-renders
- [ ] Can stop running agent

---

#### Step 2.1.5: Implement useTools Hook

**File**: `packages/react/src/use-tools.ts`

**Tasks**:
- [ ] List available tools from host
- [ ] Track tool enable/disable state
- [ ] Provide toggle functions

**Verification Criteria**:
- [ ] Tools list updates when contexts change
- [ ] Enable/disable works

---

#### Step 2.1.6: Add Tests

**Tasks**:
- [ ] Unit tests with React Testing Library
- [ ] Test hook lifecycle
- [ ] Test state updates
- [ ] Test cleanup

**Verification Criteria**:
- [ ] All hooks tested
- [ ] No memory leaks

---

#### Step 2.1.7: Create Example App

**Tasks**:
- [ ] Create simple chat UI example
- [ ] Demonstrate all hooks
- [ ] Add to examples/ directory

**Verification Criteria**:
- [ ] Example runs
- [ ] Demonstrates key features

---

### 2.2 HTTP Transport for Contexts

**Package**: `@mokei/host`  
**Estimated Effort**: 1-2 weeks  
**Dependencies**: Enkaku HTTP transports

#### Step 2.2.1: Define HTTP Context Types

**File**: `packages/host/src/http-context.ts`

**Tasks**:
- [ ] Create `HttpContextParams` type
- [ ] Support URL, headers, auth options
- [ ] Support SSE for server-initiated messages

```typescript
export type HttpContextParams = {
  key: string
  url: string
  headers?: Record<string, string>
  auth?: {
    type: 'bearer'
    token: string
  } | {
    type: 'basic'
    username: string
    password: string
  }
  timeout?: number
  retries?: number
}
```

**Verification Criteria**:
- [ ] Types are complete
- [ ] Auth options cover common cases

---

#### Step 2.2.2: Implement HTTP Transport Wrapper

**File**: `packages/host/src/http-transport.ts`

**Tasks**:
- [ ] Create transport using `@enkaku/http-client-transport`
- [ ] Implement MCP over HTTP (Streamable HTTP spec)
- [ ] Handle connection lifecycle

**Verification Criteria**:
- [ ] Transport connects to HTTP endpoint
- [ ] Messages are sent/received correctly

---

#### Step 2.2.3: Add addHttpContext Method

**File**: `packages/host/src/host.ts`

**Tasks**:
- [ ] Add `addHttpContext()` method to ContextHost
- [ ] Integrate with existing context management
- [ ] Handle reconnection on failure

**Verification Criteria**:
- [ ] HTTP context works like local context
- [ ] Tools are discovered and callable

---

#### Step 2.2.4: Add Tests

**Tasks**:
- [ ] Unit tests with mocked HTTP
- [ ] Integration test with real HTTP server

**Verification Criteria**:
- [ ] All tests pass
- [ ] Error cases handled

---

### 2.3 Local Tools Support

**Package**: `@mokei/session`  
**Estimated Effort**: 1 week  
**Dependencies**: None

#### Step 2.3.1: Define Local Tool Types

**File**: `packages/session/src/local-tools.ts`

**Tasks**:
- [ ] Create `LocalToolDefinition` type
- [ ] Create `LocalToolRegistry` class

```typescript
export type LocalToolDefinition = {
  description: string
  inputSchema: InputSchema
  execute: (args: unknown, signal: AbortSignal) => Promise<CallToolResult>
}

export type LocalToolsConfig = Record<string, LocalToolDefinition>
```

**Verification Criteria**:
- [ ] Types match MCP tool interface
- [ ] Execute function signature is correct

---

#### Step 2.3.2: Integrate with Session

**File**: `packages/session/src/session.ts`

**Tasks**:
- [ ] Accept `localTools` in SessionParams
- [ ] Merge local tools with MCP tools
- [ ] Route tool calls to local or MCP
- [ ] Namespace local tools as `local:toolName`

**Verification Criteria**:
- [ ] Local tools appear in tool list
- [ ] Tool calls route correctly
- [ ] No conflicts with MCP tools

---

#### Step 2.3.3: Add Tests

**Tasks**:
- [ ] Test local tool registration
- [ ] Test mixed local + MCP tools
- [ ] Test tool execution

**Verification Criteria**:
- [ ] All scenarios work

---

## Phase 3: P2 Features (Nice to Have)

### 3.1 Framework Middleware

Brief outline (detailed planning deferred):

- [ ] Create `@mokei/express` package
- [ ] Create `@mokei/hono` package
- [ ] Create `@mokei/fastify` package
- [ ] Each provides route handlers for exposing host/session over HTTP

### 3.2 Tree-Shakeable Exports

Brief outline:

- [ ] Restructure provider packages with subpath exports
- [ ] Update package.json exports field
- [ ] Verify tree-shaking works in bundlers

### 3.3 Enhanced Error Handling

Brief outline:

- [ ] Add error handling configuration to Session
- [ ] Implement retry logic
- [ ] Add circuit breaker for failing tools

---

## Testing Strategy

### Unit Tests

- **Location**: `packages/*/test/*.test.ts`
- **Framework**: Vitest
- **Coverage Target**: 80%
- **Run**: `pnpm test`

### Integration Tests

- **Location**: `integration-tests/suites/*.test.ts`
- **Framework**: Vitest
- **Requirements**: May need API keys, MCP servers
- **Run**: `pnpm test:integration`

### Manual Testing Checklist

For each feature, verify:

- [ ] Works with OpenAI provider
- [ ] Works with Ollama provider
- [ ] Works with Anthropic provider (once added)
- [ ] Works with CLI commands
- [ ] Works with monitor UI
- [ ] Error messages are clear
- [ ] TypeScript types are correct

---

## Release Checklist

### Pre-Release

- [ ] All tests pass
- [ ] Documentation updated
- [ ] CHANGELOG updated
- [ ] Version bumped appropriately
- [ ] No TypeScript errors
- [ ] No lint errors (`pnpm lint`)
- [ ] Build succeeds (`pnpm build`)

### Release

- [ ] Create git tag
- [ ] Publish to npm
- [ ] Update GitHub releases
- [ ] Announce (if applicable)

### Post-Release

- [ ] Verify packages on npm
- [ ] Test installation in fresh project
- [ ] Monitor for issues

---

## Dependency Graph

```
Phase 1 (P0)
├── 1.1 Agent Loop ─────────────────┐
├── 1.2 Anthropic Provider          │
└── 1.3 Structured Output ──────────┤
                                    │
Phase 2 (P1)                        │
├── 2.1 React Hooks ◄───────────────┘ (depends on Agent Loop)
├── 2.2 HTTP Transport
└── 2.3 Local Tools

Phase 3 (P2)
├── 3.1 Framework Middleware ◄──────── (depends on HTTP Transport)
├── 3.2 Tree-Shakeable
└── 3.3 Error Handling
```

---

## Timeline Summary

| Week | Focus |
|------|-------|
| 1-2 | Agent Loop Abstraction (1.1) |
| 3 | Anthropic Provider (1.2) |
| 4 | Structured Output (1.3) |
| 5-6 | React Hooks (2.1) |
| 7 | HTTP Transport (2.2) |
| 8 | Local Tools (2.3) |
| 9+ | P2 Features as time permits |

---

## Success Criteria for Phase 1 Completion

- [ ] AgentSession can run multi-step tasks autonomously
- [ ] Anthropic Claude models work with Mokei
- [ ] Structured output produces typed responses
- [ ] All existing tests still pass
- [ ] Documentation is complete for new features
- [ ] At least one example demonstrates each feature
