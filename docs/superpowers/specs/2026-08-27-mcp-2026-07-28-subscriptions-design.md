# Design: MCP `2026-07-28` resource subscriptions (`subscriptions/listen`, B4)

**Date:** 2026-08-27
**Branch:** `feat/mcp-2026-07-28-subscriptions`
**Source item:** `docs/agents/plans/next/2026-08-27-mcp-2026-07-28-subscriptions.md`
**Milestone:** `docs/agents/plans/milestones/2026-06-08-mcp-2026-07-28-migration.md` (piece E / B4, SEP-2575)
**Reviewed:** Codex pre-implementation design review, two passes, 2026-08-27 (8 findings + 7 second-pass
tightenings, all folded in — see "Design-review resolutions").

## Summary

Implement `subscriptions/listen` on the `2026-07-28` revision — the last capability gap in the
MCP spec migration. `subscriptions/listen` is a single long-lived client→server request whose
response stream stays open, carrying every out-of-band server→client notification the client
opted into: `toolsListChanged`, `promptsListChanged`, `resourcesListChanged`, and per-URI
`resourceSubscriptions`. It replaces the GET/SSE endpoint plus `resources/subscribe` that
`2025-11-25` used.

This design covers `2026-07-28` only. The `2025-11-25` `resources/subscribe`/`unsubscribe`
dispatch gap is deliberately deferred (see the source item; implement only if a real peer needs
it). The work spans `context-protocol`, `context-rpc`, `context-client`, `context-server`,
`http-server` and `http-client`, on both stdio and Streamable HTTP transports.

## Decisions (locked in brainstorming)

1. **Revision scope:** `2026-07-28` only.
2. **Breadth:** full — client-receive, server-serve, and server producers.
3. **Producer API:** the server's existing `@sozai/event` `EventEmitter` (`server.events`). Producers
   emit typed events; a `SubscriptionHub` subscribes via `events.on(...)` and fans out.
4. **Consumer API:** the client auto-opens one listen stream after setup (iff `server/discover`
   advertises the relevant capabilities), routing frames to existing consumers; plus explicit
   `subscribeResource({ uri })` / `unsubscribeResource({ uri })`.
5. **Stateless-HTTP lifetime:** a durable server owns a shared `SubscriptionHub`; each listen POST is
   served by its own transport-isolated `ContextServer` that borrows the hub. See "Execution model".
6. **Host integration (mechanism, not policy):** the host reacts by keeping its aggregate correct
   and emitting host events; it defines no agent behavior. Consumers drive reactions via
   `host.events.on(...)`.
7. **Runtime primitives:** ids are minted with `getRandomID()` from `@sozai/runtime` (RN-safe;
   consistent with the Node-free `-node` split), never `crypto.randomUUID()`.

## Design-review resolutions (Codex, 2026-08-27)

### First pass (8 findings)

| # | Finding | Resolution |
|---|---------|------------|
| 1 (blocker) | A shared durable `ContextServer` cannot multiplex stateless listen POSTs (one transport per server; subscriptionId == request id collides across clients) | **Unified execution model** (below): every listen is served by a normal `ContextServer` via `_holdResponse`; the durable server owns only a shared `SubscriptionHub` (registry + producer fan-out) that per-POST transport-isolated servers borrow. Registry keyed by an internal `connectionID` (`getRandomID()`, never on the wire) + subscriptionId. Fan-out routes through each serving server's own notify path; it never locates a response by subscriptionId. |
| 2 (major) | "Hold response open" is incompatible with the RPC lifecycle | First-class `HeldResponse` disposition + explicit `running → detached → terminal-writing → removed` state machine (below). |
| 3 (major) | Abrupt POST-SSE end neither closes the transport nor settles the exchange | Per-exchange `streamEvents.closed{requestID}` from `HTTPTransport`; `ExchangeRegistry.close(id)` settles just that exchange; reconnect reuses the same transport; stdio EOF stays a whole-client close. |
| 4 + 6 (major) | Backpressure at the wrong layer; ack-first can race fan-out | Per-subscription serialized bounded `SubscriptionWriter` (256 cap, disconnect-on-overflow); ack **written** before the registry entry is published. |
| 5 (major) | "Tear down old, open new" leaves gaps/dupes and races | Generation-based `SubscriptionDriver`; open+ack the new filter before retiring the old; frame gating; mutations and reconnect share one queue (below). |
| 7 (major) | Capability could advertise where the deployment can't serve | Advertise only with resources configured **and** a hub present; owner/borrower construction (below). |
| 8 (minor) | Bridge extraction described loosely | `routeStreamNotification` correlator; exact `_meta` paths; `RequestID` validation; malformed → `onError`, unknown → drop. |

