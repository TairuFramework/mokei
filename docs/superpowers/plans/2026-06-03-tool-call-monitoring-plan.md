# Tool-Call Monitoring (hang / error / timeout / cancel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Ink chat UI monitor in-flight tool calls — show elapsed time, warn when stuck, enforce a per-tool timeout, allow the user to cancel the active tool call (contextual Esc), and present errors as a single line with full detail on demand (`/details`).

**Architecture:** Two layers. (1) `@mokei/session`: `AgentSession` wraps each sequential tool execution in a per-call `AbortController` with a timeout timer, exposes `cancelToolCall()`, and emits `ToolCallTimeoutError` / `ToolCallCancelledError` through the existing `tool-call-error` event (no new event type). (2) `packages/cli`: the turn reducer tracks the single active call + its start time; a `useElapsed` ticking hook drives a live elapsed/hang display; components render single-line errors; `ChatApp` wires contextual Esc and a `/details` command.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Ink v5, `@inkjs/ui`, React 18, vitest, ink-testing-library, `@mokei/session`.

**Spec reference:** `docs/superpowers/specs/2026-06-03-tool-call-monitoring-design.md`.

---

## Conventions

- Commit cadence: one commit per task. Phase 1 prefix `feat(session): `, Phases 2-3 prefix `feat(cli-ink): `.
- Follow `docs/agents/conventions.md`: `type` not `interface`, `Array<T>` not `T[]`, `ID` not `Id`, no `any`.
- After any change affecting package types, run `pnpm --filter <pkg> test:types`.
- Session tests: `pnpm --filter @mokei/session test -- --run`. CLI tests: `pnpm --filter mokei test:unit`.

## File Structure

**Layer 1 — `@mokei/session`:**
- `packages/session/src/agent-types.ts` — add `toolTimeout` to params/resolved/defaults.
- `packages/session/src/errors.ts` (new) — `ToolCallTimeoutError`, `ToolCallCancelledError`.
- `packages/session/src/index.ts` — re-export the new errors module.
- `packages/session/src/agent-session.ts` — per-call controller, `cancelToolCall()`, catch discrimination.
- `packages/session/test/agent-session.test.ts` — `delayMs` helper option + timeout/cancel/turn-abort tests.

**Layer 2 — `packages/cli`:**
- `packages/cli/src/chat/turn-reducer.ts` — `activeToolCall` field.
- `packages/cli/src/chat/hooks/useElapsed.ts` (new) — ticking clock.
- `packages/cli/src/chat/hooks/useAgentTurn.ts` — agent ref + `cancelTool()`.
- `packages/cli/src/chat/components/ToolCallStatus.tsx` — elapsed + hang warning.
- `packages/cli/src/chat/components/PendingTurn.tsx` — wire elapsed.
- `packages/cli/src/chat/components/ToolResultCard.tsx` — single-line error + outcome + duration.
- `packages/cli/src/chat/components/HelpCard.tsx` — `/details` line, Esc wording.
- `packages/cli/src/chat/ChatApp.tsx` — duration tracking, outcome mapping, `lastErrorDetailRef`, `/details`, contextual Esc.
- Tests under `packages/cli/test/chat/`.

---

## Phase 1 — `@mokei/session`: per-tool timeout + cancellation

### Task 1: Error classes + `toolTimeout` param/default

**Files:**
- Create: `packages/session/src/errors.ts`
- Modify: `packages/session/src/index.ts`
- Modify: `packages/session/src/agent-types.ts`
- Modify: `packages/session/src/agent-session.ts` (resolve default)

- [ ] **Step 1: Create the error module**

Create `packages/session/src/errors.ts`:

```ts
/** Thrown internally when a single tool call exceeds the per-tool timeout. */
export class ToolCallTimeoutError extends Error {
  readonly timeoutMs: number

  constructor(toolName: string, timeoutMs: number) {
    super(`tool "${toolName}" timed out after ${timeoutMs}ms`)
    this.name = 'ToolCallTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

/** Thrown internally when the user cancels the active tool call. */
export class ToolCallCancelledError extends Error {
  constructor(toolName: string) {
    super(`tool "${toolName}" cancelled by user`)
    this.name = 'ToolCallCancelledError'
  }
}
```

- [ ] **Step 2: Re-export from the package entry**

In `packages/session/src/index.ts`, add after the existing `export *` lines:

```ts
export * from './errors.js'
```

- [ ] **Step 3: Add `toolTimeout` to params, resolved params, and defaults**

In `packages/session/src/agent-types.ts`, in `AgentParams` (after the `timeout?: number` line around line 65):

```ts
  /** Timeout in milliseconds (default: 300000 = 5 minutes) */
  timeout?: number
  /** Per-tool-call timeout in milliseconds (default: 120000 = 2 minutes) */
  toolTimeout?: number
```

In `ResolvedAgentParams` (after `timeout: number` around line 81):

```ts
  timeout: number
  toolTimeout: number
```

In `AGENT_DEFAULTS` (around line 290):

```ts
export const AGENT_DEFAULTS = {
  maxIterations: 10,
  timeout: 5 * 60 * 1000, // 5 minutes
  toolTimeout: 2 * 60 * 1000, // 2 minutes
  toolApproval: 'auto' as const,
} as const
```

