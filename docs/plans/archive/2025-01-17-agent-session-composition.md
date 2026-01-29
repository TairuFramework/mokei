# AgentSession Composition Refactoring Plan

**Status:** complete

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor `AgentSession` to accept a `Session` instance instead of separate `host` + `providers` parameters, eliminating code duplication and establishing Session as the canonical resource manager.

**Summary:** `AgentSession` now accepts a `Session` instance via `AgentParams.session`. Provider resolution delegates to `session.getProvider()`, tool fetching uses `session.getToolsForProvider()`, and tool execution uses `session.executeToolCall()`. The second `providers` constructor argument was removed. This is a breaking API change.

**Architecture:** `AgentSession` becomes a specialized execution layer that delegates resource management to `Session`. It uses `session.contextHost` for tool discovery, `session.providers` for provider lookup, and `session.executeToolCall()` for tool execution. Stream processing remains in `AgentSession` because it needs fine-grained event emission that `Session.chat()` doesn't support.

**Tech Stack:** TypeScript, Vitest for testing

---

## Summary of Changes

### API Changes (Breaking)

**Before:**
```typescript
const agent = new AgentSession({
  provider: openaiProvider,  // or 'openai' string
  model: 'gpt-4',
  host: contextHost,
}, providersMap)  // optional second argument
```

**After:**
```typescript
const agent = new AgentSession({
  session: session,          // required Session instance
  provider: 'openai',        // string key (looked up from session.providers)
  model: 'gpt-4',
})
// OR
const agent = new AgentSession({
  session: session,
  provider: openaiProvider,  // direct provider still supported
  model: 'gpt-4',
})
```

### Code Deduplication

1. Provider resolution → uses `session.getProvider()` or direct instance
2. Tool fetching → uses `session.getToolsForProvider()`  
3. Tool execution → uses `session.executeToolCall()`

---

## Task 1: Update AgentParams Type

**Files:**
- Modify: `packages/session/src/agent-types.ts:50-67`

**Step 1: Update type definition**

Replace:
```typescript
export type AgentParams<T extends ProviderTypes = ProviderTypes> = {
  /** Provider key (string) or ModelProvider instance */
  provider: string | ModelProvider<T>
  /** Model identifier to use for chat completions */
  model: string
  /** ContextHost managing MCP server connections */
  host: ContextHost
  // ...rest
}
```

With:
```typescript
import type { Session } from './session.js'

export type AgentParams<T extends ProviderTypes = ProviderTypes> = {
  /** Session instance managing providers and MCP connections */
  session: Session<T>
  /** Provider key (string to lookup from session) or ModelProvider instance */
  provider: string | ModelProvider<T>
  /** Model identifier to use for chat completions */
  model: string
  /** Optional system prompt prepended to messages */
  systemPrompt?: string
  /** Tool approval strategy (default: 'auto') */
  toolApproval?: ToolApprovalStrategy
  /** Maximum iterations before stopping (default: 10) */
  maxIterations?: number
  /** Timeout in milliseconds (default: 300000 = 5 minutes) */
  timeout?: number
  /** Optional callback for each event during execution */
  onEvent?: (event: AgentEvent) => void
}
```

**Step 2: Update ResolvedAgentParams type**

Replace `host: ContextHost` with `session: Session<T>`:

```typescript
export type ResolvedAgentParams<T extends ProviderTypes = ProviderTypes> = {
  session: Session<T>
  provider: ModelProvider<T>
  model: string
  systemPrompt: string | undefined
  toolApproval: ToolApprovalStrategy
  maxIterations: number
  timeout: number
  onEvent: ((event: AgentEvent) => void) | undefined
}
```

**Step 3: Remove ContextHost import, add Session import**

At top of file, change:
```typescript
import type { ContextHost, ContextTool } from '@mokei/host'
```
To:
```typescript
import type { ContextTool } from '@mokei/host'
import type { Session } from './session.js'
```

**Step 4: Verify types compile**

Run: `pnpm build:types`
Expected: Type errors in agent-session.ts (expected, will fix in Task 2)