### Second pass (7 tightenings)

| Area | Tightening |
|------|------------|
| HTTP execution seam (1/2) | The listen POST no longer calls a binding sink that writes the terminal itself. It runs a transport-isolated `ContextServer` (`runSubscriptionExchange`, no stateless timeout, no close-after-ack) that validates/dispatches; `_holdResponse` is the **single** terminal owner; the hub holds only registry/fan-out state; the sink has **no** `writeTerminalResult`. |
| Held-request state machine (2) | One authoritative transition `running → detached → terminal-writing → removed`. The scheduler keeps duplicate-id + cancellation ownership until `completeDetached(id)`; `ContextRPC` owns only the terminal promise/write. cancel-vs-terminal is first-settlement-wins with exactly one cleanup path. `wrapResult` stays in `ContextServer`: the held `terminal` resolves to an already-wrapped server result; `ContextRPC` only builds the JSON-RPC envelope and writes it. |
| Hub ownership (7) | `subscriptions: true` on the durable server **creates and owns** the hub, attaches producer listeners to its own `server.events`, and disposes it. A borrower gets `subscriptionHub` (affects capability advertising) and does **not** re-subscribe. `HTTPHandler.dispose()` asks the owner to end streams but never disposes a hub it does not own. |
| Teardown/cancellation (4) | `hub.register(...)` returns a handle `{ close(reason?), acknowledged }`; `close` is idempotent. Both request abort and response-body cancellation call it. The 5s deadline covers queue drain **plus** terminal write; on timeout the single outcome is abrupt close. |
| Reconnect × generation (5) | Reconnect is enqueued on the same mutation queue. A candidate reconnect retains its generation + filter snapshot; an active-stream reconnect must not overtake an unacknowledged candidate. The first candidate frame **must** be `acknowledged`; an ordinary frame before it is a protocol error (via `onError`), not a silent generation-drop. |
| Ack contract (6) | `writer.enqueue(acknowledgement)` resolves only after `sink.writeNotification` **succeeds**, not merely on enqueue. |
| Runtime + table (7) | connectionID uses `runtime.getRandomID()` everywhere; the table no longer mentions `crypto.randomUUID`. |

## Authoritative wire shape

Pinned against `@modelcontextprotocol/core@2.0.0` (vendored under
`node_modules/.pnpm/@modelcontextprotocol+core@2.0.0`, the `2026-07-28` reference implementation).
Re-validate against the final spec text before implementing.

- **`subscriptions/listen` request** — `params.notifications` is a `SubscriptionFilter`:
  `{ toolsListChanged?, promptsListChanged?, resourcesListChanged?: boolean, resourceSubscriptions?: string[] }`.
  Each type is opt-in; the server MUST NOT send a type the client did not request.
- **`notifications/subscriptions/acknowledged`** — the **first** message on the stream, echoing the
  filter the server agreed to honor.
- **`notifications/resources/updated`** — `params.uri`; sent only for a URI in the filter's
  `resourceSubscriptions`.
- **listChanged notifications** — `notifications/{tools,prompts,resources}/list_changed` (already in
  the `2026-07-28` `serverNotification` union).
- **Subscription id** — streamed notifications carry
  `params._meta['io.modelcontextprotocol/subscriptionId']`; the terminal result carries it under
  `result._meta`. Its value **equals the listen request's JSON-RPC id**.