- [ ] **Step 4: Resolve the default in the constructor**

In `packages/session/src/agent-session.ts`, in the `this.#params = {` block (around line 81):

```ts
      timeout: params.timeout ?? AGENT_DEFAULTS.timeout,
      toolTimeout: params.toolTimeout ?? AGENT_DEFAULTS.toolTimeout,
```

- [ ] **Step 5: Type-check**

Run: `pnpm --filter @mokei/session test:types`
Expected: PASS (additive only).

- [ ] **Step 6: Commit**

```bash
git add packages/session/src/errors.ts packages/session/src/index.ts packages/session/src/agent-types.ts packages/session/src/agent-session.ts
git commit -m "feat(session): add toolTimeout param and tool-call error classes"
```

---

### Task 2: Per-call controller, `cancelToolCall()`, catch discrimination

**Files:**
- Modify: `packages/session/src/agent-session.ts`

Verified mechanism: `Session.executeToolCall(call, signal)` registers `signal.addEventListener('abort', () => request.cancel())`, and `request.cancel()` → `controller.reject(new Error('Cancelled'))` (context-rpc). So aborting a per-call controller rejects the awaited tool promise. The turn-level `signal` already passed into `#executeToolCall` is the combined `anySignal([userSignal, timeoutController.signal])`. `anySignal` is a module-private helper in this same file — reuse it directly.

- [ ] **Step 1: Add module sentinels near the top of the file**

In `packages/session/src/agent-session.ts`, add after the imports (top-level, before the class), and import the error classes:

```ts
import { ToolCallCancelledError, ToolCallTimeoutError } from './errors.js'

/** Abort reason set when the per-tool timeout timer fires. */
const TOOL_TIMEOUT_REASON = Symbol('mokei.tool-timeout')
/** Abort reason set when the user cancels the active tool call. */
const TOOL_CANCEL_REASON = Symbol('mokei.tool-cancel')
```

- [ ] **Step 2: Add the active-controller field**

In the class body, next to `#params` / `#events` (around line 59):

```ts
  #params: ResolvedAgentParams<T>
  #events: EventEmitter<AgentSessionEvents<T>>
  #activeToolController: AbortController | null = null
```

- [ ] **Step 3: Add the public `cancelToolCall` method**

Add this method to the class (e.g. just after the `events` getter, around line 90):

```ts
  /**
   * Cancel the tool call currently being executed, if any. The current turn
   * continues with the remaining tool calls / iterations. No-op when idle.
   */
  cancelToolCall(): void {
    this.#activeToolController?.abort(TOOL_CANCEL_REASON)
  }
```

- [ ] **Step 4: Rewrite `#executeToolCall` to wrap the call**

Replace the entire current `#executeToolCall` method (around lines 499-543) with:

```ts
  async #executeToolCall(
    toolCall: FunctionToolCall<unknown>,
    emitEvent: (event: AgentEvent<T>) => AgentEvent<T>,
    signal: AbortSignal,
  ): Promise<{ result?: CallToolResult; error?: Error; events: Array<AgentEvent<T>> }> {
    const events: Array<AgentEvent<T>> = []

    // Emit start event
    const startEvent = emitEvent({
      type: 'tool-call-start',
      toolCall,
      timestamp: Date.now(),
    })
    events.push(startEvent)

    // Per-call controller: fires on timeout or user cancel, independent of the turn.
    const callController = new AbortController()
    this.#activeToolController = callController
    const callTimer = setTimeout(() => {
      callController.abort(TOOL_TIMEOUT_REASON)
    }, this.#params.toolTimeout)
    const callSignal = anySignal([signal, callController.signal])

    try {
      // Execute via session (handles namespaced tool parsing internally)
      const result = await this.#params.session.executeToolCall(toolCall, callSignal)

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
      // Discriminate why the call ended. The turn-level signal taking priority
      // preserves user-abort / turn-timeout semantics (turn ends elsewhere).
      let err: Error
      if (signal.aborted) {
        err = error instanceof Error ? error : new Error(String(error))
      } else if (callController.signal.reason === TOOL_TIMEOUT_REASON) {
        err = new ToolCallTimeoutError(toolCall.name, this.#params.toolTimeout)
      } else if (callController.signal.reason === TOOL_CANCEL_REASON) {
        err = new ToolCallCancelledError(toolCall.name)
      } else {
        err = error instanceof Error ? error : new Error(String(error))
      }

      // Emit error event
      const errorEvent = emitEvent({
        type: 'tool-call-error',
        toolCall,
        error: err,
        timestamp: Date.now(),
      })
      events.push(errorEvent)

      return { error: err, events }
    } finally {
      clearTimeout(callTimer)
      this.#activeToolController = null
    }
  }
```

- [ ] **Step 5: Type-check**

Run: `pnpm --filter @mokei/session test:types`
Expected: PASS.

- [ ] **Step 6: Run existing session tests (regression)**

Run: `pnpm --filter @mokei/session test -- --run`
Expected: PASS (existing tool-call tests unaffected — happy path unchanged; the tool message recording in the loop already uses `execResult.error`).

- [ ] **Step 7: Commit**

```bash
git add packages/session/src/agent-session.ts
git commit -m "feat(session): per-tool timeout + cancelToolCall via per-call AbortController"
```

---

### Task 3: Session tests — timeout, cancel, turn-abort

