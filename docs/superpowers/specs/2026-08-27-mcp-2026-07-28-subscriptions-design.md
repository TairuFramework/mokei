# Design: MCP `2026-07-28` resource subscriptions (`subscriptions/listen`, B4)

**Date:** 2026-08-27
**Branch:** `feat/mcp-2026-07-28-subscriptions`
**Source item:** `docs/agents/plans/next/2026-08-27-mcp-2026-07-28-subscriptions.md`
**Milestone:** `docs/agents/plans/milestones/2026-06-08-mcp-2026-07-28-migration.md` (piece E / B4, SEP-2575)

## Summary

Implement `subscriptions/listen` on the `2026-07-28` revision — the last capability gap in the
MCP spec migration. `subscriptions/listen` is a single long-lived client→server request whose
response stream stays open, carrying every out-of-band server→client notification the client
opted into: `toolsListChanged`, `promptsListChanged`, `resourcesListChanged`, and per-URI
`resourceSubscriptions`. It replaces the GET/SSE endpoint plus `resources/subscribe` that
`2025-11-25` used.

This design covers `2026-07-28` only. The `2025-11-25` `resources/subscribe`/`unsubscribe`
dispatch gap is deliberately deferred (see the source item; implement only if a real peer needs
it). The work spans client-receive, server-serve, server producers, host integration, and SDK v2
interop, on both stdio and Streamable HTTP transports.

## Decisions (locked in brainstorming)

1. **Revision scope:** `2026-07-28` only.
2. **Breadth:** full — client-receive, server-serve, and server producers.
3. **Producer API:** the server's existing `@sozai/event` `EventEmitter` (`server.events`). Producers
   emit typed events; an internal `SubscriptionRegistry` subscribes via `events.on(...)` and fans
   out to open listen streams honoring each stream's filter.
4. **Consumer API:** the client auto-opens one listen stream after setup (iff `server/discover`
   advertises the relevant capabilities), routing frames to existing consumers; plus explicit
   `subscribeResource(uri)` / `unsubscribeResource(uri)` that mutate the stream's filter.
5. **Stateless-HTTP lifetime:** persistent-server binding. Subscriptions are stateful; stdio and
   `2025-11-25`-HTTP are persistent so they work naturally. On `2026-07-28` stateless HTTP, listen
   POSTs bind to a durable `ContextServer` the deployment supplies; request/response POSTs stay
   throwaway.
6. **Host integration (mechanism, not policy):** the host reacts to received notifications by
   keeping its own aggregate correct and emitting host events; it defines no agent behavior.
   Consumers drive reactions via `host.events.on(...)`.

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
- **Subscription id** — every streamed notification and the terminal result carry
  `_meta['io.modelcontextprotocol/subscriptionId']`, which **equals the listen request's JSON-RPC
  id**. This is the key insight that lets the client reuse `_registerStreamExchange` unchanged.
- **Terminal `subscriptions/listen` result** — sent only on graceful server teardown (e.g.
  shutdown); an abrupt transport close carries no response, and the client re-sends.

## Architecture

### Core mechanism

Because `subscriptionId == the listen request's JSON-RPC id`, the client models a listen stream as
a `_registerStreamExchange('subscriptions/listen', { notifications }, handlers)` call:

- The exchange stays pending for the stream's lifetime.
- The missing wire-feeder is added in `ContextRPC._handleMessage`'s notification branch: a
  notification carrying `_meta['io.modelcontextprotocol/subscriptionId']` is routed to
  `routeStreamFrame(subscriptionId, { type: 'progress', value: notification })` instead of
  `_handleNotification`. The `acknowledged` notification is simply the first such frame.
- The terminal `subscriptions/listen` result settles the exchange via the existing `routeResponse`
  path (`SettleReason 'result'`); transport close settles it via `endAll` (`'closed'`); an abort
  cancels it (`'cancel'`).

No new correlation primitive is needed — `ContinuationStore` stays unused (it remains the B-item
that never found a consumer), and the `stream` arm of the exchange registry gains its first real
wire feeder.

Server-side is the genuinely new pattern: a handler that does **not** return a result. It registers
the stream + filter in a `SubscriptionRegistry`, emits `acknowledged` immediately, holds the
response stream open, and sends the terminal result only on graceful teardown.

### Transport lifetime

