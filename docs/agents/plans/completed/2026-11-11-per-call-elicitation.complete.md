# Per-call elicitation routing

**Status:** complete
**Date:** 2026-11-11
**Packages:** `@mokei/context-client`, `@mokei/host` (patch)
**Requested by:** Yosura (one shared `ContextHost` per device, concurrent tool calls on one context
from different screens)

## What shipped

A caller passes an elicitation handler with one request and receives only that request's
elicitations.

- `ContextClient.callTool`, `getPrompt`, `readResource` and `waitForTask` accept
  `elicit?: ElicitHandler` (`PerRequestElicit`). It answers that request's `elicitation/create`
  input requests in place of the client-wide handler, across every MRTR round, and the task input
  of a task-backed `callTool` that waits for its own task.
- `ContextHost.callTool`, `callNamespacedTool` and `getPrompt` accept
  `elicit?: HostElicitOverride` (`PerCallElicit`, `(request, fallback)`). It wins over the
  `handleElicitation` override; `fallback()` uses the host-wide path (override, then the base
  handler) and always returns a promise.
- Several waiters on one task: task input goes to the oldest live waiter's handler, and a waiter
  that leaves stops receiving input.

## Design decisions

- **`2026-07-28` only.** MRTR (SEP-2322) returns `input_required` inside the request's own round
  trip, so routing is exact. On `2025-11-25` a server-initiated `elicitation/create` has no wire
  link to its call (stdio), so the per-call handler is ignored and the host-wide handler answers.
- **Per-call handler over a call ID on `HostElicitRequest`.** A handler needs no lookup; an ID
  would add host-minted IDs and a caller-side map for the same result.
- **Never enables elicitation.** A client without a client-wide handler (context added with
  `elicit: false`, or a host without elicitation) declares no capability and ignores the option.
- `elicit` is stripped before `splitRequestOptions`, so it never reaches the wire.

## Not included

- Per-call sampling (`createMessage`) and `listRoots`; `Session` / `AgentSession` pass-through.
- A handler that ignores its abort signal still hangs its call: the input loop waits for each
  dispatch to settle (pre-existing, same for the client-wide handler).
- A task input already dispatched to a waiter that then leaves is not re-routed.
