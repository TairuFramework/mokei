# Tool-Call Monitoring: hang / error / timeout — Design

**Stage:** design

**Goal:** Give the Ink chat UI a reliable way to monitor in-flight tool calls — show elapsed time, warn when a call may be stuck, enforce a per-tool timeout so a single hanging MCP tool no longer blocks the whole turn, let the user cancel the active tool call (contextual Esc), and present errors as a single line with full detail on demand (`/details`).

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
- **User can cancel the active tool call.** Esc is **contextual**: during `calling-tool` it cancels only the active tool (turn continues); during `streaming` it aborts the whole turn (current behavior). Cancellation reuses the per-call `AbortController` and surfaces via `tool-call-error` carrying a typed `ToolCallCancelledError` (same pattern as timeout — no new event type).
- **Error detail via `/details`.** The transcript is Ink `<Static>` (rendered once, no per-item interactive toggle). Errors therefore show a **single-line summary** in the transcript; the full detail is stored and reprinted on demand by a new `/details` slash command (most recent error). No inline expand inside `<Static>`.

---

## Architecture

Two layers.

### Layer 1 — `@mokei/session`: per-tool timeout + cancellation

**Files:** `packages/session/src/agent-types.ts`, `packages/session/src/agent-session.ts`, `packages/session/src/index.ts`.

1. Add `toolTimeout?: number` to `AgentSessionParams` (default comment: 120000 = 2 min) and `toolTimeout: number` to `ResolvedAgentParams`. Add `toolTimeout: 2 * 60 * 1000` to `AGENT_DEFAULTS`. Resolve in the constructor like the other defaults.
2. Two exported error classes (export both from `packages/session/src/index.ts`):
   - `ToolCallTimeoutError extends Error` — `name = 'ToolCallTimeoutError'`, ctor `(toolName, timeoutMs)` → message `tool "${toolName}" timed out after ${timeoutMs}ms`, public readonly `timeoutMs`.
   - `ToolCallCancelledError extends Error` — `name = 'ToolCallCancelledError'`, ctor `(toolName)` → message `tool "${toolName}" cancelled by user`.
3. Track the active per-call controller on the instance so the UI can cancel it: private `#activeToolController: AbortController | null = null`.
4. Add a public `cancelToolCall(): void` method — if `#activeToolController != null`, call `#activeToolController.abort(CANCEL_REASON)` (a module sentinel, e.g. `const CANCEL_REASON = Symbol('tool-cancel')`). No-op when no tool is running.
5. In `#executeToolCall`, wrap the awaited `session.executeToolCall` with a per-call controller using the **existing pattern**:
   - `const callController = new AbortController()`; assign to `this.#activeToolController`.
   - `const callTimer = setTimeout(() => callController.abort(TIMEOUT_REASON), this.#params.toolTimeout)` where `TIMEOUT_REASON` is another module sentinel.
   - combine with the passed-in turn `signal` via the existing `anySignal([signal, callController.signal])`; pass the combined signal to `session.executeToolCall`.
   - `finally { clearTimeout(callTimer); this.#activeToolController = null }`.
   - In the `catch`, discriminate before emitting `tool-call-error`:
     - turn `signal.aborted` → propagate as the existing turn-abort (turn ends; unchanged).
     - else `callController.signal.reason === TIMEOUT_REASON` → `new ToolCallTimeoutError(toolCall.name, this.#params.toolTimeout)`.
     - else `callController.signal.reason === CANCEL_REASON` → `new ToolCallCancelledError(toolCall.name)`.
     - else → the original error.
   - Still emitted via the existing `tool-call-error` event. For timeout/cancel the turn loop continues to the next tool / next iteration; the tool message records the error so the model can react.

