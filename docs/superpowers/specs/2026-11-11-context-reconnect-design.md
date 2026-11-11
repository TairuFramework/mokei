# Opt-in context reconnect

**Status:** design for approval, 2026-11-11 (builder check done). Approach approved earlier the same day (host-owned
reconnect); this document is the full design written from it.
**Requested by:** Yosura (one `ContextHost` per device) and the roadmap's "Enhanced error
handling" item.

## Why

A lost context is gone for good today. For stdio, the child exits or its framing breaks; the
host calls `remove(key, 'lost')`, the tools disappear, and later agent turns quietly run without
them. HTTP loss is never even detected: a failed fetch or a `2025-11-25` session `404` comes back
as an error on that one request, and the transport carries on. After a `404` it carries on
without a session, so every later call fails until the context is removed by hand.

Success: a context the user opted in comes back on its own. Its tools stay listed while it does,
calls wait briefly instead of failing at once, and the user sees what happened. Anything that
cannot be recovered fails exactly as it does today.

## Goals

- `reconnect` option per context on `addLocalContext`, `addHTTPContext`, `addDirectContext`,
  and their `Session` / `NodeSession` equivalents. Off by
  default; off keeps today's behaviour exactly.
- Detect loss: stdio exit or framing fault; HTTP connection-level failure; HTTP `2025-11-25`
  session `404`; any client `closed` for the other kinds.
- Reconnect with backoff, keeping the key's tools, `enabled`/`allow` state and subscriptions.
- A call gate: calls during a reconnect wait up to a bound, then run or fail clearly.
- Events and CLI notices.
- An optional connectivity hook that pauses attempts while offline.

## Non-goals

- Recovering server-side state from before the loss: in-flight MCP tasks, pending elicitations,
  `2026-07-28` request state. These end as they do today.
- Replaying calls, except one retry of a read-only tool call (below).
- `2025-11-25` `resources/subscribe`: mokei has no client API for it, so there is nothing to
  re-subscribe. (The earlier sketch listed it; the code survey found no such path.)