**Files:**
- Modify: `packages/session/test/agent-session.test.ts`

The existing `createMockSessionWithTools` server responds to `tools/call` synchronously. Add an optional per-tool `delayMs` so a tool can stall long enough for the timeout / cancel to fire.

- [ ] **Step 1: Add `delayMs` to the mock tool server**

In `packages/session/test/agent-session.test.ts`, update the `createMockSessionWithTools` signature and the `tools/call` handler.

Change the parameter type:

```ts
async function createMockSessionWithTools(
  tools: Array<{
    name: string
    description: string
    result: CallToolResult
    delayMs?: number
  }>,
  providers?: Record<string, ModelProvider<MockProviderTypes>>,
): Promise<Session<MockProviderTypes>> {
```

Replace the `tools/call` branch inside the `while (true)` loop:

```ts
        if (request.method === 'tools/call') {
          const tool = tools.find((t) => t.name === request.params?.name)
          if (tool?.delayMs != null) {
            const timer = setTimeout(() => {
              transport.write({
                jsonrpc: '2.0',
                id: request.id,
                result: tool.result,
              })
            }, tool.delayMs)
            // Allow the process to exit even if a stalled response is still pending.
            ;(timer as { unref?: () => void }).unref?.()
          } else {
            transport.write({
              jsonrpc: '2.0',
              id: request.id,
              result: tool?.result ?? { content: [{ type: 'text', text: 'Unknown tool' }] },
            })
          }
        }
```

- [ ] **Step 2: Write failing tests**

Append a new `describe` block at the end of the outer describe in `packages/session/test/agent-session.test.ts`:

```ts
describe('per-tool timeout and cancellation', () => {
  const toolCall: FunctionToolCall<unknown> = {
    id: 'call-1',
    name: 'mock:slow',
    arguments: '{}',
  }

  test('a tool exceeding toolTimeout yields ToolCallTimeoutError and the turn survives', async () => {
    const provider = createMockProvider([{ toolCalls: [toolCall] }, { text: 'Recovered' }])
    const session = await createMockSessionWithTools(
      [
        {
          name: 'slow',
          description: 'never returns in time',
          result: { content: [{ type: 'text', text: 'late' }] },
          delayMs: 1000,
        },
      ],
      { mock: provider },
    )
    const agent = new AgentSession({
      session,
      provider: 'mock',
      model: 'test-model',
      toolTimeout: 50,
    })

    const events: Array<AgentEvent> = []
    for await (const event of agent.stream('go')) {
      events.push(event)
    }

    const errorEvent = events.find((e) => e.type === 'tool-call-error')
    expect(errorEvent).toBeDefined()
    expect((errorEvent as { error: Error }).error.name).toBe('ToolCallTimeoutError')
    // Turn continued to a second iteration and finished.
    expect(events.some((e) => e.type === 'complete')).toBe(true)
  })

  test('cancelToolCall during execution yields ToolCallCancelledError and the turn survives', async () => {
    const provider = createMockProvider([{ toolCalls: [toolCall] }, { text: 'After cancel' }])
    const session = await createMockSessionWithTools(
      [
        {
          name: 'slow',
          description: 'stalls until cancelled',
          result: { content: [{ type: 'text', text: 'late' }] },
          delayMs: 1000,
        },
      ],
      { mock: provider },
    )
    const agent = new AgentSession({
      session,
      provider: 'mock',
      model: 'test-model',
      toolTimeout: 5000,
    })

    const events: Array<AgentEvent> = []
    for await (const event of agent.stream('go')) {
      events.push(event)
      if (event.type === 'tool-call-start') {
        agent.cancelToolCall()
      }
    }

    const errorEvent = events.find((e) => e.type === 'tool-call-error')
    expect(errorEvent).toBeDefined()
    expect((errorEvent as { error: Error }).error.name).toBe('ToolCallCancelledError')
    expect(events.some((e) => e.type === 'complete')).toBe(true)
  })

  test('a turn-level abort during a tool call does not produce a timeout/cancel error', async () => {
    const provider = createMockProvider([{ toolCalls: [toolCall] }, { text: 'unreached' }])
    const session = await createMockSessionWithTools(
      [
        {
          name: 'slow',
          description: 'stalls',
          result: { content: [{ type: 'text', text: 'late' }] },
          delayMs: 1000,
        },
      ],
      { mock: provider },
    )
    const agent = new AgentSession({
      session,
      provider: 'mock',
      model: 'test-model',
      toolTimeout: 5000,
    })

    const controller = new AbortController()
    const events: Array<AgentEvent> = []
    for await (const event of agent.stream('go', { signal: controller.signal })) {
      events.push(event)
      if (event.type === 'tool-call-start') {
        controller.abort()
      }
    }

    const errorEvent = events.find((e) => e.type === 'tool-call-error')
    expect(errorEvent).toBeDefined()
    const name = (errorEvent as { error: Error }).error.name
    expect(name).not.toBe('ToolCallTimeoutError')
    expect(name).not.toBe('ToolCallCancelledError')
  })
})
```

- [ ] **Step 3: Run tests; expect PASS**

Run: `pnpm --filter @mokei/session test -- --run`
Expected: all three new tests PASS, no regressions.

- [ ] **Step 4: Commit**

