# Opt-in context reconnect

**Status:** complete (2026-11-12)
**Requested by:** Yosura (one `ContextHost` per device) and the roadmap's "Enhanced error handling" item.

## Goal

A lost context used to be gone for good: a stdio exit removed it, and HTTP loss was never
detected, so a session `404` left every later call failing. Contexts opted in with
`reconnect: true | ReconnectOptions` now come back on their own: their tools stay listed, calls
wait briefly at a gate, the user sees notices, and anything unrecoverable fails with
`context:failed` and is removed. Off by default.

## Key design decisions

- **Host-owned reconnect.** `ContextHost` keeps a factory and a `ReconnectController` per
  opted-in registration and swaps in a fresh client, so `Session`, `AgentSession`, the proxy, the
  flow daemon and Yosura get it in one place. A reconnecting transport was rejected (stdio respawn
  is a new process; re-initialize and tool refresh need the host); a session-level re-add was
  rejected (misses `ContextHost` users, tools vanish during the gap).
- **Registration identity and generations.** The registration object is stable across swaps; every
  async step re-checks registration, client and generation after each await, and a step that lost
  ownership disposes what it built and publishes nothing. A key removed and re-added mid-reconnect
  never sees the old loop. `Session` / `NodeSession` cleanup compares the registration and claims
  it only when it holds the client the call added.
- **Arming.** Reconnect applies only after `setup()` commits tools, so a wrong URL or command still
  fails the add at once.
- **Loss detection never reads server text.** Locally generated failures carry a `Symbol.for`
  brand (`transportFailureOf`); server JSON-RPC errors are never treated as transport loss. HTTP
  network failure, `2025-11-25` session `404`, repeated idle stream failure and client `closed` all
  count; caller aborts, timeouts and OAuth subrequests do not.
- **Quiesce at once, then backoff.** The lost generation is detached and disposed synchronously
  (no `DELETE` on session expiry: `dispose({ terminateSession: false })`); attempts use jittered
  doubling backoff, an optional connectivity hook pauses while offline.
- **Call gate.** One deadline per call; waiters reject with `ContextUnavailableError` whose cause is
  the terminal error (`ReconnectExhaustedError`, `AuthRequiredError`); `context:failed` carries the
  terminal error and tool calls get an error result. One retry of a read-only tool call.
- **No sign-in during reconnect.** `HTTPTransport` interaction mode is stamped per request;
  reconnect, GET and `subscriptions/listen` are non-interactive, so a `401` (with or without a
  JSON-RPC body) ends the reconnect with `AuthRequiredError` instead of retrying.
- **Subscriptions.** New `subscribeResource` / `unsubscribeResource` serialised per key; restoration
  runs after the gate opens, non-interactive, drops URIs with `resource:subscription-lost` when the
  server explicitly lacks `resources.subscribe` or a re-subscribe fails (unknown capability = try);
  a failed unsubscribe keeps the URI and re-subscribes it on the current client if needed.
- **Stdio.** `NodeContextHost` respawns with the same spawn params; `respawn` is asked once per
  loss and can change params or decline (`ReconnectDeclinedError`, terminal with `attempts: 0`).
- **Env isolation (folded in).** `@mokei/host-node` spawns stdio children with exactly the given
  `env` (parent variables no longer leak); omitted `env` inherits. Windows limits documented:
  libuv adds a few non-sensitive system variables and case-differing keys can collide.
- **Error hygiene.** `NetworkError` messages and causes carry only the server origin, never path
  or query; new error classes take params objects.

## What was built

`@mokei/context-client` (failure brand, `TaskInterruptedError`, `discoveredCapabilities`),
`@mokei/context-rpc` (brand carried through `RPCError.fromResponse`), `@mokei/http-client`
(`NetworkError`, `AuthRequiredError`, connection events, interaction mode,
`dispose({ terminateSession })`), `@mokei/host` (controller, gate, events, subscriptions),
`@mokei/host-node` (respawn, exact env), `@mokei/session` / `@mokei/session-node`
(pass-through, registration ownership), `mokei` CLI (reconnect on `/context add*`, notices).
Docs in `docs/agents/architecture.md`, `docs/guides/host.md` and package READMEs.

Follow-ups: `docs/agents/plans/backlog/2026-11-12-context-reconnect-followups.md`.