- Re-running interactive authorisation as part of a reconnect.
- The daemon proxy path (`ProxyHost.spawn`, `createContext`): nothing in the repo uses it for
  contexts that would reconnect, and a dead daemon would need its own recovery. Left out
  (builder's call, 2026-11-11).

## Anti-goals

- A reconnecting context that silently runs a different server: stdio respawn re-checks with the
  consumer when asked to (`respawn` hook).
- A reconnect loop that opens a sign-in window, or retries a `401` forever.
- Hiding failure: after the attempts run out the context is removed with `context:failed`, as
  today.

## Approaches

1. **Host-owned reconnect (chosen).** `ContextHost` keeps a factory and a controller per opted-in
   context and swaps in a new client. Covers `Session`, `AgentSession`, the proxy and the flow
   daemon in one place; key-level APIs survive.
2. **Reconnecting transport.** Each transport reconnects underneath one client. Rejected:
   stdio respawn is a new process (new initialize), `2025-11-25` re-initialize needs the client,
   and tool refresh and the gate still need the host.
3. **Session-level re-add.** `Session` removes and re-adds the context. Rejected: misses
   `ContextHost` users (proxy, flow daemon, Yosura), and tools vanish during the gap.

## Design

### API

```ts
type ReconnectOptions = {
  /** Attempts before giving up (default 5). */
  maxAttempts?: number
  /** Backoff: first delay, doubling, capped (defaults 250 ms, 5 000 ms, full jitter). */
  initialDelayMs?: number
  maxDelayMs?: number
  /** How long a call waits at the gate during a reconnect (default 10 000 ms). */
  gateTimeoutMs?: number
}
// add*Context params: reconnect?: boolean | ReconnectOptions   (true = defaults)
// addLocalContext only: reconnect.respawn?(previous: SpawnContextServerParams)
//   => SpawnContextServerParams | false | Promise<…>  (false = give up, fail the context)
// ContextHostParams: connectivity?: {
//   isOnline(): boolean | Promise<boolean>
//   subscribe?(listener: (online: boolean) => void): () => void
// }
```

`Session.addHTTPContext` and `NodeSession.addContext` destructure their params explicitly today;
both gain `reconnect` and pass it through.

### Per-context controller (host)

The `#contexts` entry gains an optional controller holding: `state` (`connected` |
`reconnecting`), a factory that builds a fresh `{ client, disposer }`, the gate, the attempt loop,
and the reconnect options. Contexts without `reconnect` have no controller and run today's code
paths unchanged.

Factories:
- **HTTP:** a new `HTTPTransport` from the same params (same `fetchMiddleware`, `runtime`,
  token store) plus a new client with the same `protocolVersion` (the negotiated revision is
  re-probed when `'auto'`).
- **Direct:** a new `DirectTransports` pair and `ContextServer` from the same `config`.
- **Stdio (`NodeContextHost`):** `spawnHostedContext` with the previous spawn params. When
  `respawn` is given it is called once per loss, before the first attempt, and may be
  interactive; the params it returns are reused for every attempt of that loss and become
  `previous` for the next loss. Time spent in it counts toward callers' gate timeout like any
  other reconnect time.

### When reconnect applies

A controller is armed only after the context's first successful `setup()`. Until then a loss
behaves as today (removal, `context:failed`), so a wrong URL or a bad command fails the add at
once instead of after the backoff, and `Session`/`NodeSession` setup cleanup (`#removeIfOurs`)
never meets a swapped client. A context that is never set up (tools passed directly) never arms.
(Builder's call, 2026-11-11.)

### Loss detection

- **Any kind:** the client `closed` event (today's trigger). With a controller it starts a
  reconnect instead of `remove(key, 'lost')`.
- **Stdio:** `onStreamError` and `onExit` route to the controller instead of emitting
  `context:failed` and removing; `context:failed` is emitted only when the attempts run out.
- **HTTP:** `HTTPTransport` gains a `connection` event (`{ type: 'failed', error }` for a fetch
  that throws without a response, excluding the caller's own abort; `{ type: 'session-expired' }`
  for the `2025-11-25` `404`). A `5xx`, any HTTP response, and a request timeout are not loss.
  The host subscribes and starts a reconnect. A session `404` request still fails with `-32001`
  as today; the transport is disposed and rebuilt, never reused without a session.
- **HTTP idle loss (user decision, 2026-11-11):** the long-lived streams also report loss, so an
  idle context reconnects without waiting for a call. The `2025-11-25` GET stream and the
  `2026-07-28` `subscriptions/listen` stream emit `connection: failed` when their own re-open
  fails at the network level (a fetch that throws, as above) twice in a row; a stream that ends
  cleanly, a `404`/`405` on the GET stream, or an HTTP error response is not loss.
- A loss reported while a reconnect is already running is ignored.

### Reconnect loop

A hand-rolled loop over `getRetryDelay` from `@sozai/async` (full jitter), because `retry` has no
pause and every failed attempt would count while offline.

1. State `reconnecting`; emit `context:reconnecting { key, attempt, error }` before each attempt.
2. If `connectivity` says offline, wait for `subscribe` to report online (or poll `isOnline` at
   the delay when there is no `subscribe`) without spending an attempt. A missing or throwing hook
   counts as online. The wait has no limit (user decision, 2026-11-11): the context stays
   `reconnecting`, its tools stay listed, and calls fail after `gateTimeoutMs` with
   `ContextUnavailableError` until it is back online or removed.
3. Build a new `{ client, disposer }` from the factory and run `listTools`. Its result goes
   through the same merge as `#refreshContextTools`: keep `enabled`/`allow` by name, new tools
   enabled, vanished tools dropped.
4. On success, swap (below), set `connected`, open the gate, emit
   `context:reconnected { key, attempts }` and `tools:changed` when the tool list changed.
5. On failure, dispose the new attempt's client and wait the backoff delay. A `401` that reaches
   the host (below) ends the loop at once.
6. After `maxAttempts`, or on an auth failure or `respawn` returning `false`: today's ending --
   `remove(key, 'lost')` and `context:failed { key, error }`, with `error` an `AuthRequiredError`
   for the auth case or a `ReconnectExhaustedError` (cause: last error) otherwise.

`remove(key)` or `dispose()` during a reconnect aborts the loop and closes the gate with the
removal error.

### Swap

Ordering matters because client identity guards several paths:
1. Unsubscribe the old client's listeners and settle its context span as `lost` (one context span
   per client; the new client gets a new span, linked to the previous one).
2. Replace `entry.client`, `entry.disposer` and `entry.tools` on the same entry object, so code
   holding the entry sees the new client; then wire the new client's subscriptions.
3. Dispose the old client last; its `closed` event no longer matches the entry and is ignored.

`#refreshContextTools` gains the identity check it lacks (compare the entry's client after the
await).

### Call gate

`callTool`, `callNamespacedTool` and `getPrompt` await the gate when the context is
`reconnecting`: they resume when it reconnects, or fail after `gateTimeoutMs` with a
`ContextUnavailableError`. `callNamespacedTool` (the agent path) returns it as an
`isError: true` tool result, like `callLocalTool` does for local failures; `callTool` and
`getPrompt` reject with it. The caller's `AbortSignal` aborts the wait with its reason.

The call in flight when the context was lost fails with its transport error. When that call is a
`tools/call` whose tool has `annotations.readOnlyHint === true`, the host waits at the gate and
retries it once on the new client; otherwise the error stands. Nothing else is replayed.

Clients taken from `getContext(key).client` or returned by `add*Context` are not gated and go
stale after a swap. Key-level APIs are the supported surface; documented on `reconnect`.
`getContext(key).client` always returns the current client.

### Subscriptions

`2026-07-28`: a new client re-opens the base `listChanged` subscription by itself. Resource
subscriptions are re-applied: the host gains `subscribeResource(key, uri)` /
`unsubscribeResource(key, uri)` that record URIs per key and call the client, and the swap
re-subscribes the recorded URIs. Subscriptions made directly on a client are not carried over.

### Authorisation

A reconnect must never open a sign-in window. Reconnect attempts tag their requests (an internal
`RequestInit` field, like the timeout tag) as non-interactive; `createOAuthMiddleware` still
attaches and refreshes tokens, but where it would call `handler.authorize` it throws
`AuthRequiredError` instead. The host treats that error, or an HTTP `401` without middleware, as
the auth ending of step 6. Once the context is removed, the consumer re-adds it, which may sign
in normally.

### Events and consumers

- Host events: `context:reconnecting { key, attempt, error }`, `context:reconnected { key,
  attempts }`; `context:failed` and `context:removed` unchanged.
- `HTTPContextParams` and `addDirectContext` now also emit `context:added`, as stdio does, so
  consumers see every kind.
- CLI chat: enables `reconnect: true` for `/context add` and `/context add-http`, shows
  reconnecting/reconnected notices next to the existing `context:failed` notice, and updates its
  context list on host `context:removed` (today a lost context stays listed).
- `Session`/`NodeSession` identity checks (`#removeIfOurs`) keep working: they run only during
  setup, and the controller arms after setup succeeds.
- Flow host holds the decision-flow direct context's client; that context does not enable
  reconnect.

### Tracing

One `mcp.context` span per client. The span of a lost client ends with `error.type=context.lost`
as today; the new client's span links to it and carries `mokei.context.reconnect.attempt`.

## Constraints

- Defaults: `maxAttempts` 5, `initialDelayMs` 250, `maxDelayMs` 5 000, `gateTimeoutMs` 10 000.
- No new package. Changes in `@mokei/host`, `@mokei/host-node`, `@mokei/http-client`,
  `@mokei/session`, `@mokei/session-node`, `@mokei/cli`.
- Patch changeset.

## Left to the builder

- Exact error class names and where they are exported (`@mokei/host` for
  `ContextUnavailableError`, `ReconnectExhaustedError`; `@mokei/http-client` for
  `AuthRequiredError`).
- Whether the controller lives in a new `host/src/reconnect.ts` (likely) or inside `host.ts`.
- Test fixtures for stdio respawn (a tiny server script that exits on demand).