---

## Task 2: Update AgentSession Constructor

**Files:**
- Modify: `packages/session/src/agent-session.ts:59-91`

**Step 1: Remove providers parameter, update constructor**

Replace:
```typescript
export class AgentSession<T extends ProviderTypes = ProviderTypes> extends Disposer {
  #params: ResolvedAgentParams<T>
  #events: EventEmitter<AgentSessionEvents>
  #providers: Map<string, ModelProvider<T>>

  constructor(params: AgentParams<T>, providers?: Map<string, ModelProvider<T>>) {
    super()
    this.#events = new EventEmitter()
    this.#providers = providers ?? new Map()

    // Resolve provider
    let provider: ModelProvider<T>
    if (typeof params.provider === 'string') {
      const p = this.#providers.get(params.provider)
      if (p == null) {
        throw new Error(`Provider "${params.provider}" not found`)
      }
      provider = p
    } else {
      provider = params.provider
    }

    this.#params = {
      provider,
      model: params.model,
      host: params.host,
      systemPrompt: params.systemPrompt,
      toolApproval: params.toolApproval ?? AGENT_DEFAULTS.toolApproval,
      maxIterations: params.maxIterations ?? AGENT_DEFAULTS.maxIterations,
      timeout: params.timeout ?? AGENT_DEFAULTS.timeout,
      onEvent: params.onEvent,
    }
  }
```

With:
```typescript
export class AgentSession<T extends ProviderTypes = ProviderTypes> extends Disposer {
  #params: ResolvedAgentParams<T>
  #events: EventEmitter<AgentSessionEvents>

  constructor(params: AgentParams<T>) {
    super()
    this.#events = new EventEmitter()

    const { session } = params

    // Resolve provider from session or use direct instance
    let provider: ModelProvider<T>
    if (typeof params.provider === 'string') {
      provider = session.getProvider<T>(params.provider)
    } else {
      provider = params.provider
    }

    this.#params = {
      session,
      provider,
      model: params.model,
      systemPrompt: params.systemPrompt,
      toolApproval: params.toolApproval ?? AGENT_DEFAULTS.toolApproval,
      maxIterations: params.maxIterations ?? AGENT_DEFAULTS.maxIterations,
      timeout: params.timeout ?? AGENT_DEFAULTS.timeout,
      onEvent: params.onEvent,
    }
  }
```

**Step 2: Update imports at top of file**

Remove `getContextToolInfo` from host import (will use session.executeToolCall instead):
```typescript
import type { ContextTool } from '@mokei/host'
```

Add Session import:
```typescript
import type { Session } from './session.js'
```

Keep other imports as they are (some will be cleaned up in later tasks).

**Step 3: Verify constructor compiles**

Run: `pnpm build:types`
Expected: More errors in stream() and helper methods (expected, will fix next)

---

## Task 3: Update stream() Method - Tool Fetching

**Files:**
- Modify: `packages/session/src/agent-session.ts:130-170`

**Step 1: Update tool fetching to use session**

Find line ~166:
```typescript
// Get tools from host
const tools = host.getCallableTools().map((tool) => provider.toolFromMCP(tool))
```

Replace with:
```typescript
// Get tools from session
const tools = session.getToolsForProvider(provider)
```

**Step 2: Update destructuring at start of stream()**

Find line ~132:
```typescript
const { provider, model, host, systemPrompt, toolApproval, maxIterations, timeout, onEvent } =
  this.#params
```

Replace with:
```typescript
const { session, provider, model, systemPrompt, toolApproval, maxIterations, timeout, onEvent } =
  this.#params
```

**Step 3: Verify stream method compiles**

Run: `pnpm build:types`
Expected: Errors in #findTool and #executeToolCall (expected, will fix next)

---

## Task 4: Update #findTool Method

**Files:**
- Modify: `packages/session/src/agent-session.ts:397-405`

**Step 1: Update #findTool to use session.contextHost**