```bash
git add packages/session/test/agent-session.test.ts
git commit -m "test(session): cover per-tool timeout, cancellation, and turn-abort"
```

---

## Phase 2 — `packages/cli`: reducer + hooks

### Task 4: Reducer tracks the active tool call + start time

**Files:**
- Modify: `packages/cli/src/chat/turn-reducer.ts`
- Modify: `packages/cli/test/chat/turn-reducer.test.ts`

- [ ] **Step 1: Add failing reducer tests**

Append to the `describe('turnReducer', ...)` block in `packages/cli/test/chat/turn-reducer.test.ts`:

```ts
  test('tool-call-start records activeToolCall with startedAt', () => {
    const s = apply([
      { type: 'start', prompt: 'hi', timestamp: 0 },
      {
        type: 'tool-call-start',
        toolCall: { id: '1', name: 'ns:tool', arguments: '{}' },
        timestamp: 42,
      },
    ])
    expect(s.state).toBe('calling-tool')
    expect(s.activeToolCall).toEqual({
      call: { id: '1', name: 'ns:tool', arguments: '{}' },
      startedAt: 42,
    })
  })

  test('tool-call-complete clears activeToolCall', () => {
    const s = apply([
      { type: 'start', prompt: 'hi', timestamp: 0 },
      {
        type: 'tool-call-start',
        toolCall: { id: '1', name: 'ns:tool', arguments: '{}' },
        timestamp: 1,
      },
      {
        type: 'tool-call-complete',
        toolCall: { id: '1', name: 'ns:tool', arguments: '{}' },
        result: { content: [] },
        timestamp: 2,
      },
    ])
    expect(s.activeToolCall).toBeNull()
    expect(s.state).toBe('streaming')
  })

  test('tool-call-error clears activeToolCall', () => {
    const s = apply([
      { type: 'start', prompt: 'hi', timestamp: 0 },
      {
        type: 'tool-call-start',
        toolCall: { id: '1', name: 'ns:tool', arguments: '{}' },
        timestamp: 1,
      },
      {
        type: 'tool-call-error',
        toolCall: { id: '1', name: 'ns:tool', arguments: '{}' },
        error: new Error('boom'),
        timestamp: 2,
      },
    ])
    expect(s.activeToolCall).toBeNull()
    expect(s.state).toBe('streaming')
  })
```

- [ ] **Step 2: Run tests; expect FAIL**

Run: `pnpm --filter mokei test:unit -- turn-reducer`
Expected: FAIL — `activeToolCall` does not exist on `TurnState`.

- [ ] **Step 3: Add `activeToolCall` to the reducer**

In `packages/cli/src/chat/turn-reducer.ts`:

Add the field to `TurnState` (after `pendingCall`):

```ts
  pendingCall: FunctionToolCall<unknown> | null
  activeToolCall: { call: FunctionToolCall<unknown>; startedAt: number } | null
```

Add to `initialTurnState` (after `pendingCall: null,`):

```ts
    pendingCall: null,
    activeToolCall: null,
```

Update the relevant cases in `turnReducer`:

```ts
    case 'tool-call-approved':
      return {
        ...state,
        state: 'calling-tool',
        pendingCall: null,
        activeToolCall: { call: event.toolCall, startedAt: event.timestamp },
      }
    case 'tool-call-denied':
      return { ...state, state: 'streaming', pendingCall: null, activeToolCall: null }
    case 'tool-call-start':
      return {
        ...state,
        state: 'calling-tool',
        pendingCall: event.toolCall,
        activeToolCall: { call: event.toolCall, startedAt: event.timestamp },
      }
    case 'tool-call-complete':
    case 'tool-call-error':
      return { ...state, state: 'streaming', pendingCall: null, activeToolCall: null }
```

- [ ] **Step 4: Run tests; expect PASS**

Run: `pnpm --filter mokei test:unit -- turn-reducer`
Expected: PASS (new + existing reducer tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/chat/turn-reducer.ts packages/cli/test/chat/turn-reducer.test.ts
git commit -m "feat(cli-ink): reducer tracks active tool call with start time"
```

---

### Task 5: `useElapsed` ticking hook

**Files:**
- Create: `packages/cli/src/chat/hooks/useElapsed.ts`
- Create: `packages/cli/test/chat/useElapsed.test.tsx`

- [ ] **Step 1: Write failing test**

Create `packages/cli/test/chat/useElapsed.test.tsx`:

```tsx
import { render } from 'ink-testing-library'
import React, { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { useElapsed } from '../../src/chat/hooks/useElapsed.js'

function Harness({ active, onTick }: { active: boolean; onTick: (now: number) => void }) {
  const now = useElapsed(active)
  useEffect(() => {
    onTick(now)
  }, [now, onTick])
  return null
}

describe('useElapsed', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('emits new values while active', () => {
    const ticks: Array<number> = []
    render(<Harness active onTick={(n) => ticks.push(n)} />)
    const initialCount = ticks.length
    vi.advanceTimersByTime(3000)
    expect(ticks.length).toBeGreaterThan(initialCount)
  })

  test('does not tick while inactive', () => {
    const ticks: Array<number> = []
    render(<Harness active={false} onTick={(n) => ticks.push(n)} />)
    const initialCount = ticks.length
    vi.advanceTimersByTime(3000)
    expect(ticks.length).toBe(initialCount)
  })
})
```

- [ ] **Step 2: Run test; expect FAIL**

Run: `pnpm --filter mokei test:unit -- useElapsed`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `packages/cli/src/chat/hooks/useElapsed.ts`:

```ts
import { useEffect, useState } from 'react'

/**
 * Returns a millisecond timestamp that updates once per second while `active`.
 * Used to drive an elapsed-time display when no other events fire (e.g. a tool
 * call that hangs). Returns a stable timestamp when inactive.
 */
export function useElapsed(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) {
      return
    }
    setNow(Date.now())
    const interval = setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => {
      clearInterval(interval)
    }
  }, [active])

  return now
}
```

- [ ] **Step 4: Run tests; expect PASS**

Run: `pnpm --filter mokei test:unit -- useElapsed`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/chat/hooks/useElapsed.ts packages/cli/test/chat/useElapsed.test.tsx
git commit -m "feat(cli-ink): useElapsed ticking clock hook"
```