| Transport | Server lifetime | How the listen stream lives |
|-----------|-----------------|-----------------------------|
| stdio | persistent (one server per process) | The server lives; the registry + `events` fan-out are natural. Terminal result on `dispose`. |
| `2025-11-25` HTTP | persistent (session) | Same; the listen stream rides the session as any long-lived response. |
| `2026-07-28` HTTP (stateless) | throwaway per POST | **Listen POSTs bind to a persistent `ContextServer` the deployment supplies** (see below); request/response POSTs stay throwaway. |

**Persistent-server binding (stateless HTTP).** `createHTTPHandler` gains an optional durable
subscription server. A POST whose method is `subscriptions/listen` is routed to that server (not
`runStatelessExchange`); its SSE response is held open (never `finish()`ed on an own-response,
since there is none until teardown) and the transport bridge routes fan-out frames to it. The
deployment emits producer events on that same server instance, so producers have a stable emit
target. If no durable server is configured, a listen POST is answered with `METHOD_NOT_FOUND`
(mokei serves stateless request/response only, which is honest and interop-visible). Pure
request/response POSTs are unchanged.

## Components

### 1. `@mokei/context-protocol` — schema

New `src/subscriptions.ts` (mirrors the `resource.ts` + MRTR precedent):
- `subscriptionFilter` schema + `SubscriptionFilter` type.
- `subscriptionsListenRequest` (`method: 'subscriptions/listen'`, `params.notifications`).
- `subscriptionsAcknowledgedNotification` (`method: 'notifications/subscriptions/acknowledged'`).
- `subscriptionsListenResult` (terminal, `_meta` carries `subscriptionId`).
- The `io.modelcontextprotocol/subscriptionId` `_meta` key constant.
- `resourceUpdatedNotification` already exists in `src/resource.ts`; reuse it.

Wire into `src/versions/2026-07-28.ts`:
- Add `subscriptions/listen` to `clientMethods`.
- Add `subscriptionsAcknowledgedNotification` and the three list_changed notifications' emission
  path to the server side (`serverNotification` already includes `resourceUpdated` +
  `resourceListChanged`; add `subscriptionsAcknowledged`).
- Add `subscriptionsListenResult` to `serverResult`/`serverResponse`.
- `subscriptions/listen` is a long-lived request whose result is terminal-only-on-teardown —
  document it as a distinct request category; it must not be given MRTR retry-params
  (`forbidRetryParams`).

Barrel + `versions/index.ts` re-exports; a `versions.test.ts` guard for the new method/notification
membership.

### 2. `@mokei/context-client` — receive

- `_handleNotification` bridge (above): subscriptionId-tagged notifications → `routeStreamFrame`.
- An internal listen driver: `_registerStreamExchange` with handlers that route each frame:
  - `acknowledged` → record the honored filter.
  - `notifications/{tools,prompts,resources}/list_changed` → existing `_resetDiscovery()` /
    schema-cache clear.
  - `notifications/resources/updated` → deliver to per-URI subscribers and the `#notifications`
    buffer (existing sink; honors the `NOTIFICATION_BUFFER_CAP` drop policy).
- **Auto-open:** after setup, iff `server/discover` advertises `resources.subscribe` / listChanged
  caps, open one listen stream with a filter derived from what the client cares about (all
  advertised listChanged types; `resourceSubscriptions` starts empty).
- **Explicit API:** `subscribeResource(uri)` / `unsubscribeResource(uri)` add/remove a URI from the
  active stream's `resourceSubscriptions`. Since the filter is fixed at listen time, a change
  re-sends `subscriptions/listen` with the updated filter (tear down the old exchange, open a new
  one) — the simplest correct model; optimize later only if needed.
- **Auto-reconnect:** on abrupt stream close (not a terminal result), reconnect with capped
  exponential backoff and resubscribe the current filter — mirrors the existing `#runGETStream`
  reconnect loop and matches the spec's "abrupt close → client re-sends".

### 3. `@mokei/context-server` + `@mokei/http-server` — serve

- **`SubscriptionRegistry`** (internal to `context-server`): maps each open listen exchange →
  `{ filter, write }`. Subscribes to `server.events` via `events.on(...)`; on each producer event,
  fans out to matching streams (filter check per stream). Torn down per-stream on client disconnect,
  and all streams on `dispose` (emit terminal result first, then close).
