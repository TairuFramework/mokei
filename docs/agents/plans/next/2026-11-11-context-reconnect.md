# Opt-in context reconnect

**Status:** next (3 of 3, after per-call elicitation routing and RN fetch/crypto injection)
**Approach:** approved 2026-11-11 (brainstorming). Write the full design doc from this.

## Intent

Resilience and better UX: a lost context comes back instead of leaving the agent without its
tools for the rest of the session. Today `remove(key, 'lost')` drops the context and its tools;
the in-flight call errors and later turns silently lack those tools. `2025-11-25` HTTP session
expiry (`404`, `isSessionExpiredCode`) is never recovered.

## Approved behaviour

- **Opt-in** per context: a `reconnect` option on `addLocalContext`, `addHTTPContext`,
  `addDirectContext` and their `Session` equivalents. Off keeps today's behaviour.
- **Lost means:** stdio exit or framing fault (respawn); HTTP `2025-11-25` session `404`
  (re-initialize); HTTP connection-level failure (fetch throws, refused, reset; not `5xx`).
- **During reconnect** tools stay listed. New calls wait at a gate up to a bound (proposal 10s),
  then run or return a clear unavailable tool error. The in-flight call errors; it is retried once
  after reconnect only when the tool has `readOnlyHint`. Never replay other calls.
- **Backoff** with an attempt cap (proposal 250ms doubling to 5s, 5 attempts), then fall back to
  today: remove and `context:failed`.
- **On success** re-list tools keeping `enabled`/`allow` by name (`#refreshContextTools`), emit
  `tools:changed`, re-open `2026-07-28` subscriptions, re-subscribe known `2025-11-25` resources.
- **Events** `context:reconnecting` (attempt, error) and `context:reconnected`. The CLI chat shows
  them and enables reconnect for its contexts.
- **Connectivity hook** (host-level, optional, HTTP only):
  `connectivity?: { isOnline(): boolean | Promise<boolean>; subscribe?(listener): () => void }`.
  Offline pauses attempts without spending them; resume on online. Fail-open (a missing or
  throwing hook counts as online).
- **Not recovered:** server state before the loss -- in-flight MCP tasks, pending elicitations
  (rejected so UIs close them).

## Approach: host-owned reconnect (chosen over a reconnecting transport and Session-only re-add)

`ContextHost` keeps a per-context factory (transport plus client for HTTP and direct; respawn
for stdio via `NodeContextHost`) and a controller per context: state (`connected` /
`reconnecting` / `failed`), call gate, backoff, client swap, tool refresh. Covers Session,
AgentSession, the flow daemon and the proxy. The client returned by `add*Context` goes stale after
a reconnect; key-level APIs survive. Document it.

Reuse and patterns: `@sozai/async` `retry` (`RetryPolicy`, jitter, `RetryExhaustedError`);
reopen-once-and-gate from `@kubun/client` `createResilientGraphQLSource`; state events shaped
like `@kumiai/hub-tunnel`; fail-open connectivity like kubun plugin-connector `readOnline`.
Nothing published provides offline pause.

## Consumer requirements (Yosura per-device ContextHost)

- **stdio respawn approval:** `reconnect.respawn?(previous) => SpawnParams | false` re-checks
  device-local approval of command, args and env names before respawning; without it the same
  params are reused.
- **Auth:** reuse the same `fetchMiddleware` and token store, never re-run authorization. A `401`
  ends the loop without retrying and fails with a distinct auth-required reason.
- **Cancellation:** an in-flight call's `AbortSignal` aborts cleanly at the gate and mid-reconnect.
- Key-level APIs and per-key events are what the consumer uses; it never holds the client.
