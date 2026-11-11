# Per-call elicitation routing

**Date:** 2026-11-11
**Size:** small change
**Requested by:** Yosura (one shared `ContextHost` per device, concurrent tool calls on one context
from different screens)

## Intent

Route each elicitation to the call that caused it. Today `HostElicitRequest` carries only
`{ key, params, signal }`, the host has one `handleElicitation` override, and `callTool` takes no
handler, so concurrent calls on one context cannot tell whose elicitation arrived.

## Goals

- A caller passes an elicitation handler with a request and receives only that request's
  elicitations.
- Exact routing on `2026-07-28`, where MRTR (SEP-2322) returns `input_required` inside the
  request's own round trip (`runInputRequiredFlow` -> `#fulfilInputRequest`), including
  task-backed calls driven by `waitForTask`.

## Non-goals

- `2025-11-25` routing. A server-initiated `elicitation/create` has no wire link to its call on
  stdio. A per-call handler is ignored there and elicitations reach the host-wide handler as today.
- Per-call `createMessage` (sampling) or `listRoots`.
- `Session` / `AgentSession` pass-through.

## Approaches

- **Per-call handler (chosen).** The caller supplies the handler with the call; routing needs no
  lookup.
- **Call ID on `HostElicitRequest`.** The host would mint and expose IDs and the caller would keep
  an ID-to-screen map. More surface for the same result.
- **Both.** Not needed yet.

## Design

- `ContextClient.callTool`, `getPrompt`, `readResource` and `waitForTask` accept
  `elicit?: ElicitHandler`. It answers that request's `elicitation/create` input requests in place
  of the client-wide handler. `#fulfilInputRequest` takes the per-request handler.
- `ContextHost.callTool`, `callNamespacedTool`, `getPrompt` and `readResource` accept
  `elicit?: HostElicitOverride` (`(request, fallback)`). It takes precedence over the
  `handleElicitation` override. `fallback` hands the request to the host-wide path (the
  `handleElicitation` override, if installed, then the host's `elicit` handler).
- Cancellation: the call's `signal` already reaches the elicitation handler through
  `runInputRequiredFlow`; covered by a test.
- A context added with `elicit: false`, or a host without elicitation, keeps elicitation off: the
  per-call handler does not enable the capability.
- TSDoc on each option states the `2025-11-25` limit.

## Tests

- Two concurrent calls on one `2026-07-28` context each receive only their own elicitation.
- `fallback` reaches the host-wide handler; per-call handler wins over `handleElicitation`.
- Aborting a call aborts its pending elicitation's `signal`.
- `2025-11-25` context: the per-call handler is ignored and the host-wide handler answers.
- `waitForTask({ elicit })` routes a task's input requests.

## Left to the builder

- Exact option type names and overload updates on the `allowInputRequired` overloads.
- Whether `ElicitHandler` on the client gets the host's request shape or the client's
  (`{ params, signal }`); the host adapts either way.

Release: patch changeset.