---

### Task 6: `useAgentTurn` exposes `cancelTool()`

**Files:**
- Modify: `packages/cli/src/chat/hooks/useAgentTurn.ts`
- Modify: `packages/cli/test/chat/useAgentTurn.test.tsx`

- [ ] **Step 1: Write failing test**

Append to the `describe('useAgentTurn', ...)` block in `packages/cli/test/chat/useAgentTurn.test.tsx`:

```tsx
  test('cancelTool calls the agent cancelToolCall while the turn is open', async () => {
    const cancelToolCall = vi.fn()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const agent: AgentSessionLike & { cancelToolCall: () => void } = {
      async *stream() {
        yield { type: 'start', prompt: 'hi', timestamp: 0 } as never
        yield {
          type: 'tool-call-start',
          toolCall: { id: '1', name: 'ns:tool', arguments: '{}' },
          timestamp: 1,
        } as never
        // Hold the turn open so agentRef is still set when we cancel.
        await gate
      },
      cancelToolCall,
    }

    let api!: ReturnType<typeof useAgentTurn>
    render(
      <Harness
        agent={agent}
        onState={(s) => {
          api = s
        }}
      />,
    )

    // Kick off the turn without awaiting; let the generator reach `await gate`.
    const submitPromise = api.submit('hi')
    await new Promise((resolve) => setTimeout(resolve))

    api.cancelTool()
    expect(cancelToolCall).toHaveBeenCalledTimes(1)

    release()
    await submitPromise
  })
```

(The existing `Harness` and `mockAgent` helpers in this file already provide `agent` and `onState` plumbing; `cancelTool` is a stable callback, so calling it on any captured `api` snapshot works.)

- [ ] **Step 2: Run test; expect FAIL**

Run: `pnpm --filter mokei test:unit -- useAgentTurn`
Expected: FAIL — `cancelTool` is not a function / `cancelToolCall` not on `AgentSessionLike`.

- [ ] **Step 3: Implement**

In `packages/cli/src/chat/hooks/useAgentTurn.ts`:

Extend `AgentSessionLike`:

```ts
export type AgentSessionLike<T extends ProviderTypes = ProviderTypes> = {
  stream(
    prompt: string,
    opts?: { messages?: Array<Message<T['MessagePart'], T['ToolCall']>>; signal?: AbortSignal },
  ): AsyncGenerator<AgentEvent<T>>
  cancelToolCall?(): void
}
```

Extend the return type:

```ts
export type UseAgentTurnReturn<T extends ProviderTypes = ProviderTypes> = TurnState<T> & {
  submit: (text: string) => Promise<void>
  abort: () => void
  cancelTool: () => void
}
```

Add an agent ref and assign it in `submit`. Change the `agent` local and add the ref + callback:

```ts
  const abortRef = useRef<AbortController | null>(null)
  const agentRef = useRef<AgentSessionLike<T> | null>(null)
  const messagesRef = useRef<Array<Message<T['MessagePart'], T['ToolCall']>>>([])
  const { createAgent, onEvent } = params

  const submit = useCallback(
    async (text: string) => {
      if (text.trim() === '') return
      const controller = new AbortController()
      abortRef.current = controller
      const agent = createAgent()
      agentRef.current = agent
      try {
        for await (const event of agent.stream(text, {
          messages: messagesRef.current,
          signal: controller.signal,
        })) {
          dispatch(event)
          onEvent?.(event)
          if (event.type === 'complete') {
            messagesRef.current = event.result.messages
          }
        }
      } catch {
        // Error/timeout/abort events were already dispatched before the throw;
        // swallow here so callers don't hit unhandled rejections.
      } finally {
        abortRef.current = null
        agentRef.current = null
      }
    },
    [createAgent, onEvent],
  )

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const cancelTool = useCallback(() => {
    agentRef.current?.cancelToolCall?.()
  }, [])

  return useMemo(
    () => ({ ...state, submit, abort, cancelTool }),
    [state, submit, abort, cancelTool],
  )
```

- [ ] **Step 4: Run tests; expect PASS**