Replace:
```typescript
#findTool(namespacedName: string) {
  try {
    const [contextKey, toolName] = getContextToolInfo(namespacedName)
    const context = this.#params.host.getContext(contextKey)
    return context.tools.find((t) => t.tool.name === toolName)
  } catch {
    return undefined
  }
}
```

With:
```typescript
#findTool(namespacedName: string) {
  try {
    const [contextKey, toolName] = getContextToolInfo(namespacedName)
    const context = this.#params.session.contextHost.getContext(contextKey)
    return context.tools.find((t) => t.tool.name === toolName)
  } catch {
    return undefined
  }
}
```

**Step 2: Restore getContextToolInfo import**

Make sure this import exists:
```typescript
import { getContextToolInfo } from '@mokei/host'
```

**Step 3: Verify method compiles**

Run: `pnpm build:types`
Expected: Errors in #executeToolCall only

---

## Task 5: Update #executeToolCall Method

**Files:**
- Modify: `packages/session/src/agent-session.ts:491-547`

**Step 1: Replace direct host.callTool with session.executeToolCall**

Replace the entire method:
```typescript
async #executeToolCall(
  toolCall: FunctionToolCall<unknown>,
  emitEvent: (event: AgentEvent) => AgentEvent,
  signal: AbortSignal,
): Promise<{ result?: CallToolResult; error?: Error; events: Array<AgentEvent> }> {
  const events: Array<AgentEvent> = []

  // Emit start event
  const startEvent = emitEvent({
    type: 'tool-call-start',
    toolCall,
    timestamp: Date.now(),
  })
  events.push(startEvent)

  try {
    // Parse tool name to get context and tool
    const [contextKey, toolName] = getContextToolInfo(toolCall.name)
    const args = tryParseJSON(toolCall.arguments)

    // Execute via host
    const request = this.#params.host.callTool(contextKey, { name: toolName, arguments: args })

    // Handle abort
    if (signal.aborted) {
      request.cancel()
      throw new Error('Aborted')
    }
    signal.addEventListener('abort', () => request.cancel(), { once: true })

    const result = await request

    // Emit complete event
    const completeEvent = emitEvent({
      type: 'tool-call-complete',
      toolCall,
      result,
      timestamp: Date.now(),
    })
    events.push(completeEvent)

    return { result, events }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))

    // Emit error event
    const errorEvent = emitEvent({
      type: 'tool-call-error',
      toolCall,
      error: err,
      timestamp: Date.now(),
    })
    events.push(errorEvent)

    return { error: err, events }
  }
}
```

With:
```typescript
async #executeToolCall(
  toolCall: FunctionToolCall<unknown>,
  emitEvent: (event: AgentEvent) => AgentEvent,
  signal: AbortSignal,
): Promise<{ result?: CallToolResult; error?: Error; events: Array<AgentEvent> }> {
  const events: Array<AgentEvent> = []

  // Emit start event
  const startEvent = emitEvent({
    type: 'tool-call-start',
    toolCall,
    timestamp: Date.now(),
  })
  events.push(startEvent)

  try {
    // Execute via session (handles namespaced tool parsing internally)
    const request = this.#params.session.executeToolCall(toolCall, signal)
    const result = await request

    // Emit complete event
    const completeEvent = emitEvent({
      type: 'tool-call-complete',
      toolCall,
      result,
      timestamp: Date.now(),
    })
    events.push(completeEvent)

    return { result, events }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))

    // Emit error event
    const errorEvent = emitEvent({
      type: 'tool-call-error',
      toolCall,
      error: err,
      timestamp: Date.now(),
    })
    events.push(errorEvent)

    return { error: err, events }
  }
}
```

**Step 2: Clean up unused imports**

Remove `tryParseJSON` from imports if no longer used elsewhere in the file:
```typescript
// Remove if not used:
import { tryParseJSON } from '@mokei/model-provider'
```

Remove `getContextToolInfo` import since #findTool still uses it, keep it.

**Step 3: Verify implementation compiles**

Run: `pnpm build:types`
Expected: SUCCESS (no type errors)