- **Dispatch:** a `subscriptions/listen` branch in `#dispatchRequest` that does not produce a
  result — registers the stream, emits `acknowledged`, returns a sentinel that tells `_handleRequest`
  to hold the response open. This is a new "no terminal result yet" outcome alongside MRTR's
  `input_required`; keep the two clearly distinct (MRTR returns terminally and re-invokes; listen
  holds one stream open).
- **Capability:** set `resources.subscribe: true` (the schema already supports it) when the server
  is configured to serve subscriptions.
- **`http-server`:** the persistent-server binding described above — route listen POSTs to the
  durable server; hold the SSE response open; bridge fan-out frames onto it. This replaces, for
  `2026-07-28`, the `getStream` role the `2025-11-25` path uses.

### 4. `@mokei/context-server` — producers

- Extend the server's `Events` map with: `resourceUpdated: { uri: string }`, and dataless
  `toolsListChanged` / `promptsListChanged` / `resourcesListChanged`.
- Deployments emit via `server.events.emit('resourceUpdated', { uri })` /
  `server.events.fire('toolsListChanged')`, etc. The `EventsSink` view can be handed to producers
  that must not subscribe.
- The registry translates each event into the corresponding wire notification and fans out honoring
  filters (a `resourceUpdated` only reaches streams whose `resourceSubscriptions` include that URI;
  a listChanged only reaches streams that opted into that type).

### 5. `@mokei/host` — integration (mechanism, not policy)

- The host subscribes to each `2026-07-28` context's client listen stream.
- On listChanged: the host **re-discovers the affected list**, updates its namespaced aggregate,
  then emits a new `HostEvents` member — `tools:changed` / `prompts:changed` /
  `resources:changed`, each `{ key }`. Because Session/AgentSession read the aggregate per turn,
  this yields turn-boundary semantics with no mid-turn swap logic.
- On resourceUpdated: the host **forwards** `resource:updated { key, uri }` (no auto re-read).
- `Session` / `AgentSession` are unchanged; consumers opt in via `host.events.on(...)`.

### 6. Interop + tests

- Unit tests per layer: schema validation; the client bridge routing (subscriptionId → frame);
  registry fan-out honoring filters; the hold-open dispatch; persistent-server binding; reconnect.
- Interop against SDK v2 (`integration-tests`), both directions, over stdio and HTTP:
  - **mokei client ↔ SDK server:** open listen, receive `acknowledged` + listChanged +
    resourceUpdated; assert filter honoring and terminal-result-on-teardown.
  - **SDK client ↔ mokei server:** SDK opens listen against mokei; mokei acks, producers fan out;
    assert the SDK receives them. Exercises the persistent-server binding on stateless HTTP.

## Out of scope

- `2025-11-25` `resources/subscribe`/`unsubscribe` dispatch (deferred; separate item).
- Any built-in `AgentSession`/`Session` reaction to changes — deliberately consumer-driven.
- Dynamic tool/prompt/resource **list mutation** APIs beyond emitting listChanged; producers emit
  events, they do not restructure the server's definition model.

## Error handling & teardown

- Transport close → `endAll` settles the client listen exchange (`'closed'`); server registry
  clears all streams.
- Client disconnect (server side) → registry drops that stream.
- Graceful server shutdown → emit terminal `subscriptions/listen` result per stream, then close.
- Abort of a listen exchange (client side) → `'cancel'`, sends `notifications/cancelled`.
- Backpressure → the existing notification-buffer drop policy (`NOTIFICATION_BUFFER_CAP = 256`).
- Unknown / unmatched subscriptionId frames → dropped without settling (existing
  `routeStreamFrame` behavior).

## Testing strategy

TDD per layer, bottom-up: protocol schema → client bridge → server registry/dispatch → HTTP
binding → host events → interop. Each layer's unit tests land with it. Interop suites gate the
whole feature against the SDK v2 reference peer.

## Open items for the plan

- Exact `SubscriptionRegistry` teardown ordering vs the HTTP bridge's stream lifecycle (stateless
  binding) — nail down in the plan.
- Whether the client's auto-open filter should include listChanged types the host will not act on
  (favor opting into only what a consumer is wired for, to respect the server's "MUST NOT send
  un-requested types" and avoid dead traffic).
- Re-validate all payload shapes against the final `2026-07-28` spec text (not only SDK v2).
