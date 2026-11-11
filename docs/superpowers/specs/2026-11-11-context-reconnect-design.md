# Opt-in context reconnect

**Status:** design for approval, 2026-11-11 (builder check and two Codex review rounds done; revision 2). Approach approved earlier the same day (host-owned
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
cannot be recovered fails and is removed, with `context:failed`.

## Goals

- `reconnect` option per context on `addLocalContext`, `addHTTPContext`, `addDirectContext`,
  and their `Session` / `NodeSession` equivalents. Off by default; off keeps today's behaviour,
  except that HTTP and direct contexts now emit `context:added`.
- Detect loss: stdio exit or framing fault; HTTP network-level failure; HTTP `2025-11-25`
  session `404`; idle HTTP stream failure; any client `closed`.
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
- Hiding failure: after the attempts run out the context fails (`context:failed`) and is
  removed.

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

The `#contexts` entry (the *registration*: one object per `add*Context` call, kept across swaps)
gains an optional controller holding: `state` (`connected` | `reconnecting`), a `generation`
counter, a factory that builds a fresh `{ client, disposer }`, the gate, the attempt loop, and the
reconnect options. Contexts without `reconnect` have no controller and keep today's code paths.

Factories:
- **HTTP:** a new `HTTPTransport` from the same params (same `fetchMiddleware`, `runtime`,
  token store) plus a new client with the same `protocolVersion` (re-probed when `'auto'`).
- **Direct:** a new `DirectTransports` pair and `ContextServer` from the same `config`.
- **Stdio (`NodeContextHost`):** `spawnHostedContext` with the previous spawn params, with fresh
  per-candidate `isCurrent` / `framingError` / `onExit` callbacks. When `respawn` is given it is
  called once per loss, before the first attempt, and may be interactive; the params it returns
  are reused for every attempt of that loss and become `previous` for the next loss.

### Ownership and generations

Every asynchronous step of a reconnect, a refresh or a setup re-checks ownership after each
await: the registration must still be `this.#contexts[key]`, and the client it captured must
still be `registration.client` (for a reconnect step: the controller's `generation` must equal
the attempt's). A step that lost ownership disposes what it built and publishes nothing:
no swap, no tools, no events, no terminal removal. This covers the reconnect loop,
`#refreshContextTools`, `#onListChanged`, `setup`, the stdio callbacks and subscription
restoration. A key that is removed and re-added during a reconnect therefore never sees the old
loop's results.

### When reconnect applies

The controller arms when `setup()` commits its tool list and the registration is still current.
Until then a loss behaves as today, so a wrong URL or a bad command fails the add at once instead
of after the backoff. A context never set up (tools passed directly) never arms. (Builder's call,
2026-11-11.)

`setup()` on an armed registration: while `reconnecting` it waits at the gate; while `connected`
it runs on the captured client and, if a swap happened meanwhile, discards its result and returns
the current tools. `Session` / `NodeSession` setup cleanup (`#removeIfOurs`, `stillOurs`) compares
the registration object (stable across swaps) instead of the client, so an abort that lands after
a successful setup never removes a context it does not own and never leaves one it does.

### Loss detection

Loss is classified where the evidence is, never from messages:

- **Raw fetch boundary.** The transport's innermost fetch (`runtime.fetch`, under the timeout and
  redirect wrappers) marks a rejection as `NetworkError` (cause kept) unless the caller's signal
  aborted, the transport is disposed, or the request timed out. Only the transport's own requests
  to its MCP URL qualify: OAuth discovery, token and revocation fetches that the middleware makes
  through the same fetch are never loss, nor are errors thrown by middleware (OAuth storage,
  configuration) or by the redirect guard.
- **Typed failure channel.** When the transport fails a request locally it brands the error
  frame's `data` with a symbol-keyed field (`TRANSPORT_FAILURE`, `{ kind, status? }`), which no
  JSON from a server can produce: `kind` is `network`, `timeout`, `auth-required` (the
  middleware's `AuthRequiredError`), `http` (with the final status, including a `401` the
  middleware returned after its own retry) or `session-expired`. `@mokei/http-client` exports
  `transportFailureOf(error)` to read it; the host never reads message text or string-keyed
  `data`. Errors the server sent (including JSON-RPC errors carried in an HTTP response) never
  carry the brand. If `RPCError.fromResponse` turns out not to keep the `data` object, the builder
  uses an out-of-band per-transport registry keyed by request id instead.
- **Connection events.** `HTTPTransport` emits `connection` `{ type: 'failed', error }` on a
  `NetworkError` and `{ type: 'session-expired' }` on the `2025-11-25` session `404` (POST, and
  the GET stream when it held a session). `5xx`, other HTTP responses, timeouts, aborts and
  middleware errors are not loss.
- **Idle loss (user decision, 2026-11-11), method-aware.** The GET stream and
  `subscriptions/listen` report loss after two consecutive `NetworkError`s on their own
  re-opens; any other request reports on the first. The subscription driver treats an error
  frame of kind `network` as retryable (it stops on non-retryable errors today), so its second
  attempt can happen. Limits, documented: a server without a GET stream or a resource-subscription
  capability (no auto-opened `listen`) is only checked lazily, on the next call; a GET `404`
  without a session still stops that stream for good.
- **Any kind:** the client `closed` event, as today.
- **Stdio:** `onStreamError` and `onExit` route to the controller instead of emitting
  `context:failed` and removing.
- A loss reported for a generation already lost, or while a reconnect runs, is ignored.

### On loss: quiesce at once

The lost generation is shut down immediately, not after a replacement succeeds:
1. `generation += 1`, state `reconnecting`, gate closed.
2. Detach the old client's host listeners and settle its context span as `lost`.
3. Dispose the old client in the background (kills the child, stops streams, rejects pending
   calls), with its transport set non-interactive first (see Authorisation); a `session-expired`
   transport skips its `DELETE`.
4. The registration keeps its tool metadata (`entry.tools`) while reconnecting.

Disposal never waits on, or depends on, a successful replacement.

### Reconnect loop

A hand-rolled loop over `getRetryDelay` from `@sozai/async` (full jitter), because `retry` has no
pause and every failed attempt would count while offline.

1. Emit `context:reconnecting { key, attempt, error }` before each attempt.
2. If `connectivity` says offline, wait for `subscribe` to report online (or poll `isOnline` at
   the delay when there is no `subscribe`) without spending an attempt. A missing or throwing hook
   counts as online. The wait has no limit (user decision, 2026-11-11).
3. Build a candidate from the factory (non-interactive) and run `listTools`; merge as
   `#refreshContextTools` does (keep `enabled`/`allow` by name, new tools enabled, vanished
   tools dropped).
4. On success, if still the owner: commit the swap (below), state `connected`, open the gate, emit
   `context:reconnected { key, attempts }`, then `tools:changed` when the list changed, then
   start subscription restoration.
5. On failure, dispose the candidate and wait the backoff delay. A failure of kind
   `auth-required` or `http` `401` ends the loop at once.
6. After `maxAttempts`, an auth failure, or `respawn` returning `false`: emit
   `context:failed { key, error }` (an `AuthRequiredError`, or `ReconnectExhaustedError` with the
   last error as cause), then `remove(key, 'lost')` (which emits `context:removed`).

`remove(key)` or `dispose()` during a reconnect bumps the generation, aborts the loop, disposes any
candidate, and fails gate waiters with a `ContextUnavailableError` whose cause is the removal.

### Swap commit

Synchronous, after the ownership check: replace `entry.client`, `entry.disposer` and `entry.tools`
on the registration; wire the new client's listeners with per-generation callbacks; set the
transport interactive; start the new client's context span (linked to the lost one).

### Call gate and deadlines

`callTool`, `callNamespacedTool` and `getPrompt` take one deadline at entry, from the call's
`timeout` (or the client default). The gate wait uses `min(gateTimeoutMs, remaining)`; the call
then runs with `timeout: remaining`, so waiting and a retry never grant a fresh budget.

- The caller's `AbortSignal` is checked before waiting, on wake, and before dispatch; when the
  abort and the gate opening race, the abort wins. Aborts reject with the signal's reason.
- Before dispatch the registration is re-read and must be the one captured at entry: if the key
  was removed, or removed and re-added, the call fails with `ContextUnavailableError` instead of
  running on a different registration. The client is read from it then, never captured before the
  wait.
- A gate timeout fails with `ContextUnavailableError`. `callNamespacedTool` (the agent path)
  returns only that error as an `isError: true` tool result, like `callLocalTool`; every other
  error, aborts included, keeps today's behaviour. `callTool` and `getPrompt` reject with it.

### Read-only retry (kept, user decision 2026-11-11)

The call in flight at loss fails with its transport error. The host retries it once, on the new
client and within the remaining deadline, only when all hold:
- the call is a `tools/call` whose tool (as listed on the lost generation) has
  `annotations.readOnlyHint === true`;
- it failed with the loss itself: a `TransportClosedError` from the lost generation's client, or an
  error frame of kind `network` / `session-expired`, and the generation it was sent on is the one
  that was lost;
- no task was accepted: `ContextClient.callTool` rejects with `TaskInterruptedError` (cause: the
  transport error) when the loss happens after the server returned a task, and that is never
  retried;
- the caller did not abort and the deadline has time left.

Timeouts, validation failures, RPC errors from the server, and anything else are never retried.

### Subscriptions (kept, user decision 2026-11-11)

`2026-07-28`: a new client re-opens the base `listChanged` subscription by itself. Resource
subscriptions go through new host methods `subscribeResource(key, uri)` /
`unsubscribeResource(key, uri)`, serialised per key in one queue:
- subscribe calls the client and adds the URI to the key's desired set only after the server
  acknowledges it; unsubscribe removes the URI first, then calls the client;
- restoration after a swap runs in the same queue, one URI at a time from a snapshot, skipping URIs
  no longer desired; it stops when ownership is lost;
- the gate opens before restoration; calls do not wait for it;
- restoration requests are non-interactive per request (the tag is set on each restoration
  request, whatever the committed transport's mode), so a `403 insufficient_scope` on a
  re-subscribe drops that URI rather than starting a sign-in;
- a failed unsubscribe puts the URI back in the desired set (the client driver also keeps it,
  as it commits only acknowledged changes), so host and client intent stay the same;
- if the new server lacks resource subscriptions, or a re-subscribe fails, the URI is dropped
  from the desired set and `resource:subscription-lost { key, uri, error }` is emitted.

Subscriptions made directly on a client are not carried over.

### Authorisation

A reconnect never opens a sign-in window. `HTTPTransport` has an interaction mode it stamps on
every request it sends (an internal `RequestInit` tag, like the timeout tag): candidates and lost
generations being disposed are non-interactive; a committed swap switches the new transport to
interactive. In non-interactive mode `createOAuthMiddleware`:
- still attaches stored tokens and refreshes them;
- may join a sign-in another request already started (it opens no window itself; bounded by
  `authorizationTimeout`);
- throws `AuthRequiredError` before entering the authorize queue on a `401`;
- returns a `403 insufficient_scope` as-is instead of stepping up;
- applies the same rules to the `DELETE` sent on dispose.

A request of the lost generation already inside an interactive sign-in when the loss happens is
not converted: quiescing disposes that transport, which aborts its requests, so the handler's
`signal` aborts and the sign-in ends.

The host ends the loop on `auth-required` or a final `401`. Once removed, the consumer re-adds the
context, which may sign in normally.

### Events

- New: `context:reconnecting { key, attempt, error }` (each attempt), `context:reconnected { key,
  attempts }` (once per recovery), `resource:subscription-lost { key, uri, error }`.
- Terminal ending of a reconnect: `context:failed` once, then `context:removed` once.
- Changes to existing behaviour, reconnect on or off: `addHTTPContext` and `addDirectContext` emit
  `context:added`, as stdio does today. Nothing else changes when `reconnect` is off.

### Consumers

- CLI chat: `reconnect: true` for `/context add` and `/context add-http`; reconnecting /
  reconnected / subscription-lost notices next to the existing `context:failed` one; its context
  list follows host `context:removed` (today a lost context stays listed).
- Flow host holds the decision-flow direct context's client; that context does not enable
  reconnect.
- Clients from `getContext(key).client` or `add*Context` are not gated and go stale after a swap;
  `getContext(key).client` always returns the current one. Documented on `reconnect`.

### Tracing

One `mcp.context` span per client. A lost client's span ends with `error.type=context.lost`; the
new client's span links to it and carries `mokei.context.reconnect.attempt`.

## Constraints

- Defaults: `maxAttempts` 5, `initialDelayMs` 250, `maxDelayMs` 5 000, `gateTimeoutMs` 10 000.
- No new package. Changes in `@mokei/host`, `@mokei/host-node`, `@mokei/http-client`,
  `@mokei/context-client`, `@mokei/session`, `@mokei/session-node`, `@mokei/cli`.
- Patch changeset.

## Left to the builder

- Exact error class names and where they are exported (`@mokei/host` for
  `ContextUnavailableError`, `ReconnectExhaustedError`; `@mokei/http-client` for
  `AuthRequiredError`, `NetworkError`; `@mokei/context-client` for `TaskInterruptedError`).
- Whether the controller lives in a new `host/src/reconnect.ts` (likely) or inside `host.ts`.
- Test fixtures for stdio respawn (a tiny server script that exits on demand).