- **Terminal `subscriptions/listen` result** — sent only on graceful teardown, with
  `resultType: 'complete'`; an abrupt transport close carries no response and the client re-sends.

## Architecture

### Execution model (unified across transports)

**A listen request is always served by a normal `ContextServer`.** Validation, protocol resolution,
method gating, `_meta` handling, `wrapResult`, and the decorated `notify` path all apply. The only
new server behavior is that its `subscriptions/listen` handler returns `_holdResponse(...)` instead
of a result body.

The **`SubscriptionHub`** is shared cross-connection state — nothing more:

```ts
// context-server/src/subscriptions.ts
export type SubscriptionEntry = {
  connectionID: string
  subscriptionID: RequestID
  filter: SubscriptionFilter
  deliver: (n: ServerNotification) => Promise<void> // routes through the serving server's notify
}
export type SubscriptionHandle = { close(reason?: Error): void; acknowledged: Promise<void> }
export type SubscriptionHub = {
  register(entry: SubscriptionEntry): SubscriptionHandle // nested Map<connectionID, Map<RequestID, …>>
  endAllGracefully(): Promise<void>
  dispose(): Promise<void>
}
```

- The hub owner (`subscriptions: true`) subscribes once to its own `server.events`
  (`resourceUpdated`/`toolsListChanged`/`promptsListChanged`/`resourcesListChanged`) and, on each
  event, iterates matching entries and calls `entry.deliver(notification)` — a `resourceUpdated`
  only for streams whose `resourceSubscriptions` include the URI; a listChanged only for streams
  that opted in. **Fan-out never locates an HTTP response by subscriptionId**; it calls the
  `deliver` the serving server registered.
- `deliver` routes through the serving server's own per-subscription `SubscriptionWriter` (serialized,
  bounded) and its decorated `notify`, so `_meta.subscriptionId` injection and revision decoration
  are applied by the same server that owns the wire.

Per transport:

| Transport | Hub owner | Serving server for a listen |
|-----------|-----------|-----------------------------|
| stdio | the single persistent server | the same server (owner == connection) |
| `2025-11-25` HTTP | the session's persistent server | the same server |
| `2026-07-28` HTTP (stateless) | a durable server the deployment supplies | a fresh transport-isolated `ContextServer` per listen POST, **borrowing** the hub |

For `2026-07-28` HTTP a listen POST runs `runSubscriptionExchange` (a variant of
`runStatelessExchange` with no response timeout and no close-after-ack): it builds a transport-isolated
`ContextServer` on its own SSE bridge, injected with the shared hub and an internal
`connectionID = runtime.getRandomID()`. That server validates and dispatches the listen; `_holdResponse`
owns the terminal; the hub only records the entry and fans out. Other `2026-07-28` POSTs stay on
`runStatelessExchange` unchanged. If no durable hub is configured, a listen POST gets
`METHOD_NOT_FOUND` and `resources.subscribe` is not advertised.

Smallest correct version: one in-process hub per HTTP handler/deployment; no cross-process delivery
(a multi-instance deployment would later need an external broker — out of scope).

### Client correlation

`subscriptionId == the listen request's JSON-RPC id`, so the client models a listen as a stream
exchange and the streamed notifications feed its sink through an **optional correlator** (not inline
protocol-sniffing):

- New optional `RPCParams.routeStreamNotification(notification) => { id, frame } | null`.
  `_handleMessage`'s notification branch calls it; a non-null route → `#exchanges.routeStreamFrame`,
  null → `_handleNotification`. A throw → `#reportError`, notification consumed.
- The client extractor reads `notification.params._meta['io.modelcontextprotocol/subscriptionId']`,
  validates a string/integer `RequestID`, returns `{ id, frame: { type: 'progress', value: n } }`.
  The `acknowledged` notification is the first such frame.
- The terminal result settles via `routeResponse` (correlated by envelope `id`); the driver also
  verifies `result._meta` subscriptionId equals the envelope id — a mismatch is a protocol error,
  not a graceful terminal.

### Long-lived inbound requests (`context-rpc`) — held-request state machine

