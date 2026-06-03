# Tool-Call Monitoring: hang / error / timeout — Design

**Stage:** design

**Goal:** Give the Ink chat UI a reliable way to monitor in-flight tool calls — show elapsed time, warn when a call may be stuck, and enforce a per-tool timeout so a single hanging MCP tool no longer blocks the whole turn until the global `--timeout` fires.

**Context:** Follow-up/QA on `docs/superpowers/plans/2026-04-22-cli-chat-ink-plan.md`. The Ink chat (`packages/cli/src/chat/`) currently shows a generic spinner + tool name during the `calling-tool` phase with no elapsed time, no hang signal, and no per-tool timeout. Tool results land in the `<Static>` transcript only after completion.

---

## Background / current behavior

- `AgentSession` executes tool calls **sequentially**: `for (const toolCall of toolCalls)` with `await this.#executeToolCall(...)` (agent-session.ts:286). At most one tool call is in-flight at any moment.
- `#executeToolCall` (agent-session.ts:499) awaits `session.executeToolCall(toolCall, signal)` passing only the turn-level `combinedSignal`. There is **no per-tool timeout**.
- The only timeout is whole-turn: an `AbortController` + `setTimeout(timeout)` combined via `anySignal([signal, timeoutController.signal])` (agent-session.ts:144-150). Default `AGENT_DEFAULTS.timeout = 5 min`.
- Events `tool-call-start` / `tool-call-complete` / `tool-call-error` all carry `toolCall` + `timestamp`; complete carries `result`, error carries `error`.
- CLI `turn-reducer.ts` tracks a single `pendingCall: FunctionToolCall | null` and a `state` of `calling-tool`. No start time, so elapsed cannot be derived.
- `PendingTurn` renders `ToolCallStatus phase="calling"` (the `done`/`failed` phases exist but are unused — completed calls go to the transcript as `ToolResultCard`).

## Decisions (from brainstorming)

- **No new event type.** Per-tool timeout is surfaced through the existing `tool-call-error` event, carrying a typed `ToolCallTimeoutError`. UI distinguishes by `error.name`.
- **Fixed default, no new flag.** Per-tool timeout default `120000ms`, configurable via `AgentSessionParams.toolTimeout`. No `--tool-timeout` CLI flag.
- **Show elapsed always + warn at threshold.** Every running tool shows `running Ns`; past **10s** it turns warning-colored with a "may be stuck — esc to abort" hint.
- **YAGNI: single active call, not a concurrent list.** Execution is sequential, so at most one call is in-flight. Completed calls already appear in the transcript. The live region tracks the one active call + its start time; no concurrent checklist (which would duplicate transcript history).

---

## Architecture

Two layers.

### Layer 1 — `@mokei/session`: per-tool timeout

**Files:** `packages/session/src/agent-types.ts`, `packages/session/src/agent-session.ts`, `packages/session/src/index.ts`.

1. Add `toolTimeout?: number` to `AgentSessionParams` (default comment: 120000 = 2 min) and `toolTimeout: number` to `ResolvedAgentParams`. Add `toolTimeout: 2 * 60 * 1000` to `AGENT_DEFAULTS`. Resolve in the constructor like the other defaults.
2. New exported error class `ToolCallTimeoutError extends Error`:
   - `name = 'ToolCallTimeoutError'`
   - constructor `(toolName: string, timeoutMs: number)` → message `tool "${toolName}" timed out after ${timeoutMs}ms`
   - public readonly `timeoutMs: number`
   - Export from `packages/session/src/index.ts`.
3. In `#executeToolCall`, wrap the awaited `session.executeToolCall` with a per-call timeout using the **existing pattern**:
   - `const callController = new AbortController()`
   - `const callTimer = setTimeout(() => callController.abort(), this.#params.toolTimeout)`
   - combine with the passed-in turn `signal` via the existing `anySignal([signal, callController.signal])`; pass the combined signal to `session.executeToolCall`.
   - `finally { clearTimeout(callTimer) }`.
   - In the `catch`: if `callController.signal.aborted` **and** the turn `signal` is **not** aborted (i.e. our per-call timer fired, not a user/turn abort), construct `new ToolCallTimeoutError(toolCall.name, this.#params.toolTimeout)` as the emitted error. Otherwise emit the original error (preserves user-abort / turn-timeout semantics).
   - Still emitted via the existing `tool-call-error` event. The turn loop continues to the next tool / next iteration unchanged.

