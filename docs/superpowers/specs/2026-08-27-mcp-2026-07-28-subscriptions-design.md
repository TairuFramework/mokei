# Design: MCP `2026-07-28` resource subscriptions (`subscriptions/listen`, B4)

**Date:** 2026-08-27
**Branch:** `feat/mcp-2026-07-28-subscriptions`
**Source item:** `docs/agents/plans/next/2026-08-27-mcp-2026-07-28-subscriptions.md`
**Milestone:** `docs/agents/plans/milestones/2026-06-08-mcp-2026-07-28-migration.md` (piece E / B4, SEP-2575)
**Reviewed:** Codex pre-implementation design review, 2026-08-27 (8 findings, all folded in — see
"Design-review resolutions").

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
   emit typed events; a `SubscriptionRegistry` subscribes via `events.on(...)` and fans out.
4. **Consumer API:** the client auto-opens one listen stream after setup (iff `server/discover`
   advertises the relevant capabilities), routing frames to existing consumers; plus explicit
   `subscribeResource({ uri })` / `unsubscribeResource({ uri })`.
5. **Stateless-HTTP lifetime:** persistent-server binding — refined by the review (#1) into a
   `ServerSubscriptionBinding` owned by the durable server, with each listen POST kept
   transport-isolated. See "Transport lifetime".
6. **Host integration (mechanism, not policy):** the host reacts by keeping its aggregate correct
   and emitting host events; it defines no agent behavior. Consumers drive reactions via
   `host.events.on(...)`.

## Design-review resolutions (Codex, 2026-08-27)

| # | Finding | Resolution in this design |
|---|---------|---------------------------|
| 1 (blocker) | A shared durable `ContextServer` cannot multiplex stateless listen POSTs; `ContextServer` owns one transport and subscriptionId (== request id) is not unique across clients | `ServerSubscriptionBinding` owned by the durable server; each listen POST stays transport-isolated with its own SSE sink; registry keyed by an internal `connectionID` (`crypto.randomUUID`, never on the wire) + subscriptionId, nested-map. Fan-out writes to each entry's captured sink, never locating a response by subscriptionId. |
| 2 (major) | "Hold response open" sentinel is incompatible with the RPC lifecycle (every request must resolve; scheduler slot held; disposal closes before terminal write) | First-class `HeldResponse` disposition + `_holdResponse` helper; scheduler moves the request to a `#detached` set and reclaims its concurrency slot; `ContextRPC` owns the terminal write; `_beforeTransportClose` hook flushes terminal results before transport close; `dispose()` becomes async with a bounded flush deadline. |
| 3 (major) | An abrupt POST-SSE stream end neither closes the transport nor settles the exchange, so `endAll` cannot drive reconnect | Per-exchange stream-ended signal: `HTTPTransport` emits `streamEvents.closed{requestID}`; `ExchangeRegistry.close(id)` settles just that exchange (`'closed'`); reconnect reuses the same HTTP transport+client; stdio EOF stays a whole-client close (host rebuilds). |
| 4 + 6 (major) | Backpressure named at the wrong layer; ack-first can race producer fan-out | Per-subscription `SubscriptionWriter` (serialized drain, hard 256-frame bound, disconnect-on-overflow via `SubscriptionBackpressureError`); ack enqueued **before** the registry entry is published, so producers can't target a not-yet-acknowledged stream. |
| 5 (major) | "Tear down old, open new" leaves gaps/dupes and races under concurrent mutation | Generation-based `SubscriptionDriver` in `context-client`: open+ack the new filter before retiring the old, gate frames by generation, serialize mutations, settle each call on its generation's ack. |
| 7 (major) | Capability could advertise `resources.subscribe` even where the HTTP deployment can't serve it | Advertise only when resources are configured **and** a `subscriptionBinding` is present; the `createServer` factory takes `{ transport, subscriptionBinding }` so the throwaway server answering `server/discover` reports the same effective availability. |
| 8 (minor) | Bridge described loosely ("carrying" the id); needs strict extraction/validation | Optional `routeStreamNotification` correlator on `RPCParams` keeps protocol-specific extraction out of the generic branch; client extractor validates the value is a `RequestID`; malformed → `onError`, unknown → drop. Exact paths: notifications `params._meta`, terminal result `result._meta`. |

## Authoritative wire shape

Pinned against `@modelcontextprotocol/core@2.0.0` (vendored under
`node_modules/.pnpm/@modelcontextprotocol+core@2.0.0`, the `2026-07-28` reference implementation).
Re-validate against the final spec text before implementing.

- **`subscriptions/listen` request** — `params.notifications` is a `SubscriptionFilter`:
  `{ toolsListChanged?: boolean, promptsListChanged?: boolean, resourcesListChanged?: boolean,
  resourceSubscriptions?: string[] }`. Each type is opt-in; the server MUST NOT send a type the
  client did not request.
- **`notifications/subscriptions/acknowledged`** — the **first** message the server sends on the
  stream, echoing the `notifications` filter it agreed to honor.
- **`notifications/resources/updated`** — `params.uri`; sent only for a URI in the filter's
  `resourceSubscriptions`.
- **listChanged notifications** — `notifications/tools/list_changed`,
  `notifications/prompts/list_changed`, `notifications/resources/list_changed` (already in the
  `2026-07-28` `serverNotification` union).
- **Subscription id** — every streamed notification carries
  `params._meta['io.modelcontextprotocol/subscriptionId']`; the terminal result carries it under
  `result._meta`. Its value **equals the listen request's JSON-RPC id**.
- **Terminal `subscriptions/listen` result** — sent only on graceful server teardown, with
  `resultType: 'complete'` under the `2026-07-28` result rules; an abrupt transport close carries
  no response, and the client re-sends.

## Architecture

### Core mechanism (client correlation)

Because `subscriptionId == the listen request's JSON-RPC id`, the client models a listen stream as
a stream exchange (`_registerStreamExchange('subscriptions/listen', { notifications }, handlers)`),
and the streamed notifications feed that exchange's sink. The wire-feeder is added as an **optional
correlator**, not inline protocol-sniffing in the generic branch (#8):

- New optional `RPCParams.routeStreamNotification(notification) => { id, frame } | null`.
  `ContextRPC._handleMessage`'s notification branch calls it; a non-null route calls
  `#exchanges.routeStreamFrame(id, frame)`, a null route falls through to `_handleNotification`.
  A throw from the correlator is reported via `#reportError` and the notification is consumed (not
  passed through).
- The client's extractor reads `notification.params._meta['io.modelcontextprotocol/subscriptionId']`,
  validates it is a string or integer `RequestID`, and returns
  `{ id, frame: { type: 'progress', value: notification } }`. The `acknowledged` notification is
  simply the first such frame.
- The terminal `subscriptions/listen` result settles the exchange via the existing `routeResponse`
  path (correlated by JSON-RPC envelope `id`); the driver additionally verifies the result's
  `result._meta` subscriptionId equals that envelope id — a mismatch is a protocol error, not a
  graceful terminal.

`ContinuationStore` stays unused (it remains the B-item that never found a consumer); the `stream`
arm of the exchange registry gains its first real wire feeder.

### Long-lived inbound requests (`context-rpc`)

A `subscriptions/listen` handler must not resolve immediately. Today every scheduled request must
produce a result (`null` → `INTERNAL_ERROR`, `rpc.ts:294`) and holds a scheduler slot
(`maxConcurrentRequests`, default 100). Add a first-class held-response disposition (#2):

- `HeldResponse<Result> = { kind: 'held', terminal: Promise<Result>, beforeTerminal?: () => Promise<void> }`
  and a protected `_holdResponse({ terminal, beforeTerminal })` helper. `ContextServer._handleRequest`
  returns `_holdResponse(...)` for a listen request; subclasses still return result bodies, never
  write JSON-RPC responses.
- **Scheduler:** track a `#detached: Map<RequestID, AbortController>`. On a `HeldResponse`, move the
  controller out of `#running` into `#detached` and **reclaim the concurrency slot immediately** — a
  listen counts against the cap only while it is being validated and registered. `cancel(id)` and
  `abortAll` cover detached requests too.
- **Terminal ownership:** `ContextRPC` tracks held requests; when `terminal` resolves it stops
  accepting frames, awaits `beforeTerminal` (drains the subscription's serialized queue), wraps the
  result through the normal server-result path, writes `{ id, result }`, and removes the held entry.
  Cancellation aborts and removes without a result (existing cancellation semantics).
- **Disposal ordering:** add a protected `_beforeTransportClose(reason)` hook. Explicit `#dispose`
  runs `_beforeTransportClose` → flush held responses → `#close` → `transport.dispose()`, so terminal
  results flush before the transport closes. `ContextServer._beforeTransportClose` calls
  `subscriptions.endAllGracefully()`. **Peer EOF stays abrupt** — the hook does not run when the read
  loop finds the peer already gone. A bounded flush deadline (smallest version: 5s) then closes
  abruptly rather than hanging.

**Breaking:** `dispose()` becomes async (`ContextRPC`, and therefore `ContextServer` and the HTTP
handler) — a synchronous `dispose()` cannot promise terminal-result-on-teardown.

### Transport lifetime + `ServerSubscriptionBinding`

| Transport | Server lifetime | How the listen stream lives |
|-----------|-----------------|-----------------------------|
| stdio | persistent (one server per process) | The server lives; registry + `events` fan-out are natural. Terminal result on graceful `dispose`. |
| `2025-11-25` HTTP | persistent (session) | The listen stream rides the session as any long-lived response. |
| `2026-07-28` HTTP (stateless) | throwaway per POST | Listen POSTs delegate to a `ServerSubscriptionBinding` on a durable server; other POSTs stay throwaway. |

**The binding (resolves blocker #1).** A shared durable `ContextServer` cannot back multiple listen
POSTs — it owns one RPC transport, and subscriptionId (== request id) collides across clients. So:

- Keep every listen POST **transport-isolated** (its own SSE response + sink + abort signal).
- The durable server owns a `ServerSubscriptionBinding` holding the `SubscriptionRegistry` and
  producer state. The HTTP handler mints an internal `connectionID = runtime.getRandomID()` per
  listen POST (**never on the wire**) and registers under a nested map
  `Map<connectionID, Map<RequestID, SubscriptionEntry>>`. Two clients using request id `0` become
  `{A,0}` and `{B,0}` — distinct.
- **Fan-out never locates a response by subscriptionId.** A producer event iterates matching registry
  entries and writes to each entry's own captured sink.

```ts
// context-server/src/subscriptions.ts
export type SubscriptionSink = {
  writeNotification(n: ServerNotification): Promise<void>
  writeTerminalResult(r: SubscriptionsListenResult): Promise<void>
  close(reason?: Error): void
}
export type ServerSubscriptionBinding = {
  open(params: { connectionID: string; request: SubscriptionsListenRequest; signal: AbortSignal; sink: SubscriptionSink }): Promise<void>
  endAllGracefully(): Promise<void>
  dispose(): Promise<void>
}
```

Smallest correct version: one in-process binding per HTTP handler/deployment, no cross-process
delivery (a multi-instance deployment would later need an external broker — out of scope).

**Runtime primitives.** The `connectionID` is minted with `getRandomID()` from `@sozai/runtime`,
not `crypto.randomUUID()` — the latter is not guaranteed on every platform (React Native), and the
`-node` split made `@mokei/host`/`context-server` deliberately Node-free. Relevant constructors and
functions (`createHTTPHandler`, and any function that mints ids) accept an optional
`runtime?: Partial<Runtime>` resolved once via `createRuntime(runtime)`, which fills `globalThis`
defaults so downstream code always has a fully-resolved `Runtime` with no optional checks. Callers
that need determinism (tests) pass an override; everyone else omits it.

## Components

### 1. `@mokei/context-protocol` — schema

New `src/subscriptions.ts` (mirrors `resource.ts` + the MRTR precedent):
- `subscriptionFilter` + `SubscriptionFilter`.
- `subscriptionsListenRequest` (`method: 'subscriptions/listen'`, `params.notifications`), given
  `forbidRetryParams` (it is not an MRTR-suspendable method).
- `subscriptionsAcknowledgedNotification` (`method: 'notifications/subscriptions/acknowledged'`).
- `subscriptionsListenResult` (terminal; `result._meta` carries the subscriptionId; requires
  `resultType: 'complete'`).
- `META_SUBSCRIPTION_ID = 'io.modelcontextprotocol/subscriptionId'` and a `subscriptionMetadata`
  fragment (`requestId`, required). Acknowledgement + streamed notifications require it in
  `params._meta`; the terminal result in `result._meta`. `wrapResult` must merge server-info
  metadata **without** overwriting the subscriptionId.
- Reuse existing `resourceUpdatedNotification` from `src/resource.ts`.

Wire into `src/versions/2026-07-28.ts`: add `subscriptions/listen` to `clientMethods`;
`subscriptionsAcknowledgedNotification` to the server notification union;
`subscriptionsListenResult` to `serverResult`/`serverResponse`. Barrel + `versions/index.ts`
re-exports; a `versions.test.ts` membership guard.

### 2. `@mokei/context-rpc`

- The held-response primitive, scheduler `#detached` handling, `_beforeTransportClose`, async
  `dispose()` (see "Long-lived inbound requests").
- `ExchangeRegistry.close(id, reason)` — settle exactly one stream exchange with `'closed'`.
- `StreamSettle = { reason: SettleReason; error?: Error }`; `StreamHandlers.onSettle(settle)` gains
  the error detail.
- Optional `RPCParams.routeStreamNotification` correlator (see "Core mechanism").
- Subscribe to a transport's optional `streamEvents.closed` capability when present, routing to
  `ExchangeRegistry.close`.

### 3. `@mokei/context-client`

- A focused `src/subscriptions.ts` `SubscriptionDriver` owning generations, the desired-URI set, and
  the mutation queue (#5).
- `subscribeResource({ uri, signal?, timeout? })` / `unsubscribeResource({ uri, signal?, timeout? })`
  mutate `#desiredResources`, allocate a generation, open+ack the new filter **before** retiring the
  previous exchange, promote on ack, then abort the old exchange; each call settles on its
  generation's ack (or rejects on permanent failure). Mutations serialize through a `#mutationTail`.
- Frame gating: each stream handler closes over its generation and drops frames when
  `generation !== #activeGeneration` (the ack handler is the exception, needed to promote).
- Auto-open one stream after setup iff `server/discover` advertises the caps (favor opting into only
  the notification types a consumer is wired for, honoring "MUST NOT send un-requested types").
- Route frames to existing consumers: listChanged → `_resetDiscovery()`/schema-cache clear;
  resourceUpdated → per-URI subscribers + the `#notifications` buffer.
- The subscription-id extractor (#8) supplied to `routeStreamNotification`.
- Reconnect (#3): on a per-exchange `'closed'` settle that is not a terminal result, reconnect with
  capped exponential backoff (1s base, 30s cap, no jitter) **reusing the same transport+client**,
  resubscribing the current desired filter; emit a `subscriptionRetry { attempt, error, retryInMs }`
  client event. Do not retry on terminal result, local cancellation, protocol/schema error, or a
  server rejection (`METHOD_NOT_FOUND`). Auto-reconnect never fails post-setup client readiness.

### 4. `@mokei/context-server`

- `SubscriptionRegistry` + `ServerSubscriptionBinding` + filter matching + notification construction
  in `src/subscriptions.ts`. The binding subscribes once to `server.events`
  (`resourceUpdated`/`toolsListChanged`/`promptsListChanged`/`resourcesListChanged`) and fans out to
  matching entries (a `resourceUpdated` only to streams whose `resourceSubscriptions` include the
  URI; a listChanged only to streams that opted in).
- **`SubscriptionWriter`** per subscription (#4/#6): a single serialized drain (one promise chain),
  hard `maxPendingFrames` bound (256). On overflow: stop accepting, remove the entry, report
  `SubscriptionBackpressureError` via the server `onError`, close the sink abruptly (no terminal) →
  the client's reconnect re-establishes. `enqueue`/`flush`/`end(result)`/`abort(reason)` API. Never
  issue concurrent `sink.writeNotification` for one subscription.
- **Ack-first activation:** create the writer, `await writer.enqueue(acknowledgement)`, **then**
  publish the registry entry. Producer events cannot target a not-yet-acknowledged stream. Graceful
  teardown: remove entry → stop accepting → drain queued → write terminal result → close sink, under
  a bounded flush deadline.
- **Producers:** extend the server `Events` map with `resourceUpdated: { uri: string }` and dataless
  `toolsListChanged` / `promptsListChanged` / `resourcesListChanged`. Deployments emit via
  `server.events` (the `EventsSink` view can be handed to producers that must not subscribe).
- **Dispatch:** `subscriptions/listen` returns `_holdResponse(...)`, bound to the registry entry's
  terminal + flush.
- **Capability (#7):** set `resources.subscribe: true` only when resources are configured **and** a
  `subscriptionBinding` is available. The server factory receives `{ transport, subscriptionBinding }`
  so a throwaway server answering `server/discover` reports the same effective availability;
  capability ownership stays in `context-server` (do not mutate discover results in `http-server`).

### 5. `@mokei/http-server`

- `src/subscriptions.ts`: the HTTP/SSE `SubscriptionSink`, per-POST `connectionID`, lifecycle.
- `handler.ts`: recognize a `subscriptions/listen` request POST, require the configured
  `subscriptionBinding`, open a dedicated held-open SSE response + sink, call
  `binding.open({ connectionID, request, signal, sink })`, return that response; on client abort
  unregister `{connectionID, subscriptionID}` and close the sink. All other `2026-07-28` POSTs stay
  on `runStatelessExchange`. If no binding is configured, a listen POST gets `METHOD_NOT_FOUND`.
- `createHTTPHandler` gains an optional `runtime?: Partial<Runtime>` (`@sozai/runtime`), resolved
  once via `createRuntime`, used to mint each listen POST's `connectionID` via `getRandomID()`.
- **Breaking:** `createHTTPHandler` gains `subscriptionBinding?`; the `createServer` factory takes
  `{ transport, subscriptionBinding }`; `HTTPHandler.dispose` becomes async (flush terminal SSE
  results, bounded deadline).

### 6. `@mokei/http-client`

- `HTTPTransport` implements the optional `StreamLifecycleTransport` capability: emit
  `streamEvents.closed { requestID }` when a POST SSE body ends **without** a terminal JSON-RPC
  response for that id. Do **not** emit when the fetch was aborted by `notifications/cancelled`, when
  the whole transport is disposing, or when a terminal response was observed. This is the per-exchange
  signal that lets the RPC layer settle just the listen exchange and lets the client reconnect.

### 7. `@mokei/host` — integration (mechanism, not policy)

- The host subscribes to each `2026-07-28` context's client listen stream.
- On listChanged: re-discover the affected list, update the namespaced aggregate, then emit a new
  `HostEvents` member — `tools:changed` / `prompts:changed` / `resources:changed`, each `{ key }`.
  Session/AgentSession read the aggregate per turn → turn-boundary semantics, no mid-turn swap logic.
- On resourceUpdated: forward `resource:updated { key, uri }` (no auto re-read).
- `Session` / `AgentSession` unchanged; consumers opt in via `host.events.on(...)`.

### 8. Interop + tests

- Unit per layer: schema (incl. `_meta` placement + `resultType: 'complete'`); the correlator
  extraction + `RequestID` validation; `ExchangeRegistry.close`; held-response + scheduler-slot
  release + disposal ordering; `SubscriptionWriter` overflow; registry fan-out + filter honoring;
  ack-first ordering; generation gating; capability gating; per-exchange stream-close + reconnect.
- Interop against SDK v2 (`integration-tests`), both directions, over stdio and HTTP:
  - **mokei client ↔ SDK server:** open listen, receive `acknowledged` + listChanged +
    resourceUpdated; assert filter honoring and terminal-result-on-teardown.
  - **SDK client ↔ mokei server:** SDK opens listen against mokei; mokei acks, producers fan out;
    assert the SDK receives them — including two concurrent SDK clients reusing request id `0` to
    exercise the `connectionID` keying, over stateless HTTP.

## Out of scope

- `2025-11-25` `resources/subscribe`/`unsubscribe` dispatch (deferred; separate item).
- Any built-in `AgentSession`/`Session` reaction to changes — deliberately consumer-driven.
- Dynamic tool/prompt/resource **list mutation** APIs beyond emitting listChanged.
- Cross-process / multi-instance subscription delivery (single in-process binding only).
- Notification **coalescing** (repeated list-changed or same-URI updates) — a later, separately
  tested overflow policy; the smallest version disconnects on overflow.

## Breaking API changes

- `ContextRPC.dispose()` / `ContextServer.dispose()` / `HTTPHandler.dispose()` become **async**.
- The HTTP server factory changes from `createServer(transport)` to
  `createServer({ transport, subscriptionBinding })`; `createHTTPHandler` gains `subscriptionBinding?`.
- `StreamHandlers.onSettle` receives `{ reason, error }` instead of a bare reason (internal to
  `context-rpc`, but noted).

These land in the same fixed release group; the migration already plans a version bump for the
`2026-07-28` work.

## Error handling & teardown

- Per-exchange abrupt POST-SSE close → `streamEvents.closed` → `ExchangeRegistry.close(id, 'closed')`
  → client reconnect. Whole transport close → `endAll('closed')` settles all, no internal reconnect
  (stdio EOF = host rebuilds).
- Client disconnect (server side) → registry drops `{connectionID, subscriptionID}`, closes sink.
- Graceful server shutdown → `_beforeTransportClose` → per-stream drain + terminal result, bounded
  deadline, then close.
- Abort of a listen exchange (client) → `'cancel'`, sends `notifications/cancelled`.
- Server backpressure → per-subscription serialized bounded writer; overflow disconnects with
  `SubscriptionBackpressureError`. The client `NOTIFICATION_BUFFER_CAP` is a **separate** final-consumer
  policy, not server backpressure.
- Malformed subscription metadata → `onError` (not silent passthrough); valid-but-unknown
  subscriptionId frames → dropped (late frame for a retired generation).

## Testing strategy

TDD per layer, bottom-up: protocol schema → RPC held-response + correlator + `ExchangeRegistry.close`
→ client `SubscriptionDriver` → server registry/binding/writer → HTTP server binding + http-client
stream-close signal → host events → interop. Each layer's unit tests land with it. Interop suites
gate the whole feature against the SDK v2 reference peer, including the two-clients-same-id case.

## Open items for the plan

- Exact `SubscriptionRegistry`/binding teardown ordering vs the HTTP sink lifecycle under the flush
  deadline.
- Whether the auto-open filter should include listChanged types the host will not act on (favor
  opting into only what a consumer is wired for).
- Re-validate all payload shapes and the `resultType: 'complete'` terminal rule against the final
  `2026-07-28` spec text, not only SDK v2.
- Confirm the scheduler `#detached` accounting interacts correctly with the existing bounded
  concurrent-dispatch defect-wave changes.