A `subscriptions/listen` handler must not resolve immediately. Add a first-class held-response
disposition with one authoritative state machine: **`running → detached → terminal-writing → removed`.**

- `HeldResponse<Result> = { kind: 'held', terminal: Promise<Result>, beforeTerminal?: () => Promise<void> }`
  and a protected `_holdResponse({ terminal, beforeTerminal })`. `ContextServer._handleRequest`
  returns it for a listen; subclasses still return result bodies, never write responses.
- **Scheduler** gains `#detached: Map<RequestID, AbortController>`. On a `HeldResponse` it atomically
  moves the controller from `#running` to `#detached` and **reclaims the concurrency slot** — a listen
  counts against the cap only while validating/registering. The scheduler retains **duplicate-id
  protection and cancellation ownership** for a detached id until `completeDetached(id)`. `cancel(id)`
  and `abortAll` cover detached requests.
- **Terminal ownership:** `ContextRPC` owns only the terminal promise and write task. When `terminal`
  resolves it awaits `beforeTerminal` (drains the subscription's queue), builds `{ id, result }` and
  writes it, then calls `completeDetached(id)`. **`wrapResult` stays in `ContextServer`:** the held
  `terminal` resolves to an already-wrapped server result; `ContextRPC` only envelopes and writes.
- **cancel vs terminal = first-settlement-wins**, with exactly one cleanup path that removes both the
  scheduler and RPC records. Cancellation aborts and removes without a result.
- **Disposal ordering:** a protected `_beforeTransportClose(reason)` hook runs before close. Explicit
  `#dispose` becomes `_beforeTransportClose` → flush held responses → `#close` → `transport.dispose()`.
  `ContextServer._beforeTransportClose` calls `hub.endAllGracefully()` (only if it owns the hub). A
  bounded deadline (5s) covers drain **plus** terminal write; on timeout the single outcome is abrupt
  close. **Peer EOF stays abrupt** — the hook does not run when the read loop finds the peer gone.

## Components

### 1. `@mokei/context-protocol` — schema

New `src/subscriptions.ts`: `subscriptionFilter`; `subscriptionsListenRequest` (`forbidRetryParams`);
`subscriptionsAcknowledgedNotification`; `subscriptionsListenResult` (terminal, `result._meta`
subscriptionId, requires `resultType: 'complete'`); `META_SUBSCRIPTION_ID` +
`subscriptionMetadata` (`requestId`, required) — required in `params._meta` for ack + streamed
notifications, in `result._meta` for the terminal; `wrapResult` must merge server-info metadata
**without** overwriting the subscriptionId. Reuse `resourceUpdatedNotification`. Wire into
`versions/2026-07-28.ts` (`clientMethods` + server notification/result unions); barrel exports; a
`versions.test.ts` membership guard.

### 2. `@mokei/context-rpc`

The held-response primitive + state machine + `_beforeTransportClose` (above); `ExchangeRegistry.close(id, reason)`
(settle one stream exchange `'closed'`); `StreamSettle = { reason, error? }` on `onSettle`; the optional
`routeStreamNotification` correlator; subscribe to a transport's optional `streamEvents.closed` capability.

### 3. `@mokei/context-client`

A `src/subscriptions.ts` `SubscriptionDriver` owning generations, the desired-URI set, and **one**
mutation queue that also serializes reconnect:
- `subscribeResource({ uri, signal?, timeout? })` / `unsubscribeResource(...)` mutate `#desiredResources`,
  allocate a generation, open+ack the new filter **before** retiring the previous exchange, promote on
  ack, then abort the old; each settles on its generation's ack (or rejects on permanent failure).
- Frame gating by generation (the ack handler is the exception, needed to promote). The **first**
  frame of a candidate must be `acknowledged`; an ordinary frame before it → `onError` protocol error.
- Reconnect is enqueued on the same queue: a candidate reconnect keeps its generation + snapshot; an
  active-stream reconnect must not overtake an unacknowledged candidate. Capped backoff (1s base, 30s
  cap, no jitter), reusing the same transport+client, emitting `subscriptionRetry { attempt, error, retryInMs }`.
  Do not retry on terminal result, local cancellation, protocol/schema error, or `METHOD_NOT_FOUND`.
  Auto-reconnect never fails post-setup readiness.
- Auto-open one stream after setup iff `server/discover` advertises the caps (opt into only the
  notification types a consumer is wired for). Route frames: listChanged → `_resetDiscovery()`;
  resourceUpdated → per-URI subscribers + `#notifications` buffer. Supplies the subscription-id extractor.

### 4. `@mokei/context-server`

- `SubscriptionHub` + `SubscriptionEntry` + filter matching + notification construction in
  `src/subscriptions.ts`. **Owner/borrower:** `subscriptions: true` creates and owns the hub, attaches
  producer listeners to its own `server.events`, disposes it; a server given `subscriptionHub` borrows
  it (affects capability advertising) and does not re-subscribe.
- Per-subscription **`SubscriptionWriter`** (serialized single drain, 256 cap). Overflow → stop
  accepting, unregister, `SubscriptionBackpressureError` via `onError`, abrupt sink close (no terminal)
  → client reconnect re-establishes. `enqueue`/`flush`/`abort`. `enqueue(ack)` resolves only after the
  underlying write **succeeds**. Never concurrent writes for one subscription.
- **Ack-first:** create writer → `await writer.enqueue(acknowledgement)` (written) → **then**
  `hub.register(entry)`. Producers cannot target a not-yet-acknowledged stream.
- **Producers:** extend the server `Events` map with `resourceUpdated: { uri }` + dataless
  `toolsListChanged`/`promptsListChanged`/`resourcesListChanged`; deployments emit via `server.events`.
- **Dispatch:** `subscriptions/listen` returns `_holdResponse(...)` bound to the entry's terminal +
  `beforeTerminal` drain. The `SubscriptionHandle.close(reason)` (idempotent) is wired to abort.
- **Capability (#7):** set `resources.subscribe: true` only when resources are configured **and** a hub
  is available. The server factory takes `{ transport, subscriptionHub }` so a throwaway server
  answering `server/discover` reports the same effective availability; capability ownership stays in
  `context-server`.

### 5. `@mokei/http-server`

- `src/subscriptions.ts`: the HTTP/SSE sink (**no** `writeTerminalResult`), per-POST `connectionID`
  via `runtime.getRandomID()`, lifecycle. `runSubscriptionExchange` (no timeout, no close-after-ack).
- `handler.ts`: recognize a `subscriptions/listen` request POST, require the configured hub, run a
  transport-isolated server via `runSubscriptionExchange` bound to a dedicated SSE response + the hub;
  return that response; on request abort or response-body cancellation call the idempotent
  `SubscriptionHandle.close`. Other `2026-07-28` POSTs stay on `runStatelessExchange`. No hub → listen
  gets `METHOD_NOT_FOUND`.
- `createHTTPHandler` gains `subscriptionHub?` and optional `runtime?: Partial<Runtime>` (`@sozai/runtime`,
  resolved via `createRuntime`).

### 6. `@mokei/http-client`

`HTTPTransport` implements the optional `StreamLifecycleTransport` capability: emit
`streamEvents.closed { requestID }` when a POST SSE body ends **without** a terminal response for that
id. Do not emit on `notifications/cancelled` abort, whole-transport disposal, or after a terminal
response.

### 7. `@mokei/host` — integration (mechanism, not policy)

The host subscribes to each `2026-07-28` context's listen stream. On listChanged: re-discover the
affected list, update the namespaced aggregate, emit `HostEvents` `tools:changed`/`prompts:changed`/
`resources:changed` `{ key }` (turn-boundary semantics via per-turn aggregate reads). On resourceUpdated:
forward `resource:updated { key, uri }` (no auto re-read). `Session`/`AgentSession` unchanged.

### 8. Interop + tests

Unit per layer (schema incl. `_meta` placement + `resultType: 'complete'`; correlator + validation;
`ExchangeRegistry.close`; held-response state machine incl. cancel-vs-terminal race + slot release +
disposal ordering; `SubscriptionWriter` overflow + ack-written-before-publish; hub fan-out + filter
honoring; owner/borrower capability gating; generation gating + reconnect-in-queue; per-exchange
stream-close). Interop against SDK v2 both directions over stdio + HTTP, including **two concurrent SDK
clients reusing request id `0`** to exercise `connectionID` keying on stateless HTTP.

## Out of scope

- `2025-11-25` `resources/subscribe`/`unsubscribe` dispatch (deferred).
- Any built-in `AgentSession`/`Session` reaction (consumer-driven).
- Dynamic tool/prompt/resource list-mutation APIs beyond emitting listChanged.
- Cross-process / multi-instance subscription delivery.
- Notification coalescing (a later overflow policy; smallest version disconnects).

## Breaking API changes

Distinguish **type breaks** from **semantic changes**:

- **Semantic only:** `ContextRPC.dispose()` / `ContextServer.dispose()` already return a promise via
  `@sozai/async`'s `Disposer`; their teardown **ordering** changes (terminal flush before close) but
  the public return type does not.
- **Type break:** `HTTPHandler.dispose(): void → Promise<void>` (handler.ts:70).
- **Type break:** `ServeHTTPResult.dispose(): void → Promise<void>` (serve.ts:15) — must await handler
  teardown before closing the Node server.
- **Type break:** `SessionManager.dispose()` / `SessionManager.delete()` `void → Promise<void>`
  (session.ts:94) — they dispose session servers, so terminal flushing needs them awaited (or an
  awaited internal variant if the exported signatures are kept).
- **Type break:** the HTTP server factory `createServer(transport) → createServer({ transport, subscriptionHub })`;
  `createHTTPHandler` gains `subscriptionHub?` + `runtime?`.
- `StreamHandlers.onSettle(reason) → onSettle({ reason, error })` — internal to `context-rpc`; a public
  break only if that type is exported.
- Additive (not breaking): the optional `runtime`, `subscriptionHub`, client `subscribeResource`/
  `unsubscribeResource`, and new event members.

These land in the same fixed release group; the migration already plans a `2026-07-28` version bump.

## Error handling & teardown

- Per-exchange abrupt POST-SSE close → `streamEvents.closed` → `ExchangeRegistry.close(id, 'closed')`
  → client reconnect (in the mutation queue). Whole transport close → `endAll('closed')`, no internal
  reconnect (stdio EOF = host rebuilds).
- Client disconnect / response-body cancellation (server) → idempotent `SubscriptionHandle.close`,
  unregister, cancel the held request (no terminal).
- Graceful shutdown → `_beforeTransportClose` → per-stream drain + terminal result, 5s deadline
  covering drain + write, then abrupt close.
- Abort of a listen exchange (client) → `'cancel'`, sends `notifications/cancelled`.
- Server backpressure → serialized bounded writer; overflow disconnects with
  `SubscriptionBackpressureError`. The client `NOTIFICATION_BUFFER_CAP` is a **separate** consumer policy.
- Malformed subscription metadata → `onError`; valid-but-unknown subscriptionId → dropped.

## Testing strategy

TDD per layer, bottom-up: protocol schema → RPC held-response state machine + correlator +
`ExchangeRegistry.close` → client `SubscriptionDriver` → server hub/writer/owner-borrower → HTTP
`runSubscriptionExchange` + http-client stream-close → host events → interop. Interop suites gate the
feature against the SDK v2 peer, including the two-clients-same-id case.

## Open items for the plan

- Exact hub/handle teardown ordering vs the HTTP sink under the 5s deadline (drain-then-terminal).
- Whether the auto-open filter should include listChanged types the host will not act on.
- Re-validate all payload shapes and the `resultType: 'complete'` rule against the final `2026-07-28`
  spec text, not only SDK v2.
- Confirm scheduler `#detached` accounting interacts correctly with the bounded concurrent-dispatch
  defect-wave changes.