**Step 4: Commit checkpoint**

```bash
git add packages/session/src/agent-types.ts packages/session/src/agent-session.ts
git commit -m "refactor(session): AgentSession accepts Session instead of host+providers

BREAKING CHANGE: AgentSession constructor signature changed
- Requires `session: Session` parameter
- Removed second `providers` argument
- Provider lookup uses session.getProvider()
- Tool execution uses session.executeToolCall()"
```

---

## Task 6: Create Test Helper Function

**Files:**
- Modify: `packages/session/test/agent-session.test.ts:146-221`

**Step 1: Add Session import**

At top of test file, update imports:
```typescript
import { AGENT_DEFAULTS, type AgentEvent, AgentSession, Session } from '../src/index.js'
```

**Step 2: Create helper to build Session with mock tools**

Add this helper function after `createMockProvider`:

```typescript
// Create a Session with a mock context for testing
async function createMockSessionWithTools(
  tools: Array<{ name: string; description: string; result: CallToolResult }>,
  providers?: Record<string, ModelProvider<MockProviderTypes>>,
): Promise<Session<MockProviderTypes>> {
  const session = new Session<MockProviderTypes>({ providers })

  // Create a mock server transport pair
  const transports = new DirectTransports<ServerMessage, ClientMessage>()

  // Set up a simple server that handles initialize and tool calls
  const serverLoop = async () => {
    const transport = transports.server

    // Handle initialize
    const initReq = await transport.read()
    if (!initReq.done) {
      transport.write({
        jsonrpc: '2.0',
        id: (initReq.value as { id: number }).id,
        result: {
          capabilities: { tools: {} },
          protocolVersion: LATEST_PROTOCOL_VERSION,
          serverInfo: { name: 'MockServer', version: '1.0.0' },
        },
      })

      // Wait for initialized notification
      await transport.read()

      // Handle tools/list
      const toolsReq = await transport.read()
      if (!toolsReq.done) {
        transport.write({
          jsonrpc: '2.0',
          id: (toolsReq.value as { id: number }).id,
          result: {
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: { type: 'object' },
            })),
          },
        })
      }

      // Handle tool calls
      while (true) {
        const req = await transport.read()
        if (req.done) break

        const request = req.value as { id: number; method: string; params?: { name: string } }
        if (request.method === 'tools/call') {
          const tool = tools.find((t) => t.name === request.params?.name)
          transport.write({
            jsonrpc: '2.0',
            id: request.id,
            result: tool?.result ?? { content: [{ type: 'text', text: 'Unknown tool' }] },
          })
        }
      }
    }
  }

  // Start server in background
  serverLoop().catch(() => {})

  // Add the context using session's contextHost
  session.contextHost.createContext({
    key: 'mock',
    transport: transports.client,
  })

  // Initialize and setup
  await session.contextHost.setup('mock')

  return session
}
```

**Step 3: Remove old createMockHostWithTools function**

Delete the function `createMockHostWithTools` (lines 146-221) - it's replaced by `createMockSessionWithTools`.

**Step 4: Verify test file compiles**

Run: `pnpm test:types`
Expected: Type errors in test cases (expected, will fix in next tasks)

---

## Task 7: Update Constructor Tests

**Files:**
- Modify: `packages/session/test/agent-session.test.ts:223-267`

**Step 1: Update 'applies default values' test**

Replace:
```typescript
test('applies default values', () => {
  const provider = createMockProvider([{ text: 'Hello' }])
  const host = new ContextHost()

  const agent = new AgentSession({
    provider,
    model: 'test-model',
    host,
  })

  expect(agent).toBeInstanceOf(AgentSession)
})
```

With:
```typescript
test('applies default values', () => {
  const provider = createMockProvider([{ text: 'Hello' }])
  const session = new Session({ providers: { test: provider } })

  const agent = new AgentSession({
    session,
    provider,
    model: 'test-model',
  })

  expect(agent).toBeInstanceOf(AgentSession)
})
```