This keeps timeout handling uniform across stdio and HTTP transports (host.ts's 30s HTTP request timeout is transport-specific and unaffected).

### Layer 2 — `packages/cli`: active-call timing + hang UI

**Files:** `turn-reducer.ts`, new `hooks/useElapsed.ts`, `components/ToolCallStatus.tsx`, `components/PendingTurn.tsx`, `components/ToolResultCard.tsx`, `ChatApp.tsx`.

1. **Reducer** (`turn-reducer.ts`):
   - Add `activeToolCall: { call: FunctionToolCall<unknown>; startedAt: number } | null` to `TurnState`; initial `null`.
   - `tool-call-approved` and `tool-call-start`: set `state: 'calling-tool'`, `activeToolCall: { call: event.toolCall, startedAt: event.timestamp }`, `pendingCall: null`.
   - `tool-call-complete` / `tool-call-error`: `state: 'streaming'`, `activeToolCall: null`.
   - `tool-call-pending` keeps using `pendingCall` for `awaiting-approval` (unchanged).
   - `tool-call-denied`: clear both `pendingCall` and `activeToolCall`.
2. **`useElapsed(active: boolean): number` hook** (`hooks/useElapsed.ts`):
   - When `active`, `setInterval(…, 1000)` storing `Date.now()` in state to force re-render; cleared when `active` flips false or on unmount. Returns the current tick (now-ms). Needed because no agent events fire while a tool hangs.
3. **`ToolCallStatus`** (`components/ToolCallStatus.tsx`):
   - Add props `elapsedMs?: number` and a hang threshold constant `HANG_WARN_MS = 10000`.
   - Render `running {seconds}s`; when `elapsedMs >= HANG_WARN_MS` use red + append ` (may be stuck — esc to abort)`; below threshold yellow as today.
4. **`PendingTurn`** (`components/PendingTurn.tsx`):
   - Call `const now = useElapsed(turn.state === 'calling-tool' && turn.activeToolCall != null)` **unconditionally** at the top (React hook rules — the `active` arg gates the interval, not the call site). When `activeToolCall != null`, compute `elapsedMs = now - activeToolCall.startedAt` and pass `name` + `elapsedMs` to `ToolCallStatus`.
5. **`ToolResultCard`** (`components/ToolResultCard.tsx`):
   - Optional `durationMs?: number` → append `· {n.n}s`.
   - Optional `timedOut?: boolean` → render the error line as `timed out after Ns` styling instead of a raw error dump.
6. **`ChatApp.onEvent`** (`ChatApp.tsx`):
   - `tool-call-complete`: compute duration from the matching `tool-call-start` timestamp (track last start per call id in a ref) and pass `durationMs` to the pushed `tool` entry.
   - `tool-call-error`: if `event.error.name === 'ToolCallTimeoutError'` push a friendlier `timedOut` tool entry / notice; else keep current behavior.
   - Extend `TranscriptEntry` `tool` variant with optional `durationMs` and `timedOut`.

## Data flow

```
model emits N tool calls (iteration)
  └─ for each (sequential):
       tool-call-pending  → reducer: awaiting-approval, pendingCall
       (approval)
       tool-call-approved → reducer: calling-tool, activeToolCall{startedAt}
       tool-call-start    → reducer: calling-tool, activeToolCall{startedAt}
         │  useElapsed ticks 1s → PendingTurn → ToolCallStatus "running Ns" (warn ≥10s)
         │  session per-tool timer (120s) may fire → callController.abort()
       tool-call-complete → reducer clears activeToolCall; ChatApp pushes ToolResultCard(+durationMs)
        or tool-call-error(ToolCallTimeoutError) → reducer clears; ChatApp pushes timedOut card; turn continues
```

## Error handling

- Per-call timeout aborts **only** that call; the turn proceeds to the next tool / iteration. Distinguished from user-abort and turn-timeout by checking which controller aborted.
- Turn-level `--timeout` and Esc-abort behavior unchanged.
- A timed-out tool produces a `tool` message in the conversation (existing error-message path) so the model can react, plus a UI `timedOut` card.

## Testing

- **session** (`packages/session/test/agent-session.test.ts`): mock a tool that never resolves; with a short `toolTimeout`, expect a `tool-call-error` carrying `ToolCallTimeoutError`, the turn survives, and a following iteration proceeds. Verify user-abort still yields the original (non-timeout) error.
- **reducer** (`packages/cli/test/chat/turn-reducer.test.ts`): `tool-call-start` sets `activeToolCall.startedAt`; `tool-call-complete`/`error`/`denied` clear it.
- **useElapsed** (`packages/cli/test/chat/useElapsed.test.tsx`): with fake timers, ticks while active, stops/cleans up when inactive.
- **components** (`packages/cli/test/chat/components.test.tsx`): `ToolCallStatus` shows `running Ns` and switches to the stuck warning past 10s; `ToolResultCard` shows duration and the timeout variant.

## Out of scope (YAGNI)

- Concurrent/parallel tool-call tracking (execution is sequential).
- A `--tool-timeout` CLI flag (fixed 120s default).
- A new `tool-call-timeout` event type (reuse `tool-call-error` + typed error).
- Per-tool-call retry.