Run: `pnpm --filter mokei test:unit -- useAgentTurn`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/chat/hooks/useAgentTurn.ts packages/cli/test/chat/useAgentTurn.test.tsx
git commit -m "feat(cli-ink): useAgentTurn exposes cancelTool"
```

---

## Phase 3 — `packages/cli`: components + ChatApp

### Task 7: `ToolCallStatus` shows elapsed + hang warning

**Files:**
- Modify: `packages/cli/src/chat/components/ToolCallStatus.tsx`
- Modify: `packages/cli/test/chat/components.test.tsx`

- [ ] **Step 1: Add failing tests**

Append to `packages/cli/test/chat/components.test.tsx` (the file already imports `ToolCallStatus` and `render`):

```tsx
describe('ToolCallStatus elapsed + hang', () => {
  test('shows elapsed seconds while calling', () => {
    const { lastFrame } = render(
      <ToolCallStatus name="ctx:read" phase="calling" elapsedMs={3000} />,
    )
    expect(lastFrame()).toContain('ctx:read')
    expect(lastFrame()).toMatch(/3s/)
  })

  test('warns when elapsed passes the hang threshold', () => {
    const { lastFrame } = render(
      <ToolCallStatus name="ctx:read" phase="calling" elapsedMs={12000} />,
    )
    expect(lastFrame()).toMatch(/stuck/i)
  })
})
```

- [ ] **Step 2: Run tests; expect FAIL**

Run: `pnpm --filter mokei test:unit -- components`
Expected: FAIL — `elapsedMs` not handled / no "stuck" text.

- [ ] **Step 3: Implement**

Replace `packages/cli/src/chat/components/ToolCallStatus.tsx`:

```tsx
import { Spinner } from '@inkjs/ui'
import { Box, Text } from 'ink'

/** Elapsed time after which a running tool is flagged as possibly stuck. */
export const HANG_WARN_MS = 10000

export type ToolCallStatusProps = {
  name: string
  phase: 'calling' | 'done' | 'failed'
  elapsedMs?: number
}

export function ToolCallStatus({ name, phase, elapsedMs }: ToolCallStatusProps) {
  const stuck = phase === 'calling' && elapsedMs != null && elapsedMs >= HANG_WARN_MS
  const color = phase === 'failed' || stuck ? 'red' : 'yellow'
  const seconds = elapsedMs != null ? `${Math.floor(elapsedMs / 1000)}s` : null
  return (
    <Box>
      {phase === 'calling' ? <Spinner /> : <Text>· </Text>}
      <Text color={color}>
        {' '}
        {phase} {name}
        {seconds != null ? ` (running ${seconds})` : ''}
        {stuck ? ' — may be stuck — esc to cancel' : ''}
      </Text>
    </Box>
  )
}
```

- [ ] **Step 4: Run tests; expect PASS**

Run: `pnpm --filter mokei test:unit -- components`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/chat/components/ToolCallStatus.tsx packages/cli/test/chat/components.test.tsx
git commit -m "feat(cli-ink): ToolCallStatus shows elapsed time and hang warning"
```

---

### Task 8: `PendingTurn` wires elapsed into `ToolCallStatus`

**Files:**
- Modify: `packages/cli/src/chat/components/PendingTurn.tsx`

No new behavior test (the wiring is exercised by `ChatApp`); this task is type-safe glue plus a manual render check.

- [ ] **Step 1: Implement**

Replace `packages/cli/src/chat/components/PendingTurn.tsx`:

```tsx
import { Spinner } from '@inkjs/ui'
import { Box, Text } from 'ink'

import { useElapsed } from '../hooks/useElapsed.js'
import type { PendingApproval } from '../hooks/useToolApproval.js'
import type { TurnState } from '../turn-reducer.js'
import { AssistantStreamingText } from './AssistantStreamingText.js'
import { ToolApprovalCard } from './ToolApprovalCard.js'
import { ToolCallStatus } from './ToolCallStatus.js'

export type PendingTurnProps = {
  turn: TurnState
  pending: PendingApproval | null
  onApprove: () => void
  onDeny: () => void
}

export function PendingTurn({ turn, pending, onApprove, onDeny }: PendingTurnProps) {
  const calling = turn.state === 'calling-tool' && turn.activeToolCall != null
  // Hook called unconditionally; the arg gates the interval (React hook rules).
  const now = useElapsed(calling)

  if (turn.state === 'idle') return null

  const showSpinner = turn.state === 'streaming' && turn.currentText === ''

  return (
    <Box flexDirection="column">
      {turn.currentText !== '' ? <AssistantStreamingText text={turn.currentText} /> : null}
      {showSpinner ? (
        <Box>
          <Spinner />
          <Text dimColor> waiting for response…</Text>
        </Box>
      ) : null}
      {turn.state === 'awaiting-approval' && pending != null ? (
        <ToolApprovalCard call={pending.call} onApprove={onApprove} onDeny={onDeny} />
      ) : null}
      {calling && turn.activeToolCall != null ? (
        <ToolCallStatus
          name={turn.activeToolCall.call.name}
          phase="calling"
          elapsedMs={now - turn.activeToolCall.startedAt}
        />
      ) : null}
    </Box>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter mokei test:types`
Expected: PASS.

- [ ] **Step 3: Run full CLI unit suite (regression)**

Run: `pnpm --filter mokei test:unit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/chat/components/PendingTurn.tsx
git commit -m "feat(cli-ink): PendingTurn shows live elapsed for the active tool"
```

---

### Task 9: `ToolResultCard` single-line error + outcome + duration