**Step 2: Update 'throws if string provider not found' test**

Replace:
```typescript
test('throws if string provider not found', () => {
  const host = new ContextHost()

  expect(
    () =>
      new AgentSession({
        provider: 'nonexistent',
        model: 'test-model',
        host,
      }),
  ).toThrow('Provider "nonexistent" not found')
})
```

With:
```typescript
test('throws if string provider not found', () => {
  const session = new Session()

  expect(
    () =>
      new AgentSession({
        session,
        provider: 'nonexistent',
        model: 'test-model',
      }),
  ).toThrow('Provider with key nonexistent does not exist')
})
```

Note: The error message changes because Session.getProvider() has different message format.

**Step 3: Update 'accepts provider from providers map' test**

Replace:
```typescript
test('accepts provider from providers map', () => {
  const provider = createMockProvider([{ text: 'Hello' }])
  const host = new ContextHost()
  const providers = new Map([['test', provider]])

  const agent = new AgentSession(
    {
      provider: 'test',
      model: 'test-model',
      host,
    },
    providers,
  )

  expect(agent).toBeInstanceOf(AgentSession)
})
```

With:
```typescript
test('accepts provider from session.providers', () => {
  const provider = createMockProvider([{ text: 'Hello' }])
  const session = new Session({ providers: { test: provider } })

  const agent = new AgentSession({
    session,
    provider: 'test',
    model: 'test-model',
  })

  expect(agent).toBeInstanceOf(AgentSession)
})
```

**Step 4: Run tests to verify constructor tests pass**

Run: `pnpm test:unit -- --grep "constructor"`
Expected: All 3 constructor tests PASS

---

## Task 8: Update run() Tests

**Files:**
- Modify: `packages/session/test/agent-session.test.ts:269-348`

**Step 1: Update 'completes simple prompt' test**

Replace:
```typescript
test('completes simple prompt without tools in 1 iteration', async () => {
  const provider = createMockProvider([
    { text: 'Hello, world!', inputTokens: 5, outputTokens: 3 },
  ])
  const host = new ContextHost()

  const agent = new AgentSession({
    provider,
    model: 'test-model',
    host,
  })

  const result = await agent.run('Say hello')
  // ... assertions
})
```

With:
```typescript
test('completes simple prompt without tools in 1 iteration', async () => {
  const provider = createMockProvider([
    { text: 'Hello, world!', inputTokens: 5, outputTokens: 3 },
  ])
  const session = new Session({ providers: { test: provider } })

  const agent = new AgentSession({
    session,
    provider,
    model: 'test-model',
  })

  const result = await agent.run('Say hello')
  // ... assertions unchanged
})
```

**Step 2: Update 'respects maxIterations limit' test**

Replace `host` creation:
```typescript
const host = await createMockHostWithTools([...])
```

With:
```typescript
const session = await createMockSessionWithTools([...])
```

And update AgentSession constructor:
```typescript
const agent = new AgentSession({
  session,
  provider,
  model: 'test-model',
  maxIterations: 2,
  toolApproval: 'auto',
})
```

Change cleanup from `await host.dispose()` to `await session.dispose()`.

**Step 3: Update 'handles abort signal' test**

Replace:
```typescript
const host = new ContextHost()
// ...
const agent = new AgentSession({
  provider,
  model: 'test-model',
  host,
})
```

With:
```typescript
const session = new Session({ providers: { test: provider } })
// ...
const agent = new AgentSession({
  session,
  provider,
  model: 'test-model',
})
```

**Step 4: Run run() tests**

Run: `pnpm test:unit -- --grep "run()"`
Expected: All run() tests PASS

---

## Task 9: Update stream() Tests

**Files:**
- Modify: `packages/session/test/agent-session.test.ts:350-408`

**Step 1: Update 'yields correct event sequence' test**

Replace host/AgentSession creation with session pattern:
```typescript
const provider = createMockProvider([{ text: 'Hi!', inputTokens: 5, outputTokens: 2 }])
const session = new Session({ providers: { test: provider } })

const agent = new AgentSession({
  session,
  provider,
  model: 'test-model',
})
```

