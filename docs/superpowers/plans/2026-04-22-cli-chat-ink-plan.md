# CLI Chat UX on Ink — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Stage:** qa

**Goal:** Replace the enquirer + ora + raw-stdout loop in `packages/cli/src/chat-session.ts` with an Ink-based chat UI that delegates orchestration to `@mokei/session`'s `AgentSession` (extended for multi-turn history).

**Architecture:** Extend `AgentSession` to accept and return full conversation history (`stream(prompt, { messages?, signal? })` / `AgentResult.messages`). Keep `Session` and `AgentSession` as the orchestration core. In the CLI, replace the monolithic `ChatSession` with an Ink application composed of a transcript (`<Static>`), a pending-turn region, and a persistent input footer. React hooks bridge React state to `AgentSession`'s event stream; a deferred-promise pattern turns `toolApproval` into inline `<ConfirmInput>` cards.

**Tech Stack:** TypeScript, Ink v5, `@inkjs/ui`, React 18, SWC (JSX), `@mokei/session`, `@mokei/host`, vitest, ink-testing-library.

**Spec reference:** `docs/superpowers/specs/2026-04-22-cli-chat-ink-design.md`.

---

## Conventions

- Commit cadence: one commit per task, message prefix `feat(cli-ink): ` except Phase 1 which uses `feat(session): `.
- Follow `docs/agents/conventions.md`: `type` not `interface`, `Array<T>` not `T[]`, `ID` not `Id`, no `any`.
- All new files use ESM + `.js` import suffixes (even for `.ts`/`.tsx` source — nodenext convention in this repo).
- Tests: vitest. Run from the relevant package root with `pnpm test`.
- After any change affecting package types, run `pnpm --filter <pkg> test:types` before committing.

---

## Phase 1 — `@mokei/session`: AgentSession multi-turn history

### Task 1: Extend `AgentResult` with `messages`

**Files:**
- Modify: `packages/session/src/agent-types.ts`

- [ ] **Step 1: Add `messages` field to `AgentResult`**

In `packages/session/src/agent-types.ts`, find the `AgentResult` type (around line 247) and extend it:

```ts
import type { Message } from '@mokei/model-provider'

export type AgentResult<T extends ProviderTypes = ProviderTypes> = {
  /** Final text response from the agent */
  text: string
  /** Full conversation history after this run: input messages + new user prompt + assistant + tool messages */
  messages: Array<Message<T['MessagePart'], T['ToolCall']>>
  /** Total number of iterations executed */
  iterations: number
  /** All tool calls made during execution */
  toolCalls: Array<AgentToolCallRecord>
  /** Total input tokens used */
  inputTokens: number
  /** Total output tokens generated */
  outputTokens: number
  /** Total execution duration in milliseconds */
  duration: number
  /** How the agent completed: 'complete', 'max-iterations', 'timeout', 'aborted' */
  finishReason: AgentFinishReason
}
```

Also update consumers of the bare `AgentResult` in the same file:

```ts
export type AgentCompleteEvent<T extends ProviderTypes = ProviderTypes> = {
  type: 'complete'
  result: AgentResult<T>
  timestamp: number
}
```