**Files:**
- Modify: `packages/cli/src/chat/components/ToolResultCard.tsx`
- Modify: `packages/cli/test/chat/components.test.tsx`

- [ ] **Step 1: Add failing tests**

Append to `packages/cli/test/chat/components.test.tsx`:

```tsx
describe('ToolResultCard outcomes', () => {
  test('collapses a multi-line error to its first line with a details hint', () => {
    const { lastFrame } = render(
      <ToolResultCard name="ctx:read" error={'ENOENT: missing\nstack line 1\nstack line 2'} />,
    )
    expect(lastFrame()).toContain('ENOENT: missing')
    expect(lastFrame()).not.toContain('stack line 1')
    expect(lastFrame()).toContain('/details')
  })

  test('renders the timeout outcome', () => {
    const { lastFrame } = render(
      <ToolResultCard name="ctx:read" error="tool timed out" outcome="timeout" />,
    )
    expect(lastFrame()).toMatch(/timed out/i)
  })

  test('renders the cancelled outcome', () => {
    const { lastFrame } = render(
      <ToolResultCard name="ctx:read" error="cancelled by user" outcome="cancelled" />,
    )
    expect(lastFrame()).toMatch(/cancelled/i)
  })

  test('shows duration when provided', () => {
    const { lastFrame } = render(
      <ToolResultCard name="ctx:read" result="ok" durationMs={1500} />,
    )
    expect(lastFrame()).toMatch(/1\.5s/)
  })
})
```

(`ToolResultCard` is already imported at the top of this test file from Task 13 of the prior plan.)

- [ ] **Step 2: Run tests; expect FAIL**

Run: `pnpm --filter mokei test:unit -- components`
Expected: FAIL — `outcome` / `durationMs` not handled; multi-line error shown in full.

- [ ] **Step 3: Implement**

Replace `packages/cli/src/chat/components/ToolResultCard.tsx`:

```tsx
import { Box, Text } from 'ink'

export type ToolResultOutcome = 'error' | 'timeout' | 'cancelled'

export type ToolResultCardProps = {
  name: string
  result?: string
  error?: string
  outcome?: ToolResultOutcome
  durationMs?: number
}

function firstLine(text: string): { line: string; hasMore: boolean } {
  const lines = text.split('\n')
  return { line: lines[0] ?? '', hasMore: lines.length > 1 }
}

const OUTCOME_LABEL: Record<ToolResultOutcome, string> = {
  error: 'error',
  timeout: 'timed out',
  cancelled: 'cancelled',
}

export function ToolResultCard({ name, result, error, outcome, durationMs }: ToolResultCardProps) {
  const isError = error != null
  const kind: ToolResultOutcome = outcome ?? 'error'
  const duration = durationMs != null ? ` · ${(durationMs / 1000).toFixed(1)}s` : ''

  let body = result ?? ''
  let hint = ''
  if (isError) {
    const { line, hasMore } = firstLine(error)
    body = kind === 'error' ? line : `${OUTCOME_LABEL[kind]} — ${line}`
    hint = hasMore ? '  (/details for full text)' : ''
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={isError ? 'red' : 'gray'}>
      <Text color={isError ? 'red' : 'yellow'}>
        tool · {name}
        {duration}
      </Text>
      <Text>
        {body}
        {hint ? <Text dimColor>{hint}</Text> : null}
      </Text>
    </Box>
  )
}
```

- [ ] **Step 4: Run tests; expect PASS**

Run: `pnpm --filter mokei test:unit -- components`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/chat/components/ToolResultCard.tsx packages/cli/test/chat/components.test.tsx
git commit -m "feat(cli-ink): single-line tool errors with outcome and duration"
```

---

### Task 10: `ChatApp` — duration, outcomes, `/details`, contextual Esc; HelpCard

**Files:**
- Modify: `packages/cli/src/chat/ChatApp.tsx`
- Modify: `packages/cli/src/chat/components/HelpCard.tsx`

- [ ] **Step 1: Extend the transcript `tool` entry type**

In `packages/cli/src/chat/ChatApp.tsx`, update the `TranscriptEntry` union's `tool` variant:

```ts
type TranscriptEntry =
  | { kind: 'user'; id: number; text: string }
  | { kind: 'assistant'; id: number; text: string }
  | {
      kind: 'tool'
      id: number
      name: string
      result?: string
      error?: string
      outcome?: 'error' | 'timeout' | 'cancelled'
      durationMs?: number
    }
  | { kind: 'notice'; id: number; variant: SystemNoticeVariant; text: string }
```

- [ ] **Step 2: Add refs for duration + last error detail**

In the `ChatApp` body, near the other refs (after `const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)`):

```ts
  const toolStartRef = useRef<Map<string, number>>(new Map())
  const lastErrorDetailRef = useRef<string | null>(null)