**Step 2: Update 'emits onEvent callback' test**

Same pattern - replace `host` with `session`.

**Step 3: Run stream() tests**

Run: `pnpm test:unit -- --grep "stream()"`
Expected: All stream() tests PASS

---

## Task 10: Update Tool Approval Tests

**Files:**
- Modify: `packages/session/test/agent-session.test.ts:410-568`

This section has many tests. Apply the same pattern to all:

**Pattern to apply:**

1. Replace `const host = await createMockHostWithTools([...])` with `const session = await createMockSessionWithTools([...])`

2. Replace AgentSession constructor:
   ```typescript
   // Before
   const agent = new AgentSession({
     provider,
     model: 'test-model',
     host,
     toolApproval: 'auto',
   })
   
   // After
   const agent = new AgentSession({
     session,
     provider,
     model: 'test-model',
     toolApproval: 'auto',
   })
   ```

3. Replace `await host.dispose()` with `await session.dispose()`

**Tests to update:**
- `'auto' executes all tools without prompting`
- `'never' skips all tool execution`
- `custom function is called with correct context`
- `custom function can deny with reason`

**Step: Run all tool approval tests**

Run: `pnpm test:unit -- --grep "tool approval"`
Expected: All tool approval tests PASS

---

## Task 11: Update Events Emitter and Defaults Tests

**Files:**
- Modify: `packages/session/test/agent-session.test.ts:570-598`

**Step 1: Update events emitter test**

Replace:
```typescript
const host = new ContextHost()
const agent = new AgentSession({
  provider,
  model: 'test-model',
  host,
})
```

With:
```typescript
const session = new Session({ providers: { test: provider } })
const agent = new AgentSession({
  session,
  provider,
  model: 'test-model',
})
```

**Step 2: AGENT_DEFAULTS test needs no changes**

This test just checks constant values.

**Step 3: Run these tests**

Run: `pnpm test:unit -- --grep "events emitter|AGENT_DEFAULTS"`
Expected: PASS

---

## Task 12: Update Real-World Scenario Tests (Part 1)

**Files:**
- Modify: `packages/session/test/agent-session.test.ts:601-726`

Apply the session pattern to all tests in:
- `multi-step task execution`
- `handles multiple tool calls in single response`

**Pattern (same as Task 10):**
1. `createMockHostWithTools` → `createMockSessionWithTools`
2. Update AgentSession constructor to use `session`
3. `host.dispose()` → `session.dispose()`

**Step: Run multi-step tests**

Run: `pnpm test:unit -- --grep "multi-step"`
Expected: PASS

---

## Task 13: Update Real-World Scenario Tests (Part 2)

**Files:**
- Modify: `packages/session/test/agent-session.test.ts:728-811`

Update all tests in:
- `error handling`

Apply the same pattern.

**Step: Run error handling tests**

Run: `pnpm test:unit -- --grep "error handling"`
Expected: PASS

---

## Task 14: Update Real-World Scenario Tests (Part 3)

**Files:**
- Modify: `packages/session/test/agent-session.test.ts:813-906`

Update all tests in:
- `system prompt`
- `token tracking`

For simple tests (no MCP tools), use:
```typescript
const session = new Session({ providers: { test: provider } })
```

For tests with tools, use:
```typescript
const session = await createMockSessionWithTools([...])
```

**Step: Run these tests**

Run: `pnpm test:unit -- --grep "system prompt|token tracking"`
Expected: PASS

---

## Task 15: Update Real-World Scenario Tests (Part 4)

**Files:**
- Modify: `packages/session/test/agent-session.test.ts:908-1024`

Update all tests in:
- `mixed approval scenarios`

**Step: Run mixed approval tests**

Run: `pnpm test:unit -- --grep "mixed approval"`
Expected: PASS

---

## Task 16: Update Remaining Tests

**Files:**
- Modify: `packages/session/test/agent-session.test.ts:1026-1341`