This keeps timeout + cancellation handling uniform across stdio and HTTP transports (host.ts's 30s HTTP request timeout is transport-specific and unaffected). Cancelling the per-call controller aborts only the tool's combined signal, not the turn-level provider signal, so the turn survives.

### Layer 2 — `packages/cli`: active-call timing + hang UI

**Files:** `turn-reducer.ts`, new `hooks/useElapsed.ts`, `hooks/useAgentTurn.ts`, `components/ToolCallStatus.tsx`, `components/PendingTurn.tsx`, `components/ToolResultCard.tsx`, `components/HelpCard.tsx`, `ChatApp.tsx`. (`slash.ts` needs no change — `/details` already parses as a command.)

1. **Reducer** (`turn-reducer.ts`):
   - Add `activeToolCall: { call: FunctionToolCall<unknown>; startedAt: number } | null` to `TurnState`; initial `null`.
   - `tool-call-approved` and `tool-call-start`: set `state: 'calling-tool'`, `activeToolCall: { call: event.toolCall, startedAt: event.timestamp }`, `pendingCall: null`.
   - `tool-call-complete` / `tool-call-error`: `state: 'streaming'`, `activeToolCall: null`.
   - `tool-call-pending` keeps using `pendingCall` for `awaiting-approval` (unchanged).
   - `tool-call-denied`: clear both `pendingCall` and `activeToolCall`.
2. **`useElapsed(active: boolean): number` hook** (`hooks/useElapsed.ts`):
   - When `active`, `setInterval(…, 1000)` storing `Date.now()` in state to force re-render; cleared when `active` flips false or on unmount. Returns the current tick (now-ms). Needed because no agent events fire while a tool hangs.
3. **`useAgentTurn`** (`hooks/useAgentTurn.ts`):
   - Keep the created agent in a ref (currently it's a local in `submit`). Expose `cancelTool: () => void` that calls `agentRef.current?.cancelToolCall()`.
   - Extend `AgentSessionLike` with optional `cancelToolCall?(): void` so the hook's mock-friendly interface matches `AgentSession`.
   - `abort` (turn abort) stays as is.
4. **`useElapsed(active: boolean): number` hook** (`hooks/useElapsed.ts`):
   - When `active`, `setInterval(…, 1000)` storing `Date.now()` in state to force re-render; cleared when `active` flips false or on unmount. Returns the current tick (now-ms). Needed because no agent events fire while a tool hangs.
5. **`ToolCallStatus`** (`components/ToolCallStatus.tsx`):
   - Add props `elapsedMs?: number` and a hang threshold constant `HANG_WARN_MS = 10000`.
   - Render `running {seconds}s`; when `elapsedMs >= HANG_WARN_MS` use red + append ` (may be stuck — esc to cancel)`; below threshold yellow as today.
6. **`PendingTurn`** (`components/PendingTurn.tsx`):
   - Call `const now = useElapsed(turn.state === 'calling-tool' && turn.activeToolCall != null)` **unconditionally** at the top (React hook rules — the `active` arg gates the interval, not the call site). When `activeToolCall != null`, compute `elapsedMs = now - activeToolCall.startedAt` and pass `name` + `elapsedMs` to `ToolCallStatus`.
7. **`ToolResultCard`** (`components/ToolResultCard.tsx`):
   - Optional `durationMs?: number` → append `· {n.n}s`.
   - Error rendering is **single-line**: show only the first line of `error` (split on `\n`, take `[0]`), truncated to a max width. `outcome?: 'error' | 'timeout' | 'cancelled'` selects label/color (`timed out after Ns` / `cancelled` / raw first line). Append ` — /details` hint when full text has more than the shown line.
8. **Error-detail store + `/details`** :
   - `slash.ts`: `/details` already parses as `{ kind: 'command', name: 'details', args: [] }` — no parser change needed; just handle it.
   - `ChatApp` keeps a `lastErrorDetailRef` (full multi-line text of the most recent tool/turn error). `/details` pushes that full text as an `info` notice; if none, pushes `no recent error details`.
   - `HelpCard`: add a `/details   show full text of the last error` line.
9. **`ChatApp.onEvent`** (`ChatApp.tsx`):
   - `tool-call-start`: record `startedAt` per call id in a ref (for duration).
   - `tool-call-complete`: compute `durationMs` from the recorded start; pass to the pushed `tool` entry.
   - `tool-call-error`: map `event.error.name` → `outcome` (`ToolCallTimeoutError`→`timeout`, `ToolCallCancelledError`→`cancelled`, else `error`); push a single-line `tool` entry; store full `error.stack ?? error.message` in `lastErrorDetailRef`. A cancelled tool also gets a brief `warning` notice.
   - `error` (turn-level): keep current single-line notice; store full detail in `lastErrorDetailRef`.
   - Extend `TranscriptEntry` `tool` variant with optional `durationMs` and `outcome`.
10. **Contextual Esc** (`ChatApp` `useInput`):
   - Replace the current `key.escape && turn.state !== 'idle' && turn.state !== 'awaiting-approval'` branch: if `turn.state === 'calling-tool'` → `turn.cancelTool()`; else if `turn.state === 'streaming'` → `turn.abort()`. (`awaiting-approval` still handled by the approval card; `idle` ignores Esc.)

## Data flow

```
model emits N tool calls (iteration)
  └─ for each (sequential):
       tool-call-pending  → reducer: awaiting-approval, pendingCall
       (approval)
       tool-call-approved → reducer: calling-tool, activeToolCall{startedAt}
       tool-call-start    → reducer: calling-tool, activeToolCall{startedAt}
         │  useElapsed ticks 1s → PendingTurn → ToolCallStatus "running Ns" (warn ≥10s)
         │  session per-tool timer (120s) → callController.abort(TIMEOUT_REASON)
         │  OR user Esc → turn.cancelTool() → agent.cancelToolCall() → callController.abort(CANCEL_REASON)
       tool-call-complete → reducer clears activeToolCall; ChatApp pushes ToolResultCard(+durationMs)
        or tool-call-error(ToolCallTimeoutError|ToolCallCancelledError) → reducer clears;
           ChatApp pushes single-line card (outcome=timeout|cancelled), stores full detail; turn continues
```

## Error handling

- Per-call timeout / user-cancel aborts **only** that call; the turn proceeds to the next tool / iteration. Discriminated in `#executeToolCall`'s catch by abort reason (`TIMEOUT_REASON` / `CANCEL_REASON`) vs the turn signal.
- Turn-level `--timeout` and the streaming-phase Esc-abort behavior unchanged.
- A timed-out / cancelled tool produces a `tool` message in the conversation (existing error-message path) so the model can react, plus a single-line UI card.
- Errors in the transcript are single-line; full text is retained in `lastErrorDetailRef` and surfaced via `/details`.

## Testing

- **session** (`packages/session/test/agent-session.test.ts`):
  - mock a tool that never resolves; with a short `toolTimeout`, expect a `tool-call-error` carrying `ToolCallTimeoutError`, the turn survives, and a following iteration proceeds.
  - call `agent.cancelToolCall()` while a never-resolving tool is in-flight → `tool-call-error` carrying `ToolCallCancelledError`, turn continues.
  - verify a real turn-level abort still yields the original (non-timeout, non-cancel) error.
- **reducer** (`packages/cli/test/chat/turn-reducer.test.ts`): `tool-call-start` sets `activeToolCall.startedAt`; `tool-call-complete`/`error`/`denied` clear it.
- **useElapsed** (`packages/cli/test/chat/useElapsed.test.tsx`): with fake timers, ticks while active, stops/cleans up when inactive.
- **useAgentTurn** (`packages/cli/test/chat/useAgentTurn.test.tsx`): `cancelTool()` calls the agent's `cancelToolCall()`.
- **components** (`packages/cli/test/chat/components.test.tsx`): `ToolCallStatus` shows `running Ns` and switches to the stuck warning past 10s; `ToolResultCard` renders a single-line error (multi-line input collapses to first line + `/details` hint) and the timeout / cancelled outcomes.

## Out of scope (YAGNI)

- Concurrent/parallel tool-call tracking (execution is sequential).
- A `--tool-timeout` CLI flag (fixed 120s default).
- New `tool-call-timeout` / `tool-call-cancelled` event types (reuse `tool-call-error` + typed errors).
- Per-tool-call retry.
- Inline per-item expand in the transcript (Static can't toggle; `/details` instead).
- Cancelling a specific queued tool when several are pending — `cancelToolCall()` targets the one in-flight call (sequential execution).