```

- [ ] **Step 3: Update `onEvent` to record durations + map outcomes**

In the `useAgentTurn` `onEvent` switch, replace the `tool-call-complete` and `tool-call-error` cases and add a `tool-call-start` case:

```ts
        case 'tool-call-start':
          toolStartRef.current.set(event.toolCall.id, event.timestamp)
          break
        case 'tool-call-complete': {
          const content = event.result?.content
          const text = Array.isArray(content)
            ? (
                content.find((c: { type: string }) => c.type === 'text') as
                  | { type: 'text'; text: string }
                  | undefined
              )?.text
            : undefined
          const startedAt = toolStartRef.current.get(event.toolCall.id)
          toolStartRef.current.delete(event.toolCall.id)
          pushEntry({
            kind: 'tool',
            name: event.toolCall.name,
            result: text ?? '',
            ...(startedAt != null ? { durationMs: event.timestamp - startedAt } : {}),
          })
          break
        }
        case 'tool-call-error': {
          const startedAt = toolStartRef.current.get(event.toolCall.id)
          toolStartRef.current.delete(event.toolCall.id)
          const outcome =
            event.error.name === 'ToolCallTimeoutError'
              ? 'timeout'
              : event.error.name === 'ToolCallCancelledError'
                ? 'cancelled'
                : 'error'
          lastErrorDetailRef.current = event.error.stack ?? event.error.message
          pushEntry({
            kind: 'tool',
            name: event.toolCall.name,
            error: event.error.message,
            outcome,
            ...(startedAt != null ? { durationMs: event.timestamp - startedAt } : {}),
          })
          if (outcome === 'cancelled') {
            pushEntry({
              kind: 'notice',
              variant: 'warning',
              text: `tool cancelled: ${event.toolCall.name}`,
            })
          }
          break
        }
```

In the same switch, update the turn-level `error` case to also store the detail (keep the existing notice push, add the ref assignment as the first line of the case):

```ts
        case 'error': {
          const err = event.error
          lastErrorDetailRef.current = err.stack ?? err.message
          const cause =
            err.cause instanceof Error ? ` (cause: ${err.cause.name}: ${err.cause.message})` : ''
          pushEntry({
            kind: 'notice',
            variant: 'error',
            text: `${err.name}: ${err.message}${cause}`,
          })
          break
        }
```

- [ ] **Step 4: Handle `/details` in the command switch**

In `handleSubmit`, add a case in the `switch (name)` block (before `default`):

```ts
        case 'details':
          if (lastErrorDetailRef.current == null) {
            pushEntry({ kind: 'notice', variant: 'info', text: 'no recent error details' })
          } else {
            pushEntry({ kind: 'notice', variant: 'info', text: lastErrorDetailRef.current })
          }
          break
```

- [ ] **Step 5: Make Esc contextual**

In the `useInput` callback, replace the existing abort branch:

```ts
    if (modal != null) return
    if (key.escape) {
      if (turn.state === 'calling-tool') {
        turn.cancelTool()
      } else if (turn.state === 'streaming') {
        turn.abort()
      }
    }
```

- [ ] **Step 6: Pass `outcome` + `durationMs` through to `ToolResultCard`**

In the `<Static>` render, update the `case 'tool':` branch:

```tsx
            case 'tool':
              return (
                <ToolResultCard
                  key={entry.id}
                  name={entry.name}
                  result={entry.result}
                  error={entry.error}
                  outcome={entry.outcome}
                  durationMs={entry.durationMs}
                />
              )
```

- [ ] **Step 7: Update `HelpCard`**

In `packages/cli/src/chat/components/HelpCard.tsx`, add a `/details` line and update the Esc wording. Replace the command list lines:

```tsx
      <Text>/tools enable/disable tools</Text>
      <Text>/details show full text of the last error</Text>
      <Text>/quit, /exit end session</Text>
      <Text>esc cancel active tool, else abort turn</Text>
```

- [ ] **Step 8: Type-check + run full suite**

Run: `pnpm --filter mokei test:types && pnpm --filter mokei test:unit`
Expected: PASS (`ChatApp.test.tsx` smoke test still renders).

- [ ] **Step 9: Commit**

```bash
git add packages/cli/src/chat/ChatApp.tsx packages/cli/src/chat/components/HelpCard.tsx
git commit -m "feat(cli-ink): tool durations, outcome mapping, /details, contextual esc"
```

---

### Task 11: Build + final verification

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `pnpm --filter @mokei/session build && pnpm --filter mokei build`
Expected: PASS (SWC + tsc clean).

- [ ] **Step 2: Full test sweep**

Run: `pnpm --filter @mokei/session test -- --run && pnpm --filter mokei test`
Expected: all green.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: clean (or auto-fixed; re-stage if formatting changed).

- [ ] **Step 4: Manual smoke (optional, requires a provider key + an MCP context)**

Start the chat, add a context with a slow/hanging tool, prompt the model to call it, and confirm: elapsed counter ticks; `esc` cancels just the tool and the turn continues; after 120s an uncancelled hang surfaces a `timed out` card; a multi-line error shows one line + `/details` reveals the rest.

---

## Notes / risks

- `useElapsed` re-renders `PendingTurn` once per second only while a tool is active; cleared otherwise, so idle has no timers.
- Per-call cancellation relies on `Session.executeToolCall` wiring `signal → request.cancel()` and context-rpc rejecting the promise on abort (verified). If a transport ignores the cancel, the per-call timer still fires the abort path; the underlying request may stay open server-side but the turn proceeds.
- Outcome discrimination keys off `error.name` strings (`ToolCallTimeoutError` / `ToolCallCancelledError`) to avoid importing the classes into the CLI bundle solely for `instanceof`; the names are stable per Task 1.