Update all remaining tests:
- `duration tracking`
- `event timestamps`
- `edge cases`
- `conversation context`
- `tool result content types`
- `iteration behavior`

**Step: Run all remaining tests**

Run: `pnpm test:unit`
Expected: ALL TESTS PASS

**Step: Commit test updates**

```bash
git add packages/session/test/agent-session.test.ts
git commit -m "test(session): update AgentSession tests to use Session

- Replace createMockHostWithTools with createMockSessionWithTools
- Update all test cases to pass Session instead of ContextHost
- Update expected error message for provider not found"
```

---

## Task 17: Remove ContextHost Import from Test File

**Files:**
- Modify: `packages/session/test/agent-session.test.ts`

**Step 1: Remove unused import**

Find:
```typescript
import { ContextHost } from '@mokei/host'
```

Remove this line (ContextHost is no longer directly used in tests).

**Step 2: Verify no remaining ContextHost usage**

Search for `ContextHost` in the test file - should be zero occurrences.

**Step 3: Run full test suite**

Run: `pnpm test`
Expected: ALL PASS

---

## Task 18: Update Package Exports (if needed)

**Files:**
- Review: `packages/session/src/index.ts`

**Step 1: Verify Session is exported**

The index.ts should already export Session via `export * from './session.js'`.

Verify these exports exist:
- `Session`
- `AgentSession`
- `AgentParams`
- `ResolvedAgentParams`

**Step 2: No changes needed if exports are correct**

---

## Task 19: Run Full Build and Test

**Step 1: Clean build**

```bash
pnpm build
```

Expected: SUCCESS

**Step 2: Run all tests**

```bash
pnpm test
```

Expected: ALL PASS

**Step 3: Run linter**

```bash
pnpm lint
```

Expected: No errors

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore(session): clean up after AgentSession refactoring"
```

---

## Task 20: Update Integration Tests (if any)

**Files:**
- Check: `integration-tests/suites/session.test.ts` (if exists)

**Step 1: Check for integration tests using AgentSession**

```bash
grep -r "AgentSession" integration-tests/
```

If found, update them with the same pattern used in unit tests.

**Step 2: Run integration tests**

```bash
pnpm --filter integration-tests test
```

Expected: PASS

---

## Summary Checklist

- [ ] Task 1: Update AgentParams type definition
- [ ] Task 2: Update AgentSession constructor
- [ ] Task 3: Update stream() tool fetching
- [ ] Task 4: Update #findTool method
- [ ] Task 5: Update #executeToolCall method
- [ ] Task 6: Create test helper function
- [ ] Task 7: Update constructor tests
- [ ] Task 8: Update run() tests
- [ ] Task 9: Update stream() tests
- [ ] Task 10: Update tool approval tests
- [ ] Task 11: Update events emitter tests
- [ ] Task 12: Update real-world tests (Part 1)
- [ ] Task 13: Update real-world tests (Part 2)
- [ ] Task 14: Update real-world tests (Part 3)
- [ ] Task 15: Update real-world tests (Part 4)
- [ ] Task 16: Update remaining tests
- [ ] Task 17: Clean up imports
- [ ] Task 18: Verify exports
- [ ] Task 19: Full build and test
- [ ] Task 20: Update integration tests

---

## Migration Guide (for CHANGELOG)

### Breaking Changes

**AgentSession constructor signature changed:**

Before:
```typescript
import { AgentSession } from '@mokei/session'
import { ContextHost } from '@mokei/host'

const host = new ContextHost()
const agent = new AgentSession({
  provider: myProvider,
  model: 'gpt-4',
  host,
})
```

After:
```typescript
import { AgentSession, Session } from '@mokei/session'

const session = new Session({ providers: { openai: myProvider } })
const agent = new AgentSession({
  session,
  provider: 'openai',  // or myProvider directly
  model: 'gpt-4',
})
```

**Benefits:**
- Single Session instance manages all resources
- Provider lookup uses session's provider registry
- Tool execution delegated to session
- Cleaner separation of concerns