Propagate the `<T>` parameter to the `AgentEvent` union and `AgentSessionEvents` in `agent-session.ts` as needed in Task 2.

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @mokei/session test:types`
Expected: FAIL — `AgentResult` requires `messages`, existing construction site in `agent-session.ts` doesn't supply it yet.

- [ ] **Step 3: Commit**

```bash
git add packages/session/src/agent-types.ts
git commit -m "feat(session): add messages field to AgentResult"
```

---

### Task 2: Accept `messages` in `stream()` / `run()` and return via `AgentResult`

**Files:**
- Modify: `packages/session/src/agent-session.ts`

- [ ] **Step 1: Update `run()` signature**

Replace the current `run` method (around line 100):

```ts
async run(
  prompt: string,
  opts: { messages?: Array<Message<T['MessagePart'], T['ToolCall']>>; signal?: AbortSignal } = {},
): Promise<AgentResult<T>> {
  let result: AgentResult<T> | undefined

  for await (const event of this.stream(prompt, opts)) {
    if (event.type === 'complete') {
      result = event.result
    }
  }

  if (result == null) {
    throw new Error('Agent stream ended without completion')
  }

  return result
}
```

- [ ] **Step 2: Update `stream()` signature and initial message construction**

Replace the `stream()` declaration (around line 123):

```ts
async *stream(
  prompt: string,
  opts: { messages?: Array<Message<T['MessagePart'], T['ToolCall']>>; signal?: AbortSignal } = {},
): AsyncGenerator<AgentEvent<T>> {
  const { messages: priorMessages, signal } = opts
  const startTime = Date.now()
  // … keep existing destructure of this.#params …
```

Replace the "Build initial messages" block (around line 159):

```ts
// Build initial messages
const messages: Array<Message<T['MessagePart'], T['ToolCall']>> = []
if (priorMessages != null && priorMessages.length > 0) {
  const hasSystem = priorMessages.some((m) => m.role === 'system')
  if (systemPrompt && !hasSystem) {
    messages.push({ source: 'client', role: 'system', text: systemPrompt })
  }
  messages.push(...priorMessages)
} else if (systemPrompt) {
  messages.push({ source: 'client', role: 'system', text: systemPrompt })
}
messages.push({ source: 'client', role: 'user', text: prompt })
```

- [ ] **Step 3: Populate `result.messages`**

In the "Build final result" block (around line 352), include `messages`:

```ts
const result: AgentResult<T> = {
  text: currentText,
  messages,
  iterations: iteration,
  toolCalls: allToolCalls,
  inputTokens: totalInputTokens,
  outputTokens: totalOutputTokens,
  duration: Date.now() - startTime,
  finishReason,
}
```

- [ ] **Step 4: Parameterize `AgentSessionEvents` + `AgentEvent` generics**

Change the class declaration to thread `T`:

```ts
export type AgentSessionEvents<T extends ProviderTypes = ProviderTypes> = {
  event: AgentEvent<T>
}

export class AgentSession<T extends ProviderTypes = ProviderTypes> extends Disposer {
  #params: ResolvedAgentParams<T>
  #events: EventEmitter<AgentSessionEvents<T>>
  // …
  get events(): EventEmitter<AgentSessionEvents<T>> {
    return this.#events
  }
  // …
}
```

In `agent-types.ts`, make `AgentEvent` generic over `T` and pipe it through `AgentCompleteEvent<T>`:

```ts
export type AgentEvent<T extends ProviderTypes = ProviderTypes> =
  | AgentStartEvent
  | AgentIterationStartEvent
  | AgentTextDeltaEvent
  | AgentTextCompleteEvent
  | AgentToolCallPendingEvent
  | AgentToolCallApprovedEvent
  | AgentToolCallDeniedEvent
  | AgentToolCallStartEvent
  | AgentToolCallCompleteEvent
  | AgentToolCallErrorEvent
  | AgentIterationCompleteEvent
  | AgentCompleteEvent<T>
  | AgentErrorEvent
  | AgentTimeoutEvent
  | AgentMaxIterationsEvent
```

- [ ] **Step 5: Type-check**

Run: `pnpm --filter @mokei/session test:types`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/session/src/agent-session.ts packages/session/src/agent-types.ts
git commit -m "feat(session): accept prior messages in AgentSession.stream/run"
```

---

### Task 3: Tests for multi-turn history

**Files:**
- Modify: `packages/session/test/agent-session.test.ts`

- [ ] **Step 1: Add failing test for `messages` in `AgentResult`**

Append at the end of the outer `describe` block in `packages/session/test/agent-session.test.ts`:

```ts
describe('multi-turn history', () => {
  test('AgentResult.messages contains the user prompt and assistant reply', async () => {
    const provider = createMockProvider([{ text: 'Hello!' }])
    const session = new Session({ providers: { mock: provider } })
    const agent = new AgentSession({ session, provider: 'mock', model: 'test-model' })

    const result = await agent.run('Hi')

    expect(result.messages).toEqual([
      { source: 'client', role: 'user', text: 'Hi' },
      expect.objectContaining({ source: 'server', role: 'assistant', text: 'Hello!' }),
    ])
  })

  test('stream({ messages }) prepends prior history before the new prompt', async () => {
    const provider = createMockProvider([{ text: 'Second reply' }])
    const session = new Session({ providers: { mock: provider } })
    const agent = new AgentSession({ session, provider: 'mock', model: 'test-model' })

    const prior = [
      { source: 'client' as const, role: 'user' as const, text: 'First prompt' },
      { source: 'server' as const, role: 'assistant' as const, text: 'First reply', raw: {} },
    ]

    const result = await agent.run('Second prompt', { messages: prior })

    expect(result.messages.slice(0, 2)).toEqual(prior)
    expect(result.messages[2]).toEqual({
      source: 'client',
      role: 'user',
      text: 'Second prompt',
    })
    expect(result.messages[3]).toMatchObject({ source: 'server', role: 'assistant' })
  })

  test('system prompt is not duplicated when prior messages include a system role', async () => {
    const provider = createMockProvider([{ text: 'ok' }])
    const session = new Session({ providers: { mock: provider } })
    const agent = new AgentSession({
      session,
      provider: 'mock',
      model: 'test-model',
      systemPrompt: 'You are helpful',
    })

    const prior = [
      { source: 'client' as const, role: 'system' as const, text: 'You are helpful' },
      { source: 'client' as const, role: 'user' as const, text: 'First' },
      { source: 'server' as const, role: 'assistant' as const, text: 'First reply', raw: {} },
    ]

    const result = await agent.run('Second', { messages: prior })
    const systemCount = result.messages.filter((m) => m.role === 'system').length
    expect(systemCount).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests; expect PASS**

Run: `pnpm --filter @mokei/session test -- --run`
Expected: all three new tests PASS along with existing ones.

- [ ] **Step 3: Commit**

```bash
git add packages/session/test/agent-session.test.ts
git commit -m "test(session): cover AgentSession multi-turn history"
```

---

## Phase 2 — `packages/cli` build prep

### Task 4: Swap runtime dependencies

**Files:**
- Modify: `packages/cli/package.json`
- Modify: `pnpm-workspace.yaml` (catalog entries for ink/react)

- [ ] **Step 1: Add catalog entries**

In `pnpm-workspace.yaml`, add under `catalog:` (alphabetize within the existing list):

```yaml
  ink: ^5.2.0
  "@inkjs/ui": ^2.0.0
  react: ^18.3.1
  "@types/react": ^18.3.12
  ink-testing-library: ^4.0.0
  vitest: catalog:   # only if not already present — likely already there
```

(If any of these already exist at different versions, do not downgrade; reconcile conservatively with whatever catalog already ships.)

- [ ] **Step 2: Update `packages/cli/package.json`**

Remove from `dependencies`: `ansi-colors`, `enquirer`, `ora`.
Add to `dependencies`: `ink: "catalog:"`, `@inkjs/ui: "catalog:"`, `react: "catalog:"`.
Add to `devDependencies`: `@types/react: "catalog:"`, `vitest: "catalog:"`, `ink-testing-library: "catalog:"`, `@mokei/session: "workspace:^"`.

Add to scripts:

```json
"test:unit": "vitest run",
"test": "pnpm run test:types && pnpm run test:unit"
```

- [ ] **Step 3: Install**

Run: `pnpm install`
Expected: lockfile updates cleanly; no peer warnings for ink/react.

- [ ] **Step 4: Commit**

```bash
git add pnpm-workspace.yaml packages/cli/package.json pnpm-lock.yaml
git commit -m "feat(cli-ink): swap enquirer/ora for ink + react deps"
```

---

### Task 5: Package-local SWC config for JSX

**Files:**
- Create: `packages/cli/swc.json`
- Modify: `packages/cli/package.json` (`build:dist` script)

- [ ] **Step 1: Create `packages/cli/swc.json`**

```json
{
  "jsc": {
    "parser": {
      "syntax": "typescript",
      "tsx": true
    },
    "target": "es2022",
    "transform": {
      "react": {
        "runtime": "automatic",
        "importSource": "react"
      },
      "optimizer": {
        "globals": {
          "vars": {
            "process.env.NODE_ENV": "production"
          }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Point `build:dist` at the local config**

In `packages/cli/package.json`, change:

```json
"build:dist": "swc src -d ./dist --config-file ./swc.json --strip-leading-paths"
```

- [ ] **Step 3: Verify build still works (no JSX yet, just config swap)**

Run: `pnpm --filter mokei build`
Expected: PASS (no TSX files yet; SWC compiles existing TS cleanly).

- [ ] **Step 4: Commit**

```bash
git add packages/cli/swc.json packages/cli/package.json
git commit -m "feat(cli-ink): package-local swc config with jsx support"
```

---

### Task 6: Update `packages/cli/tsconfig.json` for JSX + vitest

**Files:**
- Modify: `packages/cli/tsconfig.json`
- Create: `packages/cli/vitest.config.ts`

- [ ] **Step 1: Update tsconfig**

Replace `packages/cli/tsconfig.json` with:

```json
{
  "compilerOptions": {
    "skipLibCheck": true,
    "declaration": false,
    "module": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "target": "es2022",
    "moduleResolution": "node16",
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "types": ["node"]
  },
  "include": ["./src/**/*"],
  "ts-node": {
    "esm": true
  }
}
```

- [ ] **Step 2: Create `packages/cli/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environment: 'node',
  },
})
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter mokei test:types`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/cli/tsconfig.json packages/cli/vitest.config.ts
git commit -m "feat(cli-ink): tsconfig jsx + vitest config"
```

---

### Task 7: Scaffold `chat/` directory

**Files:**
- Create: `packages/cli/src/chat/.gitkeep`
- Create: `packages/cli/src/chat/components/.gitkeep`
- Create: `packages/cli/src/chat/hooks/.gitkeep`
- Create: `packages/cli/test/chat/.gitkeep`

- [ ] **Step 1: Create empty placeholder dirs**

```bash
mkdir -p packages/cli/src/chat/components packages/cli/src/chat/hooks packages/cli/test/chat
touch packages/cli/src/chat/.gitkeep packages/cli/src/chat/components/.gitkeep packages/cli/src/chat/hooks/.gitkeep packages/cli/test/chat/.gitkeep
```

- [ ] **Step 2: Commit**

```bash
git add packages/cli/src/chat packages/cli/test/chat
git commit -m "feat(cli-ink): scaffold chat directory"
```

---

## Phase 3 — pure logic: slash parser + hooks

### Task 8: Slash command parser

**Files:**
- Create: `packages/cli/src/chat/slash.ts`
- Create: `packages/cli/test/chat/slash.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/cli/test/chat/slash.test.ts`:

```ts
import { describe, expect, test } from 'vitest'

import { parseSlash } from '../../src/chat/slash.js'

describe('parseSlash', () => {
  test('treats plain text as a message', () => {
    expect(parseSlash('hello there')).toEqual({ kind: 'message', text: 'hello there' })
  })

  test('ignores leading and trailing whitespace for messages', () => {
    expect(parseSlash('  hi  ')).toEqual({ kind: 'message', text: 'hi' })
  })

  test('parses /help with no args', () => {
    expect(parseSlash('/help')).toEqual({ kind: 'command', name: 'help', args: [] })
  })

  test('parses /context', () => {
    expect(parseSlash('/context')).toEqual({ kind: 'command', name: 'context', args: [] })
  })

  test('parses /context list as alias of /context', () => {
    expect(parseSlash('/context list')).toEqual({
      kind: 'command',
      name: 'context',
      args: ['list'],
    })
  })

  test('parses /context add with key, command, and args', () => {
    expect(parseSlash('/context add sqlite mcp-sqlite --db /tmp/x.db')).toEqual({
      kind: 'command',
      name: 'context',
      args: ['add', 'sqlite', 'mcp-sqlite', '--db', '/tmp/x.db'],
    })
  })

  test('parses /model with id', () => {
    expect(parseSlash('/model gpt-4o')).toEqual({
      kind: 'command',
      name: 'model',
      args: ['gpt-4o'],
    })
  })

  test('parses /quit and /exit', () => {
    expect(parseSlash('/quit')).toEqual({ kind: 'command', name: 'quit', args: [] })
    expect(parseSlash('/exit')).toEqual({ kind: 'command', name: 'exit', args: [] })
  })

  test('collapses runs of whitespace inside command args', () => {
    expect(parseSlash('/context   add    k    c')).toEqual({
      kind: 'command',
      name: 'context',
      args: ['add', 'k', 'c'],
    })
  })

  test('empty input is treated as an empty message (caller may no-op)', () => {
    expect(parseSlash('')).toEqual({ kind: 'message', text: '' })
  })
})
```

- [ ] **Step 2: Run test; expect FAIL**

Run: `pnpm --filter mokei test:unit`
Expected: cannot resolve `../../src/chat/slash.js`.

- [ ] **Step 3: Implement parser**

Create `packages/cli/src/chat/slash.ts`:

```ts
export type SlashMessage = { kind: 'message'; text: string }
export type SlashCommand = { kind: 'command'; name: string; args: Array<string> }
export type SlashParsed = SlashMessage | SlashCommand

export function parseSlash(input: string): SlashParsed {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) {
    return { kind: 'message', text: trimmed }
  }
  const tokens = trimmed.slice(1).split(/\s+/).filter((t) => t.length > 0)
  const [name, ...args] = tokens
  return { kind: 'command', name: name ?? '', args }
}
```

- [ ] **Step 4: Run tests; expect PASS**

Run: `pnpm --filter mokei test:unit`
Expected: all `parseSlash` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/chat/slash.ts packages/cli/test/chat/slash.test.ts
git commit -m "feat(cli-ink): slash command parser"
```

---

### Task 9: `useToolApproval` hook

**Files:**
- Create: `packages/cli/src/chat/hooks/useToolApproval.ts`
- Create: `packages/cli/test/chat/useToolApproval.test.tsx`

- [ ] **Step 1: Write failing test**

Create `packages/cli/test/chat/useToolApproval.test.tsx`:

```tsx
import { render } from 'ink-testing-library'
import React, { useEffect } from 'react'
import { describe, expect, test } from 'vitest'

import { useToolApproval } from '../../src/chat/hooks/useToolApproval.js'

function Harness({ onReady }: { onReady: (api: ReturnType<typeof useToolApproval>) => void }) {
  const api = useToolApproval()
  useEffect(() => {
    onReady(api)
  }, [api, onReady])
  return null
}

describe('useToolApproval', () => {
  test('approve resolves the pending promise with true and clears pending', async () => {
    let api!: ReturnType<typeof useToolApproval>
    render(<Harness onReady={(a) => { api = a }} />)

    const promise = api.toolApprovalFn(
      { id: '1', name: 'ns:tool', arguments: '{}' },
      { iteration: 1, history: [] },
    )

    // pending should populate on next microtask
    await Promise.resolve()
    expect(api.pending?.call.name).toBe('ns:tool')

    api.approve()
    await expect(promise).resolves.toBe(true)
  })

  test('deny resolves the pending promise with false', async () => {
    let api!: ReturnType<typeof useToolApproval>
    render(<Harness onReady={(a) => { api = a }} />)

    const promise = api.toolApprovalFn(
      { id: '2', name: 'ns:tool', arguments: '{}' },
      { iteration: 1, history: [] },
    )

    await Promise.resolve()
    api.deny()
    await expect(promise).resolves.toBe(false)
  })
})
```

- [ ] **Step 2: Run test; expect FAIL**

Run: `pnpm --filter mokei test:unit`
Expected: module not found.

- [ ] **Step 3: Implement hook**

Create `packages/cli/src/chat/hooks/useToolApproval.ts`:

```ts
import { useCallback, useState } from 'react'

import type { ToolApprovalContext, ToolApprovalFn } from '@mokei/session'
import type { FunctionToolCall } from '@mokei/model-provider'

export type PendingApproval = {
  call: FunctionToolCall<unknown>
  context: ToolApprovalContext
  resolve: (ok: boolean) => void
}

export type ToolApprovalAPI = {
  pending: PendingApproval | null
  approve: () => void
  deny: () => void
  toolApprovalFn: ToolApprovalFn
}

export function useToolApproval(): ToolApprovalAPI {
  const [pending, setPending] = useState<PendingApproval | null>(null)

  const toolApprovalFn = useCallback<ToolApprovalFn>((call, context) => {
    return new Promise<boolean>((resolve) => {
      setPending({ call, context, resolve })
    })
  }, [])

  const approve = useCallback(() => {
    setPending((current) => {
      current?.resolve(true)
      return null
    })
  }, [])

  const deny = useCallback(() => {
    setPending((current) => {
      current?.resolve(false)
      return null
    })
  }, [])

  return { pending, approve, deny, toolApprovalFn }
}
```

If `@mokei/session` does not currently export `ToolApprovalFn` / `ToolApprovalContext` from its public entry, update `packages/session/src/index.ts` to re-export them (check `agent-types.ts` exports) and commit that as part of this task.

- [ ] **Step 4: Run tests; expect PASS**

Run: `pnpm --filter mokei test:unit`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/chat/hooks/useToolApproval.ts packages/cli/test/chat/useToolApproval.test.tsx packages/session/src/index.ts
git commit -m "feat(cli-ink): useToolApproval deferred-promise bridge"
```

---

### Task 10: `useAgentTurn` reducer (pure, no React yet)

**Files:**
- Create: `packages/cli/src/chat/turn-reducer.ts`
- Create: `packages/cli/test/chat/turn-reducer.test.ts`

Extract the reducer from `useAgentTurn` so it can be unit-tested without React.

- [ ] **Step 1: Write failing tests**

Create `packages/cli/test/chat/turn-reducer.test.ts`:

```ts
import { describe, expect, test } from 'vitest'

import { initialTurnState, turnReducer, type TurnState } from '../../src/chat/turn-reducer.js'

function apply(events: Array<Parameters<typeof turnReducer>[1]>): TurnState {
  return events.reduce((s, e) => turnReducer(s, e), initialTurnState())
}

describe('turnReducer', () => {
  test('start transitions idle -> streaming', () => {
    const s = apply([{ type: 'start', prompt: 'hi', timestamp: 0 }])
    expect(s.state).toBe('streaming')
    expect(s.currentText).toBe('')
  })

  test('text-delta accumulates currentText', () => {
    const s = apply([
      { type: 'start', prompt: 'hi', timestamp: 0 },
      { type: 'text-delta', text: 'Hel', timestamp: 1 },
      { type: 'text-delta', text: 'lo', timestamp: 2 },
    ])
    expect(s.currentText).toBe('Hello')
  })

  test('text-complete flushes currentText into lastAssistantText and resets buffer', () => {
    const s = apply([
      { type: 'start', prompt: 'hi', timestamp: 0 },
      { type: 'text-delta', text: 'Hi', timestamp: 1 },
      { type: 'text-complete', text: 'Hi', timestamp: 2 },
    ])
    expect(s.currentText).toBe('')
    expect(s.lastAssistantText).toBe('Hi')
  })

  test('tool-call-pending moves into awaiting-approval with the pending call', () => {
    const s = apply([
      { type: 'start', prompt: 'hi', timestamp: 0 },
      {
        type: 'tool-call-pending',
        toolCall: { id: '1', name: 'ns:tool', arguments: '{}' },
        timestamp: 1,
      },
    ])
    expect(s.state).toBe('awaiting-approval')
    expect(s.pendingCall?.id).toBe('1')
  })

  test('tool-call-approved moves to calling-tool', () => {
    const s = apply([
      { type: 'start', prompt: 'hi', timestamp: 0 },
      {
        type: 'tool-call-pending',
        toolCall: { id: '1', name: 'ns:tool', arguments: '{}' },
        timestamp: 1,
      },
      {
        type: 'tool-call-approved',
        toolCall: { id: '1', name: 'ns:tool', arguments: '{}' },
        timestamp: 2,
      },
    ])
    expect(s.state).toBe('calling-tool')
    expect(s.pendingCall).toBeNull()
  })

  test('tool-call-denied returns to streaming without a pending call', () => {
    const s = apply([
      { type: 'start', prompt: 'hi', timestamp: 0 },
      {
        type: 'tool-call-pending',
        toolCall: { id: '1', name: 'ns:tool', arguments: '{}' },
        timestamp: 1,
      },
      {
        type: 'tool-call-denied',
        toolCall: { id: '1', name: 'ns:tool', arguments: '{}' },
        reason: 'user',
        timestamp: 2,
      },
    ])
    expect(s.state).toBe('streaming')
    expect(s.pendingCall).toBeNull()
  })

  test('complete sets messages from result and returns to idle', () => {
    const s = apply([
      { type: 'start', prompt: 'hi', timestamp: 0 },
      {
        type: 'complete',
        result: {
          text: 'Hi',
          messages: [{ source: 'client', role: 'user', text: 'hi' }],
          iterations: 1,
          toolCalls: [],
          inputTokens: 0,
          outputTokens: 0,
          duration: 0,
          finishReason: 'complete',
        },
        timestamp: 3,
      },
    ])
    expect(s.state).toBe('idle')
    expect(s.messages).toEqual([{ source: 'client', role: 'user', text: 'hi' }])
  })

  test('error transitions to idle and records the error message', () => {
    const s = apply([
      { type: 'start', prompt: 'hi', timestamp: 0 },
      { type: 'error', error: new Error('boom'), timestamp: 1 },
    ])
    expect(s.state).toBe('idle')
    expect(s.lastError).toBe('boom')
  })
})
```

- [ ] **Step 2: Run tests; expect FAIL**

Run: `pnpm --filter mokei test:unit`
Expected: module not found.

- [ ] **Step 3: Implement reducer**

Create `packages/cli/src/chat/turn-reducer.ts`:

```ts
import type {
  AgentEvent,
  FunctionToolCall,
  Message,
  ProviderTypes,
} from '@mokei/session'

export type TurnStateName =
  | 'idle'
  | 'streaming'
  | 'awaiting-approval'
  | 'calling-tool'

export type TurnState<T extends ProviderTypes = ProviderTypes> = {
  state: TurnStateName
  currentText: string
  lastAssistantText: string
  messages: Array<Message<T['MessagePart'], T['ToolCall']>>
  pendingCall: FunctionToolCall<unknown> | null
  lastError: string | null
  iteration: number
}

export function initialTurnState<T extends ProviderTypes = ProviderTypes>(): TurnState<T> {
  return {
    state: 'idle',
    currentText: '',
    lastAssistantText: '',
    messages: [],
    pendingCall: null,
    lastError: null,
    iteration: 0,
  }
}

export function turnReducer<T extends ProviderTypes = ProviderTypes>(
  state: TurnState<T>,
  event: AgentEvent<T>,
): TurnState<T> {
  switch (event.type) {
    case 'start':
      return { ...state, state: 'streaming', currentText: '', lastError: null }
    case 'iteration-start':
      return { ...state, iteration: event.iteration }
    case 'text-delta':
      return { ...state, currentText: state.currentText + event.text }
    case 'text-complete':
      return {
        ...state,
        currentText: '',
        lastAssistantText: event.text,
      }
    case 'tool-call-pending':
      return { ...state, state: 'awaiting-approval', pendingCall: event.toolCall }
    case 'tool-call-approved':
      return { ...state, state: 'calling-tool', pendingCall: null }
    case 'tool-call-denied':
      return { ...state, state: 'streaming', pendingCall: null }
    case 'tool-call-start':
    case 'tool-call-complete':
    case 'tool-call-error':
    case 'iteration-complete':
      return state
    case 'complete':
      return {
        ...state,
        state: 'idle',
        messages: event.result.messages,
      }
    case 'error':
      return { ...state, state: 'idle', lastError: event.error.message }
    case 'timeout':
      return { ...state, state: 'idle', lastError: 'timeout' }
    case 'max-iterations':
      return { ...state, state: 'idle', lastError: 'max iterations reached' }
    default: {
      const _exhaustive: never = event
      return state
    }
  }
}
```

Also add re-exports to `packages/session/src/index.ts` if missing: `AgentEvent`, `FunctionToolCall`, `Message`, `ProviderTypes`.

- [ ] **Step 4: Run tests; expect PASS**

Run: `pnpm --filter mokei test:unit`
Expected: all `turnReducer` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/chat/turn-reducer.ts packages/cli/test/chat/turn-reducer.test.ts packages/session/src/index.ts
git commit -m "feat(cli-ink): turn reducer mapping AgentEvent to UI state"
```

---

### Task 11: `useAgentTurn` React hook

**Files:**
- Create: `packages/cli/src/chat/hooks/useAgentTurn.ts`
- Create: `packages/cli/test/chat/useAgentTurn.test.tsx`

Hook wraps the reducer; spawns a fresh `AgentSession` per submission, consumes its event stream, dispatches into the reducer.

- [ ] **Step 1: Write failing test with a mock AgentSession**

Create `packages/cli/test/chat/useAgentTurn.test.tsx`:

```tsx
import { render } from 'ink-testing-library'
import React, { useEffect } from 'react'
import { describe, expect, test, vi } from 'vitest'

import { useAgentTurn } from '../../src/chat/hooks/useAgentTurn.js'
import type { AgentSessionLike } from '../../src/chat/hooks/useAgentTurn.js'

function mockAgent(events: Array<unknown>): AgentSessionLike {
  return {
    async *stream() {
      for (const e of events) {
        yield e as never
      }
    },
  }
}

function Harness(props: {
  agent: AgentSessionLike
  onState: (s: ReturnType<typeof useAgentTurn>) => void
}) {
  const api = useAgentTurn({ createAgent: () => props.agent })
  useEffect(() => { props.onState(api) }, [api, props.onState])
  return null
}

describe('useAgentTurn', () => {
  test('submit drives state through start -> text-delta -> complete', async () => {
    const snapshots: Array<string> = []
    const agent = mockAgent([
      { type: 'start', prompt: 'hi', timestamp: 0 },
      { type: 'text-delta', text: 'Hello', timestamp: 1 },
      {
        type: 'complete',
        result: {
          text: 'Hello',
          messages: [{ source: 'client', role: 'user', text: 'hi' }],
          iterations: 1,
          toolCalls: [],
          inputTokens: 0,
          outputTokens: 0,
          duration: 0,
          finishReason: 'complete',
        },
        timestamp: 2,
      },
    ])

    let submit!: (text: string) => Promise<void>
    render(<Harness agent={agent} onState={(s) => {
      snapshots.push(s.state)
      submit = s.submit
    }} />)

    await submit('hi')
    expect(snapshots).toContain('streaming')
    expect(snapshots[snapshots.length - 1]).toBe('idle')
  })
})
```

- [ ] **Step 2: Run test; expect FAIL**

Run: `pnpm --filter mokei test:unit`
Expected: module not found.

- [ ] **Step 3: Implement hook**

Create `packages/cli/src/chat/hooks/useAgentTurn.ts`:

```ts
import { useCallback, useMemo, useReducer, useRef } from 'react'

import type { AgentEvent, Message, ProviderTypes } from '@mokei/session'

import {
  initialTurnState,
  turnReducer,
  type TurnState,
} from '../turn-reducer.js'

export type AgentSessionLike<T extends ProviderTypes = ProviderTypes> = {
  stream(
    prompt: string,
    opts?: { messages?: Array<Message<T['MessagePart'], T['ToolCall']>>; signal?: AbortSignal },
  ): AsyncGenerator<AgentEvent<T>>
}

export type UseAgentTurnParams<T extends ProviderTypes = ProviderTypes> = {
  createAgent: () => AgentSessionLike<T>
}

export type UseAgentTurnReturn<T extends ProviderTypes = ProviderTypes> = TurnState<T> & {
  submit: (text: string) => Promise<void>
  abort: () => void
}

export function useAgentTurn<T extends ProviderTypes = ProviderTypes>(
  params: UseAgentTurnParams<T>,
): UseAgentTurnReturn<T> {
  const [state, dispatch] = useReducer(
    turnReducer as (s: TurnState<T>, e: AgentEvent<T>) => TurnState<T>,
    undefined,
    initialTurnState<T>,
  )
  const abortRef = useRef<AbortController | null>(null)
  const messagesRef = useRef<Array<Message<T['MessagePart'], T['ToolCall']>>>([])

  const submit = useCallback(
    async (text: string) => {
      if (text.trim() === '') return
      const controller = new AbortController()
      abortRef.current = controller
      const agent = params.createAgent()
      try {
        for await (const event of agent.stream(text, {
          messages: messagesRef.current,
          signal: controller.signal,
        })) {
          dispatch(event)
          if (event.type === 'complete') {
            messagesRef.current = event.result.messages
          }
        }
      } finally {
        abortRef.current = null
      }
    },
    [params],
  )

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return useMemo(() => ({ ...state, submit, abort }), [state, submit, abort])
}
```

- [ ] **Step 4: Run tests; expect PASS**

Run: `pnpm --filter mokei test:unit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/chat/hooks/useAgentTurn.ts packages/cli/test/chat/useAgentTurn.test.tsx
git commit -m "feat(cli-ink): useAgentTurn hook wrapping AgentSession stream"
```

---

### Task 12: `useSession` hook

**Files:**
- Create: `packages/cli/src/chat/hooks/useSession.ts`
- Create: `packages/cli/test/chat/useSession.test.tsx`

- [ ] **Step 1: Write failing test with a mock `Session`**

Create `packages/cli/test/chat/useSession.test.tsx`:

```tsx
import { render } from 'ink-testing-library'
import React, { useEffect } from 'react'
import { describe, expect, test, vi } from 'vitest'

import { useSession } from '../../src/chat/hooks/useSession.js'
import type { SessionLike } from '../../src/chat/hooks/useSession.js'

function mockSession(): SessionLike {
  const listeners = new Map<string, Array<(e: unknown) => void>>()
  return {
    events: {
      on(name: string, fn: (e: unknown) => void) {
        const list = listeners.get(name) ?? []
        list.push(fn)
        listeners.set(name, list)
        return () => {
          const l = listeners.get(name) ?? []
          listeners.set(name, l.filter((x) => x !== fn))
        }
      },
    },
    addContext: vi.fn(async () => []),
    removeContext: vi.fn(() => {}),
    contextHost: { getContextKeys: () => [] as Array<string> },
    __emit(name: string, payload: unknown) {
      for (const fn of listeners.get(name) ?? []) fn(payload)
    },
  } as unknown as SessionLike & { __emit: (n: string, p: unknown) => void }
}

function Harness({
  session,
  onState,
}: {
  session: SessionLike
  onState: (s: ReturnType<typeof useSession>) => void
}) {
  const api = useSession(session)
  useEffect(() => { onState(api) }, [api, onState])
  return null
}

describe('useSession', () => {
  test('context-added event appends to contexts state', () => {
    const session = mockSession()
    const states: Array<Array<string>> = []
    render(<Harness session={session} onState={(s) => states.push(s.contexts)} />)
    ;(session as unknown as { __emit: (n: string, p: unknown) => void }).__emit(
      'context-added',
      { key: 'sqlite', tools: [] },
    )
    expect(states[states.length - 1]).toEqual(['sqlite'])
  })
})
```

- [ ] **Step 2: Run test; expect FAIL**

Run: `pnpm --filter mokei test:unit`
Expected: module not found.

- [ ] **Step 3: Implement hook**

Create `packages/cli/src/chat/hooks/useSession.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'

import type { Session } from '@mokei/session'

export type SessionLike = Pick<Session, 'addContext' | 'removeContext' | 'contextHost' | 'events'>

export function useSession(session: SessionLike) {
  const [contexts, setContexts] = useState<Array<string>>(() =>
    session.contextHost.getContextKeys(),
  )

  useEffect(() => {
    const offAdd = session.events.on('context-added', (e) => {
      setContexts((prev) => (prev.includes(e.key) ? prev : [...prev, e.key]))
    })
    const offRemove = session.events.on('context-removed', (e) => {
      setContexts((prev) => prev.filter((k) => k !== e.key))
    })
    return () => {
      offAdd()
      offRemove()
    }
  }, [session])

  const addContext = useCallback(
    (params: Parameters<Session['addContext']>[0]) => session.addContext(params),
    [session],
  )
  const removeContext = useCallback(
    (key: string) => session.removeContext(key),
    [session],
  )

  return { contexts, addContext, removeContext }
}
```

- [ ] **Step 4: Run tests; expect PASS**

Run: `pnpm --filter mokei test:unit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/chat/hooks/useSession.ts packages/cli/test/chat/useSession.test.tsx
git commit -m "feat(cli-ink): useSession hook"
```

---

## Phase 4 — Ink components

### Task 13: Message + notice primitives

**Files:**
- Create: `packages/cli/src/chat/components/UserMessage.tsx`
- Create: `packages/cli/src/chat/components/AssistantMessage.tsx`
- Create: `packages/cli/src/chat/components/ToolResultCard.tsx`
- Create: `packages/cli/src/chat/components/SystemNotice.tsx`
- Create: `packages/cli/test/chat/components.test.tsx`

- [ ] **Step 1: Write failing snapshot/content tests**

Create `packages/cli/test/chat/components.test.tsx`:

```tsx
import { render } from 'ink-testing-library'
import React from 'react'
import { describe, expect, test } from 'vitest'

import { AssistantMessage } from '../../src/chat/components/AssistantMessage.js'
import { SystemNotice } from '../../src/chat/components/SystemNotice.js'
import { ToolResultCard } from '../../src/chat/components/ToolResultCard.js'
import { UserMessage } from '../../src/chat/components/UserMessage.js'

describe('components', () => {
  test('UserMessage shows the prompt text with a marker', () => {
    const { lastFrame } = render(<UserMessage text="hello" />)
    expect(lastFrame()).toContain('hello')
    expect(lastFrame()).toMatch(/you|›/i)
  })

  test('AssistantMessage shows the reply text', () => {
    const { lastFrame } = render(<AssistantMessage text="hi there" />)
    expect(lastFrame()).toContain('hi there')
  })

  test('ToolResultCard shows the tool name and result text', () => {
    const { lastFrame } = render(
      <ToolResultCard name="ctx:read" result="file contents" />,
    )
    expect(lastFrame()).toContain('ctx:read')
    expect(lastFrame()).toContain('file contents')
  })

  test('ToolResultCard shows the error when error is present', () => {
    const { lastFrame } = render(<ToolResultCard name="ctx:read" error="ENOENT" />)
    expect(lastFrame()).toContain('ENOENT')
  })

  test('SystemNotice renders a warning variant', () => {
    const { lastFrame } = render(<SystemNotice variant="warning" text="stopped" />)
    expect(lastFrame()).toContain('stopped')
  })
})
```

- [ ] **Step 2: Run tests; expect FAIL**

Run: `pnpm --filter mokei test:unit`
Expected: module not found.

- [ ] **Step 3: Implement the four components**

Create `packages/cli/src/chat/components/UserMessage.tsx`:

```tsx
import { Box, Text } from 'ink'

export type UserMessageProps = { text: string }

export function UserMessage({ text }: UserMessageProps) {
  return (
    <Box>
      <Text color="cyan">› </Text>
      <Text>{text}</Text>
    </Box>
  )
}
```

Create `packages/cli/src/chat/components/AssistantMessage.tsx`:

```tsx
import { Box, Text } from 'ink'

export type AssistantMessageProps = { text: string }

export function AssistantMessage({ text }: AssistantMessageProps) {
  return (
    <Box>
      <Text color="green">assistant: </Text>
      <Text>{text}</Text>
    </Box>
  )
}
```

Create `packages/cli/src/chat/components/ToolResultCard.tsx`:

```tsx
import { Box, Text } from 'ink'

export type ToolResultCardProps = {
  name: string
  result?: string
  error?: string
}

export function ToolResultCard({ name, result, error }: ToolResultCardProps) {
  const isError = error != null
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={isError ? 'red' : 'gray'}>
      <Text color={isError ? 'red' : 'yellow'}>tool · {name}</Text>
      <Text>{isError ? error : result}</Text>
    </Box>
  )
}
```

Create `packages/cli/src/chat/components/SystemNotice.tsx`:

```tsx
import { Box, Text } from 'ink'

export type SystemNoticeVariant = 'info' | 'warning' | 'error' | 'success'

export type SystemNoticeProps = {
  variant?: SystemNoticeVariant
  text: string
}

const COLOR: Record<SystemNoticeVariant, string> = {
  info: 'blue',
  warning: 'yellow',
  error: 'red',
  success: 'green',
}

export function SystemNotice({ variant = 'info', text }: SystemNoticeProps) {
  return (
    <Box>
      <Text color={COLOR[variant]}>[{variant}] </Text>
      <Text>{text}</Text>
    </Box>
  )
}
```

- [ ] **Step 4: Run tests; expect PASS**

Run: `pnpm --filter mokei test:unit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/chat/components/UserMessage.tsx packages/cli/src/chat/components/AssistantMessage.tsx packages/cli/src/chat/components/ToolResultCard.tsx packages/cli/src/chat/components/SystemNotice.tsx packages/cli/test/chat/components.test.tsx
git commit -m "feat(cli-ink): message + notice primitives"
```

---

### Task 14: Streaming text + tool approval + pending turn

**Files:**
- Create: `packages/cli/src/chat/components/AssistantStreamingText.tsx`
- Create: `packages/cli/src/chat/components/ToolCallStatus.tsx`
- Create: `packages/cli/src/chat/components/ToolApprovalCard.tsx`
- Create: `packages/cli/src/chat/components/PendingTurn.tsx`
- Modify: `packages/cli/test/chat/components.test.tsx` (add cases)

- [ ] **Step 1: Add tests for the new components**

Append to `packages/cli/test/chat/components.test.tsx`:

```tsx
import { AssistantStreamingText } from '../../src/chat/components/AssistantStreamingText.js'
import { ToolApprovalCard } from '../../src/chat/components/ToolApprovalCard.js'
import { ToolCallStatus } from '../../src/chat/components/ToolCallStatus.js'

describe('streaming + approval', () => {
  test('AssistantStreamingText shows the current delta', () => {
    const { lastFrame } = render(<AssistantStreamingText text="partial" />)
    expect(lastFrame()).toContain('partial')
  })

  test('ToolApprovalCard shows the tool name and arguments', () => {
    const { lastFrame } = render(
      <ToolApprovalCard
        call={{ id: '1', name: 'ctx:write', arguments: '{"path":"/x"}' }}
        onApprove={() => {}}
        onDeny={() => {}}
      />,
    )
    expect(lastFrame()).toContain('ctx:write')
    expect(lastFrame()).toContain('/x')
  })

  test('ToolCallStatus shows the tool name and phase label', () => {
    const { lastFrame } = render(<ToolCallStatus name="ctx:read" phase="calling" />)
    expect(lastFrame()).toContain('ctx:read')
    expect(lastFrame()).toMatch(/calling/i)
  })
})
```

- [ ] **Step 2: Run tests; expect FAIL**

Run: `pnpm --filter mokei test:unit`
Expected: modules not found.

- [ ] **Step 3: Implement components**

`AssistantStreamingText.tsx`:

```tsx
import { Box, Text } from 'ink'

export type AssistantStreamingTextProps = { text: string }

export function AssistantStreamingText({ text }: AssistantStreamingTextProps) {
  return (
    <Box>
      <Text color="green">assistant: </Text>
      <Text>{text}</Text>
    </Box>
  )
}
```

`ToolCallStatus.tsx`:

```tsx
import { Box, Text } from 'ink'
import { Spinner } from '@inkjs/ui'

export type ToolCallStatusProps = {
  name: string
  phase: 'calling' | 'done' | 'failed'
}

export function ToolCallStatus({ name, phase }: ToolCallStatusProps) {
  return (
    <Box>
      {phase === 'calling' ? <Spinner /> : <Text>· </Text>}
      <Text color={phase === 'failed' ? 'red' : 'yellow'}> {phase} {name}</Text>
    </Box>
  )
}
```

`ToolApprovalCard.tsx`:

```tsx
import { Box, Text, useInput } from 'ink'

import type { FunctionToolCall } from '@mokei/session'

export type ToolApprovalCardProps = {
  call: FunctionToolCall<unknown>
  onApprove: () => void
  onDeny: () => void
}

export function ToolApprovalCard({ call, onApprove, onDeny }: ToolApprovalCardProps) {
  useInput((input, key) => {
    if (key.escape) {
      onDeny()
      return
    }
    const ch = input.toLowerCase()
    if (ch === 'y' || key.return) onApprove()
    else if (ch === 'n') onDeny()
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow">
      <Text color="yellow">approve tool call?</Text>
      <Text>tool: {call.name}</Text>
      <Text>args: {call.arguments}</Text>
      <Text dimColor>[y] approve   [n / esc] deny</Text>
    </Box>
  )
}
```

`PendingTurn.tsx`:

```tsx
import { Box } from 'ink'

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
  if (turn.state === 'idle') return null

  return (
    <Box flexDirection="column">
      {turn.currentText !== '' ? <AssistantStreamingText text={turn.currentText} /> : null}
      {turn.state === 'awaiting-approval' && pending != null ? (
        <ToolApprovalCard call={pending.call} onApprove={onApprove} onDeny={onDeny} />
      ) : null}
      {turn.state === 'calling-tool' && turn.pendingCall != null ? (
        <ToolCallStatus name={turn.pendingCall.name} phase="calling" />
      ) : null}
    </Box>
  )
}
```

- [ ] **Step 4: Run tests; expect PASS**

Run: `pnpm --filter mokei test:unit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/chat/components packages/cli/test/chat/components.test.tsx
git commit -m "feat(cli-ink): streaming + tool approval components"
```

---

### Task 15: Footer + status + select cards + help card

**Files:**
- Create: `packages/cli/src/chat/components/StatusLine.tsx`
- Create: `packages/cli/src/chat/components/Footer.tsx`
- Create: `packages/cli/src/chat/components/ModelSelectCard.tsx`
- Create: `packages/cli/src/chat/components/ToolSelectCard.tsx`
- Create: `packages/cli/src/chat/components/HelpCard.tsx`

- [ ] **Step 1: Add tests**

Append to `packages/cli/test/chat/components.test.tsx`:

```tsx
import { Footer } from '../../src/chat/components/Footer.js'
import { HelpCard } from '../../src/chat/components/HelpCard.js'
import { ModelSelectCard } from '../../src/chat/components/ModelSelectCard.js'
import { StatusLine } from '../../src/chat/components/StatusLine.js'
import { ToolSelectCard } from '../../src/chat/components/ToolSelectCard.js'

describe('footer + selects + help', () => {
  test('StatusLine shows model and streaming state', () => {
    const { lastFrame } = render(
      <StatusLine model="claude-3" state="streaming" contexts={['sqlite']} />,
    )
    expect(lastFrame()).toContain('claude-3')
    expect(lastFrame()).toContain('sqlite')
  })

  test('Footer embeds StatusLine and the input prompt', () => {
    const { lastFrame } = render(
      <Footer
        model="claude-3"
        state="idle"
        contexts={[]}
        onSubmit={() => {}}
      />,
    )
    expect(lastFrame()).toContain('claude-3')
    expect(lastFrame()).toContain('›')
  })

  test('ModelSelectCard renders each model id', () => {
    const { lastFrame } = render(
      <ModelSelectCard models={[{ id: 'a' }, { id: 'b' }]} onSelect={() => {}} onCancel={() => {}} />,
    )
    expect(lastFrame()).toContain('a')
    expect(lastFrame()).toContain('b')
  })

  test('ToolSelectCard renders each tool option', () => {
    const { lastFrame } = render(
      <ToolSelectCard
        groups={[{ contextKey: 'ctx', tools: [{ id: 'ctx:x', name: 'x', description: 'd', enabled: true }] }]}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(lastFrame()).toContain('ctx:x')
  })

  test('HelpCard lists known commands', () => {
    const { lastFrame } = render(<HelpCard />)
    expect(lastFrame()).toContain('/help')
    expect(lastFrame()).toContain('/context')
    expect(lastFrame()).toContain('/model')
    expect(lastFrame()).toContain('/tools')
    expect(lastFrame()).toContain('/quit')
  })
})
```

- [ ] **Step 2: Run tests; expect FAIL**

Run: `pnpm --filter mokei test:unit`
Expected: modules not found.

- [ ] **Step 3: Implement**

`StatusLine.tsx`:

```tsx
import { Box, Text } from 'ink'
import { Spinner } from '@inkjs/ui'

import type { TurnStateName } from '../turn-reducer.js'

export type StatusLineProps = {
  model: string
  state: TurnStateName
  contexts: Array<string>
}

export function StatusLine({ model, state, contexts }: StatusLineProps) {
  const busy = state !== 'idle'
  return (
    <Box>
      {busy ? <Spinner /> : null}
      <Text color="magenta"> {model} </Text>
      <Text color="gray">· {state} </Text>
      {contexts.length > 0 ? (
        <Text color="blue">· ctx: {contexts.join(',')}</Text>
      ) : null}
    </Box>
  )
}
```

`Footer.tsx`:

```tsx
import { Box, Text } from 'ink'
import { TextInput } from '@inkjs/ui'

import type { TurnStateName } from '../turn-reducer.js'
import { StatusLine } from './StatusLine.js'

export type FooterProps = {
  model: string
  state: TurnStateName
  contexts: Array<string>
  onSubmit: (value: string) => void
  placeholder?: string
}

export function Footer({ model, state, contexts, onSubmit, placeholder }: FooterProps) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <StatusLine model={model} state={state} contexts={contexts} />
      <Box>
        <Text color="cyan">› </Text>
        <TextInput placeholder={placeholder ?? 'type a message or /help'} onSubmit={onSubmit} />
      </Box>
    </Box>
  )
}
```

`ModelSelectCard.tsx`:

```tsx
import { Box, Text, useInput } from 'ink'
import { Select } from '@inkjs/ui'

export type ModelOption = { id: string }

export type ModelSelectCardProps = {
  models: Array<ModelOption>
  onSelect: (id: string) => void
  onCancel: () => void
}

export function ModelSelectCard({ models, onSelect, onCancel }: ModelSelectCardProps) {
  useInput((_, key) => {
    if (key.escape) onCancel()
  })
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta">
      <Text color="magenta">select a model</Text>
      <Select
        options={models.map((m) => ({ label: m.id, value: m.id }))}
        onChange={(value) => onSelect(value)}
      />
      <Text dimColor>[esc] cancel</Text>
    </Box>
  )
}
```

`ToolSelectCard.tsx`:

```tsx
import { Box, Text, useInput } from 'ink'
import { MultiSelect } from '@inkjs/ui'

export type ToolOption = {
  id: string
  name: string
  description?: string
  enabled: boolean
}

export type ToolGroup = {
  contextKey: string
  tools: Array<ToolOption>
}

export type ToolSelectCardProps = {
  groups: Array<ToolGroup>
  onConfirm: (enabledIDs: Array<string>) => void
  onCancel: () => void
}

export function ToolSelectCard({ groups, onConfirm, onCancel }: ToolSelectCardProps) {
  useInput((_, key) => {
    if (key.escape) onCancel()
  })
  const options = groups.flatMap((g) =>
    g.tools.map((t) => ({
      label: `${t.id} — ${t.description ?? t.name}`,
      value: t.id,
    })),
  )
  const defaultValue = groups.flatMap((g) => g.tools.filter((t) => t.enabled).map((t) => t.id))
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="blue">
      <Text color="blue">enable tools</Text>
      <MultiSelect options={options} defaultValue={defaultValue} onSubmit={onConfirm} />
      <Text dimColor>[enter] confirm   [esc] cancel</Text>
    </Box>
  )
}
```

`HelpCard.tsx`:

```tsx
import { Box, Text } from 'ink'

export function HelpCard() {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan">
      <Text color="cyan">commands</Text>
      <Text>/help                      show this help</Text>
      <Text>/context                   list contexts</Text>
      <Text>/context add KEY CMD ...   add MCP context</Text>
      <Text>/context remove KEY        remove context</Text>
      <Text>/model [id]                pick or switch model</Text>
      <Text>/tools                     enable/disable tools</Text>
      <Text>/quit, /exit               end session</Text>
      <Text>esc                        abort current turn</Text>
    </Box>
  )
}
```

- [ ] **Step 4: Run tests; expect PASS**

Run: `pnpm --filter mokei test:unit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/chat/components packages/cli/test/chat/components.test.tsx
git commit -m "feat(cli-ink): footer, status line, select cards, help card"
```

---

### Task 16: `<ChatApp>` root

**Files:**
- Create: `packages/cli/src/chat/ChatApp.tsx`
- Create: `packages/cli/test/chat/ChatApp.test.tsx`

- [ ] **Step 1: Write failing smoke test**

Create `packages/cli/test/chat/ChatApp.test.tsx`:

```tsx
import { render } from 'ink-testing-library'
import React from 'react'
import { describe, expect, test, vi } from 'vitest'

import { ChatApp } from '../../src/chat/ChatApp.js'

describe('ChatApp', () => {
  test('renders footer with the supplied model', () => {
    const stubSession = {
      events: { on: () => () => {} },
      addContext: vi.fn(),
      removeContext: vi.fn(),
      contextHost: { getContextKeys: () => [] },
      getProvider: () => ({
        listModels: async () => [{ id: 'stub-model', raw: {} }],
      }),
    }
    const stubProvider = {
      listModels: async () => [{ id: 'stub-model', raw: {} }],
    }
    const { lastFrame } = render(
      <ChatApp
        session={stubSession as never}
        provider={stubProvider as never}
        providerKey="anthropic"
        initialModel="stub-model"
      />,
    )
    expect(lastFrame()).toContain('stub-model')
    expect(lastFrame()).toContain('›')
  })
})
```

- [ ] **Step 2: Run test; expect FAIL**

Run: `pnpm --filter mokei test:unit`
Expected: module not found.

- [ ] **Step 3: Implement `ChatApp`**

Create `packages/cli/src/chat/ChatApp.tsx`:

```tsx
import { Box, Static, useApp, useInput } from 'ink'
import { useCallback, useMemo, useState } from 'react'

import { AgentSession, type ModelProvider, type ProviderTypes, type Session } from '@mokei/session'

import { AssistantMessage } from './components/AssistantMessage.js'
import { Footer } from './components/Footer.js'
import { HelpCard } from './components/HelpCard.js'
import { ModelSelectCard } from './components/ModelSelectCard.js'
import { PendingTurn } from './components/PendingTurn.js'
import { SystemNotice } from './components/SystemNotice.js'
import { ToolResultCard } from './components/ToolResultCard.js'
import { ToolSelectCard } from './components/ToolSelectCard.js'
import { UserMessage } from './components/UserMessage.js'
import { useAgentTurn } from './hooks/useAgentTurn.js'
import { useSession } from './hooks/useSession.js'
import { useToolApproval } from './hooks/useToolApproval.js'
import { parseSlash } from './slash.js'

type TranscriptEntry =
  | { kind: 'user'; id: number; text: string }
  | { kind: 'assistant'; id: number; text: string }
  | { kind: 'tool'; id: number; name: string; result?: string; error?: string }
  | { kind: 'notice'; id: number; variant: 'info' | 'warning' | 'error' | 'success'; text: string }

export type ChatAppProps<T extends ProviderTypes> = {
  session: Session<T>
  provider: ModelProvider<T>
  providerKey: string
  initialModel?: string
}

export function ChatApp<T extends ProviderTypes>(props: ChatAppProps<T>) {
  const { session, provider, providerKey, initialModel } = props
  const { exit } = useApp()
  const [model, setModel] = useState<string | undefined>(initialModel)
  const [transcript, setTranscript] = useState<Array<TranscriptEntry>>([])
  const [modal, setModal] = useState<null | 'model' | 'tools' | 'help'>(null)
  const [models, setModels] = useState<Array<{ id: string }>>([])

  const nextID = useMemo(() => {
    let n = 0
    return () => ++n
  }, [])

  const pushEntry = useCallback(
    (entry: Omit<TranscriptEntry, 'id'>) =>
      setTranscript((prev) => [...prev, { ...entry, id: nextID() } as TranscriptEntry]),
    [nextID],
  )

  const { contexts, addContext, removeContext } = useSession(session)
  const { pending, approve, deny, toolApprovalFn } = useToolApproval()

  const createAgent = useCallback(
    () =>
      new AgentSession<T>({
        session,
        provider: providerKey,
        model: model ?? '',
        toolApproval: toolApprovalFn,
      }),
    [session, providerKey, model, toolApprovalFn],
  )

  const turn = useAgentTurn<T>({ createAgent })

  const handleSubmit = useCallback(
    async (raw: string) => {
      const parsed = parseSlash(raw)
      if (parsed.kind === 'message') {
        if (parsed.text === '') return
        pushEntry({ kind: 'user', text: parsed.text })
        if (model == null) {
          const list = await provider.listModels()
          setModels(list)
          setModal('model')
          pushEntry({ kind: 'notice', variant: 'info', text: 'select a model to continue' })
          return
        }
        await turn.submit(parsed.text)
        if (turn.lastAssistantText !== '') {
          pushEntry({ kind: 'assistant', text: turn.lastAssistantText })
        }
        if (turn.lastError != null) {
          pushEntry({ kind: 'notice', variant: 'error', text: turn.lastError })
        }
        return
      }

      const { name, args } = parsed
      switch (name) {
        case 'help':
          setModal('help')
          break
        case 'quit':
        case 'exit':
          exit()
          break
        case 'context': {
          const [sub, ...rest] = args
          if (sub == null || sub === 'list') {
            pushEntry({
              kind: 'notice',
              variant: 'info',
              text: contexts.length === 0 ? 'no contexts' : `contexts: ${contexts.join(', ')}`,
            })
          } else if (sub === 'add') {
            const [key, command, ...cmdArgs] = rest
            if (!key || !command) {
              pushEntry({ kind: 'notice', variant: 'error', text: 'usage: /context add <key> <cmd> [args...]' })
              break
            }
            try {
              await addContext({ key, command, args: cmdArgs })
              pushEntry({ kind: 'notice', variant: 'success', text: `context ${key} added` })
            } catch (err) {
              pushEntry({ kind: 'notice', variant: 'error', text: (err as Error).message })
            }
          } else if (sub === 'remove') {
            const [key] = rest
            if (!key) {
              pushEntry({ kind: 'notice', variant: 'error', text: 'usage: /context remove <key>' })
              break
            }
            removeContext(key)
            pushEntry({ kind: 'notice', variant: 'success', text: `context ${key} removed` })
          } else {
            pushEntry({ kind: 'notice', variant: 'error', text: `unknown: /context ${sub}` })
          }
          break
        }
        case 'model': {
          const [id] = args
          if (id != null) {
            const list = await provider.listModels()
            if (list.some((m) => m.id === id)) {
              setModel(id)
              pushEntry({ kind: 'notice', variant: 'success', text: `model: ${id}` })
            } else {
              pushEntry({ kind: 'notice', variant: 'error', text: `unknown model: ${id}` })
            }
          } else {
            const list = await provider.listModels()
            setModels(list)
            setModal('model')
          }
          break
        }
        case 'tools':
          setModal('tools')
          break
        default:
          pushEntry({ kind: 'notice', variant: 'error', text: `unknown command: /${name}` })
      }
    },
    [addContext, contexts, exit, model, provider, pushEntry, removeContext, turn],
  )

  useInput((_, key) => {
    if (key.escape && turn.state !== 'idle' && turn.state !== 'awaiting-approval') {
      turn.abort()
    }
  })

  return (
    <Box flexDirection="column">
      <Static items={transcript}>
        {(entry) => {
          switch (entry.kind) {
            case 'user':
              return <UserMessage key={entry.id} text={entry.text} />
            case 'assistant':
              return <AssistantMessage key={entry.id} text={entry.text} />
            case 'tool':
              return <ToolResultCard key={entry.id} name={entry.name} result={entry.result} error={entry.error} />
            case 'notice':
              return <SystemNotice key={entry.id} variant={entry.variant} text={entry.text} />
          }
        }}
      </Static>

      <PendingTurn turn={turn} pending={pending} onApprove={approve} onDeny={deny} />

      {modal === 'model' ? (
        <ModelSelectCard
          models={models}
          onSelect={(id) => { setModel(id); setModal(null); pushEntry({ kind: 'notice', variant: 'success', text: `model: ${id}` }) }}
          onCancel={() => setModal(null)}
        />
      ) : null}

      {modal === 'tools' ? (
        <ToolSelectCard
          groups={Object.entries(session.contextHost.contexts).map(([key, ctx]) => ({
            contextKey: key,
            tools: ctx.tools.map((t) => ({
              id: t.id,
              name: t.tool.name,
              description: t.tool.description,
              enabled: t.enabled,
            })),
          }))}
          onConfirm={(enabled) => {
            for (const [key, ctx] of Object.entries(session.contextHost.contexts)) {
              session.contextHost.setContextTools(
                key,
                ctx.tools.map((t) => ({ ...t, enabled: enabled.includes(t.id) })),
              )
            }
            setModal(null)
          }}
          onCancel={() => setModal(null)}
        />
      ) : null}

      {modal === 'help' ? <HelpCard /> : null}

      <Footer model={model ?? '(no model)'} state={turn.state} contexts={contexts} onSubmit={handleSubmit} />
    </Box>
  )
}
```

Also record tool-call completion events into the transcript. Extend `useAgentTurn` consumers by listening to `tool-call-complete` / `tool-call-error` from the event stream: easiest is to pass an optional `onEvent` callback to `useAgentTurn` and route tool events into `pushEntry` — do this inline if the simpler version above doesn't capture tool result cards.

- [ ] **Step 4: Add `onEvent` to `useAgentTurn`**

Modify `packages/cli/src/chat/hooks/useAgentTurn.ts` to accept an optional `onEvent` callback and call it inside the stream loop:

```ts
export type UseAgentTurnParams<T extends ProviderTypes = ProviderTypes> = {
  createAgent: () => AgentSessionLike<T>
  onEvent?: (event: AgentEvent<T>) => void
}
```

And inside the loop, after `dispatch(event)`:

```ts
params.onEvent?.(event)
```

Update the existing hook test if needed (no assertion change, only signature).

- [ ] **Step 5: Wire `onEvent` in `ChatApp`**

Replace the `useAgentTurn` call in `ChatApp.tsx` with:

```tsx
const turn = useAgentTurn<T>({
  createAgent,
  onEvent: (event) => {
    if (event.type === 'tool-call-complete') {
      const text = event.result.content.find((c) => c.type === 'text')?.text
      pushEntry({ kind: 'tool', name: event.toolCall.name, result: text ?? '' })
    } else if (event.type === 'tool-call-error') {
      pushEntry({ kind: 'tool', name: event.toolCall.name, error: event.error.message })
    }
  },
})
```

- [ ] **Step 6: Run tests; expect PASS**

Run: `pnpm --filter mokei test:unit`
Expected: PASS (including the `ChatApp` smoke test).

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/chat/ChatApp.tsx packages/cli/src/chat/hooks/useAgentTurn.ts packages/cli/test/chat/ChatApp.test.tsx
git commit -m "feat(cli-ink): ChatApp root wiring transcript + modals + turn"
```

---

## Phase 5 — Anthropic wiring

### Task 17: Rewire `commands/chat/anthropic.tsx`

**Files:**
- Rename: `packages/cli/src/commands/chat/anthropic.ts` → `packages/cli/src/commands/chat/anthropic.tsx`
- Modify: the new `anthropic.tsx`

- [ ] **Step 1: Rename file**

```bash
git mv packages/cli/src/commands/chat/anthropic.ts packages/cli/src/commands/chat/anthropic.tsx
```

- [ ] **Step 2: Replace contents**

```tsx
import { AnthropicProvider, type AnthropicTypes } from '@mokei/anthropic-provider'
import { ProxyHost } from '@mokei/host'
import { Session } from '@mokei/session'
import { Command, Flags } from '@oclif/core'
import { render } from 'ink'
import React from 'react'

import { ChatApp } from '../../chat/ChatApp.js'
import { modelFlag, providerAPIFlag } from '../../flags.js'

export default class ChatAnthropic extends Command {
  static description = 'Interactive chat with a model provider using Anthropic APIs'

  static flags = {
    'api-key': Flags.string({
      char: 'k',
      description: 'Anthropic API key',
      env: 'ANTHROPIC_API_KEY',
    }),
    'api-url': providerAPIFlag,
    model: modelFlag,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ChatAnthropic)
    const host = await ProxyHost.forDaemon()
    const provider = new AnthropicProvider({
      client: { apiKey: flags['api-key'], baseURL: flags['api-url'], timeout: false },
    })
    const session = new Session<AnthropicTypes>({ providers: { anthropic: provider } })
    // ProxyHost is the CLI's remote host; replace session's local ContextHost with it via a setter if available,
    // otherwise use the session-owned contextHost and let the daemon-backed commands remain untouched for now.
    // (See open risk note in the design doc; if ProxyHost composition is blocked, keep daemon path via a direct
    // host prop and thread through ChatApp — left as follow-up.)

    const app = render(
      <ChatApp
        session={session as unknown as Session<AnthropicTypes>}
        provider={provider}
        providerKey="anthropic"
        initialModel={flags.model}
      />,
    )
    await app.waitUntilExit()
    await session.dispose()
    await host.dispose()
  }
}
```

> **Note for the executor:** `Session` in `@mokei/session` constructs its own `ContextHost` and does not accept a pre-made one. The daemon-backed `ProxyHost` used by the current CLI cannot be dropped in without a `Session` API change. If this blocks local tool/context usage for Anthropic, open a follow-up ticket and in the meantime connect `ChatApp` to the daemon host by passing `host` as a separate prop (extend `ChatAppProps` with an optional `host` and use it for `contextHost` operations). Do **not** silently drop the `ProxyHost`. Surface this as a blocker in the review if you hit it.

- [ ] **Step 3: Build + type-check**

Run: `pnpm --filter mokei build`
Expected: PASS

- [ ] **Step 4: Manual smoke test (QA gate — see Phase 6)**

Skip at this step; executed during QA.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/chat/anthropic.tsx
git commit -m "feat(cli-ink): mount ChatApp from chat anthropic command"
```

---

## Phase 6 — QA gate (Anthropic)

Manual — executor prompts the user.

- [ ] **Step 1: Ask the user to run `./bin/dev.js chat anthropic -k $ANTHROPIC_API_KEY` and confirm:**
  - Input prompt appears immediately.
  - Typing text + enter submits; streamed tokens render in the pending region; finalised message moves into the transcript on completion.
  - `/help`, `/model`, `/context`, `/tools`, `/quit` commands all behave per the spec.
  - Tool call approval card appears inline; `y` approves, `n` or `esc` denies; agent resumes.
  - `esc` during streaming aborts and returns to idle.
  - Ctrl-C exits cleanly.

- [ ] **Step 2: Do not proceed to Phase 7 until the user confirms the above.**

---

## Phase 7 — Ollama + OpenAI wiring

### Task 18: Swap `ollama.ts` to `.tsx`

**Files:**
- Rename: `packages/cli/src/commands/chat/ollama.ts` → `packages/cli/src/commands/chat/ollama.tsx`

- [ ] **Step 1: Rename + replace**

```bash
git mv packages/cli/src/commands/chat/ollama.ts packages/cli/src/commands/chat/ollama.tsx
```

Contents:

```tsx
import { ProxyHost } from '@mokei/host'
import { OllamaProvider, type OllamaTypes } from '@mokei/ollama-provider'
import { Session } from '@mokei/session'
import { Command } from '@oclif/core'
import { render } from 'ink'
import React from 'react'

import { ChatApp } from '../../chat/ChatApp.js'
import { modelFlag, providerAPIFlag } from '../../flags.js'

export default class ChatOllama extends Command {
  static description = 'Interactive chat with a local model'

  static flags = {
    'api-url': providerAPIFlag,
    model: modelFlag,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ChatOllama)
    const host = await ProxyHost.forDaemon()
    const provider = new OllamaProvider({ client: { baseURL: flags['api-url'], timeout: false } })
    const session = new Session<OllamaTypes>({ providers: { ollama: provider } })
    const app = render(
      <ChatApp
        session={session as unknown as Session<OllamaTypes>}
        provider={provider}
        providerKey="ollama"
        initialModel={flags.model}
      />,
    )
    await app.waitUntilExit()
    await session.dispose()
    await host.dispose()
  }
}
```

- [ ] **Step 2: Build**

Run: `pnpm --filter mokei build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/commands/chat/ollama.tsx
git commit -m "feat(cli-ink): mount ChatApp from chat ollama command"
```

---

### Task 19: Swap `openai.ts` to `.tsx`

**Files:**
- Rename: `packages/cli/src/commands/chat/openai.ts` → `packages/cli/src/commands/chat/openai.tsx`

- [ ] **Step 1: Rename + replace**

```bash
git mv packages/cli/src/commands/chat/openai.ts packages/cli/src/commands/chat/openai.tsx
```

Contents:

```tsx
import { ProxyHost } from '@mokei/host'
import { OpenAIProvider, type OpenAITypes } from '@mokei/openai-provider'
import { Session } from '@mokei/session'
import { Command, Flags } from '@oclif/core'
import { render } from 'ink'
import React from 'react'

import { ChatApp } from '../../chat/ChatApp.js'
import { modelFlag, providerAPIFlag } from '../../flags.js'

export default class ChatOpenAI extends Command {
  static description = 'Interactive chat with a model provider using OpenAI APIs'

  static flags = {
    'api-key': Flags.string({
      char: 'k',
      description: 'OpenAI API key',
      env: 'OPENAI_API_KEY',
    }),
    'api-url': providerAPIFlag,
    model: modelFlag,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ChatOpenAI)
    const host = await ProxyHost.forDaemon()
    const provider = new OpenAIProvider({
      client: { apiKey: flags['api-key'], baseURL: flags['api-url'], timeout: false },
    })
    const session = new Session<OpenAITypes>({ providers: { openai: provider } })
    const app = render(
      <ChatApp
        session={session as unknown as Session<OpenAITypes>}
        provider={provider}
        providerKey="openai"
        initialModel={flags.model}
      />,
    )
    await app.waitUntilExit()
    await session.dispose()
    await host.dispose()
  }
}
```

- [ ] **Step 2: Build**

Run: `pnpm --filter mokei build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/commands/chat/openai.tsx
git commit -m "feat(cli-ink): mount ChatApp from chat openai command"
```

---

## Phase 8 — Cleanup

### Task 20: Delete `chat-session.ts` + `prompt.ts`

**Files:**
- Delete: `packages/cli/src/chat-session.ts`
- Delete: `packages/cli/src/prompt.ts`

- [ ] **Step 1: Confirm no imports remain**

Run: `grep -rn "chat-session\|from './prompt" packages/cli/src`
Expected: no matches.

- [ ] **Step 2: Delete**

```bash
git rm packages/cli/src/chat-session.ts packages/cli/src/prompt.ts
```

- [ ] **Step 3: Build + test**

Run: `pnpm --filter mokei build && pnpm --filter mokei test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(cli-ink): remove legacy chat-session and enquirer prompt helpers"
```

---

### Task 21: Measure bundle size + startup

**Files:** none

- [ ] **Step 1: Pack and record size**

Run: `pnpm --filter mokei pack --pack-destination /tmp`
Record the resulting tarball size.

- [ ] **Step 2: Time help command**

Run: `time ./packages/cli/bin/run.js chat anthropic --help`
Record real time.

- [ ] **Step 3: Append results to the completion note**

Put both numbers in the `/complete` summary so they end up in `docs/agents/plans/completed/<date>-cli-chat-ink.complete.md`.

No commit — measurements only.

---

## Spec coverage map

| Spec section | Task(s) |
|---|---|
| Core changes to `@mokei/session` | 1–3 |
| CLI package layout / `chat/` subdir | 7 |
| Component tree | 13–16 |
| Hooks table (`useSession`, `useAgentTurn`, `useToolApproval`) | 9, 10, 11, 12 |
| `useSlashCommand` | folded into `ChatApp.handleSubmit` (Task 16) driven by `parseSlash` (Task 8) |
| `useAbort` | folded into `ChatApp` `useInput` (Task 16) |
| Slash command surface | 8 + 16 |
| Tool approval bridge | 9, 14, 16 |
| Abort flow | 16 (+ SIGINT safety net left in place) |
| Error surfacing | 16 (notice entries for error/timeout/max-iterations) |
| Build pipeline | 4, 5, 6 |
| Testing | 3, 8, 9, 10, 11, 12, 13, 14, 15, 16 |
| Migration order (Anthropic first, then Ollama + OpenAI, then cleanup) | 17 → 6 (QA) → 18, 19, 20 |
| Bundle/startup measurements | 21 |

## Open risks tracked in plan

- **Session + ProxyHost composition** — `Session` owns its own `ContextHost`, so the daemon-backed `ProxyHost` used by existing commands does not fit as-is. Task 17 flags this for the executor; if it blocks Anthropic QA, open a follow-up to either (a) let `Session` accept a pre-built host, or (b) pass `host` through `ChatAppProps` and route context/tool operations through it instead of `session`.
- **SWC JSX in a single package** — verified strategy: package-local `swc.json`, `--config-file ./swc.json` in `build:dist`. Other packages still use the root config.
- **Bundle size** — measured in Task 21; expected +2–3 MB.
