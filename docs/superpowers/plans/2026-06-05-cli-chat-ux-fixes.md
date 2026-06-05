# CLI Chat UX Fixes + e2e Suites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the parity gaps and Important issues found in the code review of the Ink chat refactor, and lock the behaviour in with split PTY-driven e2e suites.

**Architecture:** Fixes land in `@mokei/session` (one method return type) and `packages/cli/src/chat` (hooks, ChatApp wiring, two small components). e2e coverage moves from one `cli.test.ts` into three concern-split suites sharing the existing `ChatDriver`, which gains a few helpers and learns the new post-add tool-select step.

**Tech Stack:** TypeScript (ESM, `.js` suffixes), React + Ink, `@inkjs/ui`, vitest, node-pty (PTY e2e), ollama (`lfm2.5:latest`) + built fetch MCP server.

---

## Context

The review of `feat/cli-refactoring` (base `803d787`, head `ab2c76f`) confirmed the new Ink UI covers the old `ChatSession` functionally, but found:

- **Bug (Important #1):** input is enabled during an active turn (`Footer` disables only on `modal != null`), and `useAgentTurn.submit` has no in-flight guard — a second submit starts a second `AgentSession` into the same reducer and orphans the first turn's abort controller, so the first turn can no longer be cancelled.
- **Important #2:** `anthropic.tsx` does `void session.dispose(); process.exit(0)` — exits before daemon/MCP teardown (ollama/openai await).
- **Important #3:** `/context remove` is unconfirmed, fire-and-forget, and reports success even when the key doesn't exist.
- **Minor:** an orphaned `useToolApproval.pending` resolver lingers if a turn aborts while awaiting approval.
- **Regression:** `/context add` auto-enables all tools (old flow let you pick).

Product decisions (confirmed with the user):
1. `/context add` → auto-enable all, then **immediately open the tool-select card** so the user can deselect (reuses `ToolSelectCard`).
2. `/context remove` → **confirmation card** + report based on the actual remove result.
3. e2e suites **split by concern**: `cli-chat.test.ts` (core/cancel/model), `cli-chat-context.test.ts` (context lifecycle), `cli-chat-tools.test.ts` (approval/deny/tools card).
4. SIGINT→Esc redesign is intentional — **not** changed.

Intended outcome: cancel works reliably (no orphaned turns), clean disposal on all three providers, safe/confirmed context removal, restored tool-enable granularity at add time, and durable e2e coverage of these flows.

---

## File Structure

**Modify**
- `packages/session/src/session.ts` — `removeContext` returns `boolean`.
- `packages/cli/src/chat/hooks/useAgentTurn.ts` — in-flight guard in `submit`.
- `packages/cli/src/chat/hooks/useSession.ts` — `removeContext` returns `boolean`.
- `packages/cli/src/chat/ChatApp.tsx` — disable input during turns; post-add tool-select; remove-confirm flow; orphan-pending cleanup.
- `packages/cli/src/commands/chat/anthropic.tsx` — await disposal.
- `integration-tests/support/chat-driver.ts` — helpers + post-add card handling.

**Create**
- `packages/cli/src/chat/components/ConfirmCard.tsx` — y/n confirm card.
- `packages/cli/test/chat/ConfirmCard.test.tsx` — unit.
- `integration-tests/suites/cli-chat.test.ts`, `cli-chat-context.test.ts`, `cli-chat-tools.test.ts` (replacing `cli.test.ts`).

**Reuse (do not reinvent)**
- `ToolSelectCard` (`packages/cli/src/chat/components/ToolSelectCard.tsx`) — `{ groups, onConfirm(enabledIDs), onCancel }`.
- `ToolApprovalCard` (`.../ToolApprovalCard.tsx`) — pattern for `ConfirmCard` (`useInput`: esc→deny, `y`/return→approve, `n`→deny).
- `ContextHost.remove(key): boolean` (`packages/host/src/host.ts:257`) — sync, returns whether a context was removed.
- `ChatDriver` + `UI` constants (`integration-tests/support/chat-driver.ts`).

---

## Task 1: Concurrent-turn guard

**Files:**
- Modify: `packages/cli/src/chat/hooks/useAgentTurn.ts`
- Modify: `packages/cli/src/chat/ChatApp.tsx:511`
- Test: `packages/cli/test/chat/useAgentTurn.test.tsx`

- [ ] **Step 1: Write the failing test** — append to `useAgentTurn.test.tsx` (uses the file's existing `renderHook` helper + a controllable agent stub; mirror the patterns already in that file):

```tsx
test('submit is a no-op while a turn is already active', async () => {
  let createCount = 0
  const agent = {
    // never-resolving stream keeps the turn "active"
    stream: () => {
      createCount++
      return (async function* () {
        await new Promise(() => {})
      })()
    },
  }
  const { result } = renderHook(() => useAgentTurn({ createAgent: () => agent }))

  await act(async () => {
    result.current.submit('first')
    await Promise.resolve()
  })
  await act(async () => {
    result.current.submit('second')
    await Promise.resolve()
  })

  expect(createCount).toBe(1) // second submit short-circuited
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter mokei exec vitest run test/chat/useAgentTurn.test.tsx -t "no-op while a turn"`
Expected: FAIL (`createCount` is 2 — second submit started a second stream).

- [ ] **Step 3: Add the guard** in `useAgentTurn.ts` `submit`, right after the empty-text check:

```ts
const submit = useCallback(
  async (text: string) => {
    if (text.trim() === '') return
    if (abortRef.current != null) return // a turn is already in flight
    const controller = new AbortController()
    abortRef.current = controller
    // ...unchanged...
  },
  [createAgent, onEvent],
)
```

- [ ] **Step 4: Run it, verify it passes**

Run: `pnpm --filter mokei exec vitest run test/chat/useAgentTurn.test.tsx`
Expected: PASS (all tests in file).

- [ ] **Step 5: Disable the footer input during a turn** — `ChatApp.tsx:511`:

```tsx
disabled={modal != null || confirmRemove != null || turn.state !== 'idle'}
```

(`confirmRemove` state is added in Task 3; if implementing Task 1 alone first, use `disabled={modal != null || turn.state !== 'idle'}` and add `confirmRemove` when Task 3 lands.)

- [ ] **Step 6: Run cli typecheck + unit tests**

Run: `pnpm --filter mokei exec tsc --noEmit --skipLibCheck && pnpm --filter mokei exec vitest run`
Expected: types clean; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/chat/hooks/useAgentTurn.ts packages/cli/src/chat/ChatApp.tsx packages/cli/test/chat/useAgentTurn.test.tsx
git commit -m "fix(cli): block concurrent turns; disable input while streaming"
```

---

## Task 2: Await disposal in the anthropic command

**Files:**
- Modify: `packages/cli/src/commands/chat/anthropic.tsx:45-47`

- [ ] **Step 1: Replace the fire-and-forget disposal** to match `ollama.tsx`/`openai.tsx`:

```tsx
    await app.waitUntilExit()
    await session.dispose()
```

(Delete the `void session.dispose()` and `process.exit(0)` lines.)

- [ ] **Step 2: Verify the three commands match**

Run: `grep -n "session.dispose" packages/cli/src/commands/chat/*.tsx`
Expected: each of `anthropic.tsx`, `ollama.tsx`, `openai.tsx` shows `await session.dispose()` and none calls `process.exit`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter mokei exec tsc --noEmit --skipLibCheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/commands/chat/anthropic.tsx
git commit -m "fix(cli): await session disposal in anthropic chat command"
```

---

## Task 3: ConfirmCard + confirmed `/context remove`

**Files:**
- Create: `packages/cli/src/chat/components/ConfirmCard.tsx`
- Create: `packages/cli/test/chat/ConfirmCard.test.tsx`
- Modify: `packages/session/src/session.ts:183-186`
- Modify: `packages/cli/src/chat/hooks/useSession.ts:32`
- Modify: `packages/cli/src/chat/ChatApp.tsx` (remove branch, render, state)

- [ ] **Step 1: Write the failing ConfirmCard test** — `packages/cli/test/chat/ConfirmCard.test.tsx`:

```tsx
import { render } from 'ink-testing-library'
import { describe, expect, test, vi } from 'vitest'

import { ConfirmCard } from '../../src/chat/components/ConfirmCard.js'

describe('ConfirmCard', () => {
  test("renders the message and 'y' confirms", () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const { lastFrame, stdin } = render(
      <ConfirmCard message="remove context fetch?" onConfirm={onConfirm} onCancel={onCancel} />,
    )
    expect(lastFrame()).toContain('remove context fetch?')
    stdin.write('y')
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onCancel).not.toHaveBeenCalled()
  })

  test("'n' cancels", () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const { stdin } = render(
      <ConfirmCard message="x?" onConfirm={onConfirm} onCancel={onCancel} />,
    )
    stdin.write('n')
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  test('esc cancels', () => {
    const onCancel = vi.fn()
    const { stdin } = render(<ConfirmCard message="x?" onConfirm={() => {}} onCancel={onCancel} />)
    stdin.write('\x1b')
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter mokei exec vitest run test/chat/ConfirmCard.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Create ConfirmCard** — `packages/cli/src/chat/components/ConfirmCard.tsx` (mirrors `ToolApprovalCard`):

```tsx
import { Box, Text, useInput } from 'ink'

export type ConfirmCardProps = {
  message: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmCard({ message, onConfirm, onCancel }: ConfirmCardProps) {
  useInput((input, key) => {
    if (key.escape) {
      onCancel()
      return
    }
    const ch = input.toLowerCase()
    if (ch === 'y' || key.return) onConfirm()
    else if (ch === 'n') onCancel()
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow">
      <Text color="yellow">{message}</Text>
      <Text dimColor>[y / enter] confirm [n / esc] cancel</Text>
    </Box>
  )
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `pnpm --filter mokei exec vitest run test/chat/ConfirmCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Make `removeContext` report success** — `packages/session/src/session.ts`:

```ts
removeContext(key: string): boolean {
  const removed = this.#contextHost.remove(key)
  if (removed) {
    this.#events.emit('context-removed', { key })
  }
  return removed
}
```

And `packages/cli/src/chat/hooks/useSession.ts:32`:

```ts
const removeContext = useCallback((key: string): boolean => session.removeContext(key), [session])
```

- [ ] **Step 6: Wire the confirm flow in ChatApp** — add state near the other modal state (`ChatApp.tsx`):

```tsx
const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
```

Import the card:

```tsx
import { ConfirmCard } from './components/ConfirmCard.js'
```

Replace the `sub === 'remove'` branch body:

```tsx
} else if (sub === 'remove') {
  const [key] = rest
  if (!key) {
    pushEntry({ kind: 'notice', variant: 'error', text: 'usage: /context remove <key>' })
    break
  }
  if (!contexts.includes(key)) {
    pushEntry({ kind: 'notice', variant: 'error', text: `unknown context: ${key}` })
    break
  }
  setConfirmRemove(key)
}
```

Render the card (next to the other modals, e.g. after the `help` modal block):

```tsx
{confirmRemove != null ? (
  <ConfirmCard
    message={`remove context ${confirmRemove}?`}
    onConfirm={() => {
      const key = confirmRemove
      setConfirmRemove(null)
      const removed = removeContext(key)
      pushEntry(
        removed
          ? { kind: 'notice', variant: 'success', text: `context ${key} removed` }
          : { kind: 'notice', variant: 'error', text: `context ${key} not found` },
      )
    }}
    onCancel={() => {
      setConfirmRemove(null)
      pushEntry({ kind: 'notice', variant: 'info', text: 'remove cancelled' })
    }}
  />
) : null}
```

Add `confirmRemove` to `handleSubmit`'s dependency array.

- [ ] **Step 7: Run session + cli unit tests + typecheck**

Run: `pnpm --filter @mokei/session exec vitest run && pnpm --filter mokei exec vitest run && pnpm --filter mokei exec tsc --noEmit --skipLibCheck`
Expected: all pass, types clean.

- [ ] **Step 8: Commit**

```bash
git add packages/session/src/session.ts packages/cli/src/chat/hooks/useSession.ts packages/cli/src/chat/components/ConfirmCard.tsx packages/cli/test/chat/ConfirmCard.test.tsx packages/cli/src/chat/ChatApp.tsx
git commit -m "feat(cli): confirm context removal and report the actual result"
```

---

## Task 4: Tool-select prompt after `/context add`

**Files:**
- Modify: `packages/cli/src/chat/ChatApp.tsx` (the `sub === 'add'` success branch)

- [ ] **Step 1: Open the tool-select card after a successful add** — replace the success `pushEntry` in the `add` branch:

```tsx
try {
  const tools = await addContext({ key, command, args: cmdArgs })
  pushEntry({
    kind: 'notice',
    variant: 'success',
    text: `context ${key} added (${tools.length} tool(s) enabled — deselect any below)`,
  })
  if (tools.length > 0) {
    setModal('tools') // reuse ToolSelectCard so the user can deselect
  }
} catch (err) {
  pushEntry({ kind: 'notice', variant: 'error', text: (err as Error).message })
}
```

(`addContext` already resolves to the context's tools via `Session.addContext`; the existing `modal === 'tools'` render shows all contexts incl. the new one and persists via `setContextTools`.)

- [ ] **Step 2: Manual smoke (no automated unit — covered by e2e Task 7)**

Run: `pnpm --filter mokei build` then `./bin/dev.js chat ollama --model lfm2.5:latest`, `/context add fetch node ../../mcp-servers/fetch/lib/serve.js`
Expected: "context fetch added (1 tool(s) enabled …)" then the **enable tools** card appears; enter keeps all.

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm --filter mokei exec tsc --noEmit --skipLibCheck`

```bash
git add packages/cli/src/chat/ChatApp.tsx
git commit -m "feat(cli): offer tool selection right after adding a context"
```

---

## Task 5: Clear orphaned approval prompt on turn end

**Files:**
- Modify: `packages/cli/src/chat/ChatApp.tsx` (add effect)

- [ ] **Step 1: Add the cleanup effect** (near the `pendingPrompt` effect):

```tsx
// If a turn ends (abort/timeout) while a tool approval is still pending, the
// approval promise's resolver is orphaned — deny it so useToolApproval clears.
useEffect(() => {
  if (turn.state === 'idle' && pending != null) {
    deny()
  }
}, [turn.state, pending, deny])
```

- [ ] **Step 2: Typecheck + run cli tests**

Run: `pnpm --filter mokei exec tsc --noEmit --skipLibCheck && pnpm --filter mokei exec vitest run`
Expected: clean / pass.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/chat/ChatApp.tsx
git commit -m "fix(cli): clear a pending tool approval when the turn ends"
```

---

## Task 6: Extend ChatDriver + split the e2e suite

**Files:**
- Modify: `integration-tests/support/chat-driver.ts`
- Delete: `integration-tests/suites/cli.test.ts` (content redistributed in Tasks 7–9)

- [ ] **Step 1: Teach `addFetchContext` about the new post-add tool card** — it now blocks input until confirmed. Update the method in `chat-driver.ts`:

```ts
async addFetchContext(timeoutMs = 15_000): Promise<boolean> {
  await this.type(`/context add fetch node ${FETCH_SERVER}`)
  await delay(300)
  this.write('\r')
  const added = await this.waitFor(UI.contextAdded, timeoutMs)
  // New flow: a tool-select card opens after add — accept the defaults (all enabled).
  if (await this.waitFor('enable tools', 5_000)) {
    this.write('\r')
  }
  return added
}
```

- [ ] **Step 2: Add helpers** to `ChatDriver`:

```ts
/** Wait for the tool-approval card. */
waitForApproval(timeoutMs = 45_000): Promise<boolean> {
  return this.waitFor(UI.approval, timeoutMs)
}

/** Wait for the confirm-removal card. */
waitForConfirm(timeoutMs = 5_000): Promise<boolean> {
  return this.waitFor('confirm', timeoutMs)
}
```

Add to the exported `UI` constant:

```ts
toolSelect: 'enable tools',
confirm: 'confirm',
denied: 'tool denied',
removed: 'removed',
```

- [ ] **Step 3: Remove the old combined suite**

```bash
git rm integration-tests/suites/cli.test.ts
```

- [ ] **Step 4: Commit (driver only; suites added next)**

```bash
git add integration-tests/support/chat-driver.ts
git commit -m "test(integration): chat driver handles post-add tool card; add helpers"
```

---

## Task 7: `cli-chat.test.ts` — core chat + cancel

**Files:**
- Create: `integration-tests/suites/cli-chat.test.ts`

- [ ] **Step 1: Write the suite** (moves the core/cancel cases from the old `cli.test.ts`):

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { ChatDriver, UI } from '../support/chat-driver.js'

const PROMPT = 'fetch info about https://mokei.dev and provide a summary'

describe('CLI chat — core', () => {
  let driver: ChatDriver

  beforeEach(async () => {
    driver = new ChatDriver()
    expect(await driver.start()).toBe(true)
    expect(await driver.addFetchContext()).toBe(true)
  })

  afterEach(() => driver.kill())

  test('approve a tool call through to a final answer', async () => {
    await driver.submit(PROMPT)
    expect(await driver.waitForApproval()).toBe(true)
    driver.approve()
    expect(await driver.waitForIdle(90_000)).toBe(true)
    expect(driver.screen()).toContain(UI.assistant)
  }, 150_000)

  test('esc cancels while the model is thinking', async () => {
    await driver.submit(PROMPT)
    expect(await driver.waitFor(UI.thinking, 30_000)).toBe(true)
    driver.esc()
    expect(await driver.waitForIdle(10_000)).toBe(true)
    expect(driver.screen()).toContain(UI.aborted)
  }, 90_000)
})
```

- [ ] **Step 2: Build the cli (dev binary loads `dist`) + run**

Run: `pnpm --filter mokei build && pnpm --filter mokei-integration-tests exec vitest run suites/cli-chat.test.ts`
Expected: 2 pass (requires ollama + `lfm2.5:latest` + built fetch server).

- [ ] **Step 3: Commit**

```bash
git add integration-tests/suites/cli-chat.test.ts
git commit -m "test(integration): cli-chat core (approve + cancel)"
```

---

## Task 8: `cli-chat-context.test.ts` — context lifecycle

**Files:**
- Create: `integration-tests/suites/cli-chat-context.test.ts`

- [ ] **Step 1: Write the suite** — exercises add→tool-card, list, and the new confirmed remove (y and n paths):

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { ChatDriver, FETCH_SERVER, UI } from '../support/chat-driver.js'

describe('CLI chat — context lifecycle', () => {
  let driver: ChatDriver

  beforeEach(async () => {
    driver = new ChatDriver()
    expect(await driver.start()).toBe(true)
  })

  afterEach(() => driver.kill())

  test('add opens the tool-select card and registers the context', async () => {
    await driver.type(`/context add fetch node ${FETCH_SERVER}`)
    await driver.write('\r')
    expect(await driver.waitFor(UI.contextAdded, 15_000)).toBe(true)
    expect(await driver.waitFor(UI.toolSelect, 5_000)).toBe(true) // card shown
    expect(driver.screen()).toContain('fetch:get_markdown')
    driver.write('\r') // keep all enabled
    await driver.type('/context list')
    await driver.write('\r')
    expect(await driver.waitFor('fetch', 5_000)).toBe(true)
  }, 60_000)

  test('remove asks for confirmation and removes on y', async () => {
    expect(await driver.addFetchContext()).toBe(true)
    await driver.type('/context remove fetch')
    await driver.write('\r')
    expect(await driver.waitForConfirm()).toBe(true)
    driver.approve() // y
    expect(await driver.waitFor(UI.removed, 5_000)).toBe(true)
  }, 60_000)

  test('remove is cancelled on esc/n', async () => {
    expect(await driver.addFetchContext()).toBe(true)
    await driver.type('/context remove fetch')
    await driver.write('\r')
    expect(await driver.waitForConfirm()).toBe(true)
    driver.esc() // cancel
    expect(await driver.waitFor('remove cancelled', 5_000)).toBe(true)
    // context still present
    await driver.type('/context list')
    await driver.write('\r')
    expect(await driver.waitFor('fetch', 5_000)).toBe(true)
  }, 60_000)
})
```

- [ ] **Step 2: Run**

Run: `pnpm --filter mokei-integration-tests exec vitest run suites/cli-chat-context.test.ts`
Expected: 3 pass.

- [ ] **Step 3: Commit**

```bash
git add integration-tests/suites/cli-chat-context.test.ts
git commit -m "test(integration): cli-chat context lifecycle (add card, confirmed remove)"
```

---

## Task 9: `cli-chat-tools.test.ts` — approval / deny / tools card

**Files:**
- Create: `integration-tests/suites/cli-chat-tools.test.ts`

- [ ] **Step 1: Write the suite** — approval card content, deny path, and the `/tools` card round-trip:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { ChatDriver, UI } from '../support/chat-driver.js'

const PROMPT = 'fetch info about https://mokei.dev and provide a summary'

describe('CLI chat — tools', () => {
  let driver: ChatDriver

  beforeEach(async () => {
    driver = new ChatDriver()
    expect(await driver.start()).toBe(true)
    expect(await driver.addFetchContext()).toBe(true)
  })

  afterEach(() => driver.kill())

  test('approval card shows the namespaced tool and arguments', async () => {
    await driver.submit(PROMPT)
    expect(await driver.waitForApproval()).toBe(true)
    expect(driver.screen()).toContain('fetch:get_markdown')
    expect(driver.screen()).toContain('https://mokei.dev')
    driver.approve()
    expect(await driver.waitForIdle(90_000)).toBe(true)
  }, 150_000)

  test('denying a tool call returns to idle without aborting', async () => {
    await driver.submit(PROMPT)
    expect(await driver.waitForApproval()).toBe(true)
    driver.deny() // n
    expect(await driver.waitFor(UI.denied, 10_000)).toBe(true)
    expect(await driver.waitForIdle(90_000)).toBe(true)
    expect(driver.screen()).not.toContain(UI.aborted)
  }, 150_000)

  test('/tools lists the context tools', async () => {
    await driver.type('/tools')
    await driver.write('\r')
    expect(await driver.waitFor(UI.toolSelect, 5_000)).toBe(true)
    expect(driver.screen()).toContain('fetch:get_markdown')
    driver.esc()
  }, 60_000)
})
```

- [ ] **Step 2: Run**

Run: `pnpm --filter mokei-integration-tests exec vitest run suites/cli-chat-tools.test.ts`
Expected: 3 pass.

- [ ] **Step 3: Commit**

```bash
git add integration-tests/suites/cli-chat-tools.test.ts
git commit -m "test(integration): cli-chat tools (approve/deny, tools card)"
```

---

## Final verification

- [ ] **Lint (use the proxied command — required):**

Run: `rtk proxy pnpm run lint`
Expected: `No fixes applied`, no errors.

- [ ] **Unit + types:**

Run: `pnpm --filter @mokei/session exec vitest run && pnpm --filter mokei exec vitest run && pnpm --filter mokei exec tsc --noEmit --skipLibCheck`
Expected: session + cli suites green, types clean.

- [ ] **e2e (needs ollama + `lfm2.5:latest` + built fetch server + built cli `dist`):**

Run: `pnpm --filter mokei build && pnpm --filter @mokei/mcp-fetch build && pnpm --filter mokei-integration-tests test`
Expected: `cli-chat`, `cli-chat-context`, `cli-chat-tools` all pass alongside the existing host/session/agent suites.

- [ ] **Manual sanity:** `./bin/dev.js chat ollama --model lfm2.5:latest` — verify: typing is blocked while a turn streams; Esc cancels a thinking turn; `/context add` opens the tool card; `/context remove` asks to confirm; quitting disposes cleanly.

---

## Notes / non-goals

- **SIGINT→Esc** is intentional; not reverted.
- `/context add` args remain space-separated (no quoting) — out of scope; note in `/help` if desired later.
- e2e suites are **live** (ollama + spawned processes); they are model-nondeterministic and not wired into CI. The `isIdle()` last-occurrence heuristic in `chat-driver.ts` is a known soft spot — if flaky, tighten by scoping to the trailing frame.
