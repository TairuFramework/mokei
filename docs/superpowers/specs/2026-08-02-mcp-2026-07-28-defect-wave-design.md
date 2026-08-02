# MCP `2026-07-28` defect wave — design

**Date:** 2026-08-02
**Branch:** `fix/mcp-2026-07-28-defect-wave`
**Origin:** `docs/agents/plans/backlog/2026-06-20-mcp-draft-remaining.md`, sections 3.1.1–3.1.5,
3.5.1 and 3.5.5 — findings filed against `feat/mcp-2026-07-28-core` and verified again against
`main` before this design was written.

## Goal

Close seven verified correctness defects in the MCP core. Six were filed as follow-ons to the
`2026-07-28` work; the seventh (3.1.1) predates it and was merely measured by it. Four packages,
one branch, sequenced so each step lands with a green suite.

Two of the seven change behavior a peer can observe, rather than only fixing an internal fault:

- a mokei server answers requests concurrently where it used to serialize them (3.1.1)
- a result that used to validate may now be rejected (3.1.2)

Both are the point of their item, and both set the test burden.

## Scope

| Item  | Package           | Defect |
|-------|-------------------|--------|
| 3.1.1 | `context-rpc`     | The read loop awaits every handler, so a server handles one request at a time |
| 3.1.5 | `context-rpc`     | `dispose()` / EOF never abort in-flight handler signals |
| 3.1.4 | `context-rpc`     | An inbound frame that fails validation is dropped, stranding its caller forever |
| 3.5.5 | `context-client`  | No default request timeout — nothing backstops a response that never arrives |
| 3.1.2 | `context-protocol`| Inbound result validation is vacuous; `resultType` is unenforced |
| 3.1.3 | `context-client`  | An unsupported `protocolVersion` string silently degrades to auto-detection |
| 3.5.1 | `http-client`     | An aborted request never reaches the server on the stateless path |

Out of scope: MRTR (B7), `subscriptions/listen` (B4), the remaining 3.5.6 transport minors and
3.5.7 doc minors, and the `SetupReader` extraction filed in 3.4.

## Sequence

1. `context-rpc` read loop — concurrency and the scheduler (3.1.1). Anchor: everything else in
   the package sits on the new dispatch shape.
2. `context-rpc` lifecycle — abort on close (3.1.5), reject on a dropped response (3.1.4),
   `onError` hook.
3. `context-client` — `requestTimeout` (3.5.5).
4. `context-protocol` — result unions and `resultType` (3.1.2).
5. `context-client` — version-pin validation (3.1.3).
6. `http-client` — per-request-id cancellation (3.5.1).

Steps 3, 5 and 6 are independent of the others. Step 6 works on the stateless path without step
1; on the session path it needs step 1, because a cancellation is not read until the handler it
names has settled.

## 1. The read loop (3.1.1)

### Current behavior

`ContextRPC.#readLoop` (`packages/context-rpc/src/rpc.ts:123`) does
`response = await this._handleMessage(next.value)` inside `while (true)`. The next message is not
read until the current handler resolves, so **every mokei server handles exactly one request at a
time, on every transport and every revision**. Two measured consequences: no concurrent tool
calls (a `quick` tool issued 100 ms behind a 5 s `slow` tool answered at 5003 ms), and
`notifications/cancelled` cannot reach an in-flight request, because it is not read until the
handler it names has already settled and `.finally` has deleted its controller.

### Dispatch

`_handleMessage` keeps its signature and its role as the sole classifier. The loop stops awaiting
it:

```ts
const result = this._handleMessage(next.value)
if (result == null) continue                                   // notification, response, drop
if (result instanceof Promise) void this.#settleRequest(result) // request handler
else await this._write(result)                                  // sync INVALID_REQUEST response
```

Notifications and responses already return `null` synchronously, so they keep their exact wire
ordering. Only the request branch becomes concurrent. `#settleRequest` writes the response when
the handler resolves.

Concurrent `_write` calls are safe without added serialization: `@enkaku/transport`'s `write`
goes through a single `WritableStreamDefaultWriter`, which queues chunks and runs the sink one at
a time, so frames cannot interleave.

### `RequestScheduler`

A new `scheduler.ts` unit in `context-rpc`, with its own tests, owning what `#receivedRequests`
owns today:

- `schedule(id, controller, run)` — under the concurrency cap, run now; otherwise queue; past the
  queue bound, return a busy error response without ever calling `run`.
- `cancel(id)` — queued: drop it, resolve `null`, never run it. Running: abort the controller, as
  today. Neither answers on the wire, matching MCP's "a cancelled request SHOULD NOT be responded
  to" and the current aborted-handler behavior.
- `abortAll(reason)` — abort running, drop queued. Section 2 wires this into
  `#endPendingRequests`.
- Each settle pulls the next queued entry.

The controller is registered at **enqueue** time, not at run time, so a cancel that lands while a
request is still queued finds it.

### Configuration

- `RPCParams.maxConcurrentRequests`, default **100** — the same order as
  `DEFAULT_MAX_STATELESS_EXCHANGES`.
- `RPCParams.maxQueuedRequests`, default **1000**.

Both are symmetric: `ContextClient` handles server-initiated requests on `2025-11-25` and gets the
same bound. Surfaced through `ContextServer` and `ContextClient` params.

A request past the queue bound is answered with `INTERNAL_ERROR` (-32603) and a "server busy"
message. A dedicated code in the server-error range would read better to a client deciding
whether to retry, but mokei's existing custom codes (-32020..-32022) all come from SEPs, so
inventing -32023 risks colliding with a future one.

### Contract

Documented on `ContextRPC`:

- notifications and responses are handled in wire order;
- requests **start** in wire order and complete out of order;
- a request never delays a notification.

## 2. Lifecycle (3.1.5, 3.1.4)

### Abort on close (3.1.5)

Handler controllers live in `#receivedRequests` and are aborted only from the
`notifications/cancelled` branch. `#endPendingRequests` touches only `#exchanges.endAll` and
`#continuations.clearAll`, so disposing a server leaves every running handler running with
nothing to observe that the connection is gone.

`#endPendingRequests(reason)` gains `this.#scheduler.abortAll(reason)`. `#dispose()` and
read-loop termination both already funnel through `#close()`, so one line covers explicit dispose
and peer EOF alike. No new close-reason distinction. An aborted handler that later resolves finds
its entry gone and writes nothing — the existing aborted-request behavior.

Note the interaction with section 1: while the read loop serialized, at most one handler was ever
in flight. Fixing the loop widens the blast radius, which is why these two ship together.

### Dropped inbound response (3.1.4)

`_handleMessage`'s validation-failure branch currently splits two ways: a request gets
`INVALID_REQUEST`, everything else returns `null` at a `TODO: call optional error handler`. So a
malformed response frame delivered over a normal 200 leaves its caller's promise pending forever.

It gains a third branch: a frame carrying a request id and no method is a *response*, so it is
routed to its exchange as a failure — `#exchanges.cancel(id, new RPCError(INTERNAL_ERROR,
'Invalid response'))` when the exchange exists. The caller gets a rejection instead of a promise
that never settles. This is the fix; the timeout in section 3 is only a backstop.

### Error handler

Both `TODO: call optional error handler` sites (`rpc.ts:177`, `rpc.ts:224`) get a
`RPCParams.onError?: (error: Error) => void`, called for a frame that could neither be validated
nor routed anywhere — an invalid notification, or a response for an id nobody is waiting on.
Without it those frames vanish silently, which is what made 3.1.4 hard to see.

## 3. Default request timeout (3.5.5)

`ContextRPC.request` arms a timer only when the caller passes `options.timeout`, and no layer
above supplies a default. `DEFAULT_INITIALIZE_TIMEOUT` covers `#setup` only.

`RPCParams.defaultRequestTimeout` is consumed in `request()` as
`options?.timeout ?? this.#defaultRequestTimeout`, leaving the existing timer path unchanged.
`ClientParams.requestTimeout` passes through to it.

**Unset means off.** No request gains a bound it did not have. A blanket default would kill a
long `tools/call` — `@mokei/session` already bounds those at 120 s and callers pass their own
timeouts — and the real fix for a hang is section 2's drop-path rejection, not a timer.
`#setupTimeout` keeps covering setup independently.

## 4. Result validation (3.1.2)

### What cannot change

`result` (`packages/context-protocol/src/rpc.ts:214`) is the `allOf` base of every concrete
result schema — `callToolResult`, `readResourceResult`, `discoverResult` and the rest. It must
stay open. The defect is not the schema: it is that the bare base is a **member** of
`serverResult`'s `anyOf` (`packages/context-protocol/src/server.ts:48`). `anyOf` passes if any
branch matches, so a union containing an open object with no `required` admits any object at all
and the remaining branches never get a say. This makes inbound result validation vacuous on
**both** revisions, not only `2026-07-28` — wider than the item as filed.

### Fix

A separate `emptyResult` branch replaces the bare base:

```ts
{ properties: { _meta: metadata }, additionalProperties: false, type: 'object' }
```

`{}` and `{_meta}` results — `ping`, `logging/setLevel`, `subscribe` — still validate; an
arbitrary object no longer does. The same edit applies to `clientResult`
(`packages/context-protocol/src/client.ts:15`), which has the identical bare-`result` first
branch for server→client results.

### Per-revision split

`2026-07-28`'s `serverMessage` (`versions/2026-07-28.ts:162`) reuses the shared `serverResponse`
and so inherits the shared union. It gets its own `serverResult` / `serverResponse`:

- `withResultType(schema)` is reintroduced as
  `allOf[schema, { properties: { resultType: { enum: ['complete', 'input_required'] } }, required: ['resultType'] }]`
  and applied to each concrete branch. Both values are live: `discoverResult` pins `'complete'`,
  and `client.ts:585` reads `'input_required'`.
- Its empty branch is purpose-built rather than `withResultType(emptyResult)`:
  `additionalProperties: false` in one `allOf` branch would reject the `resultType` the other
  branch adds. So `{ properties: { _meta, resultType }, required: ['resultType'],
  additionalProperties: false }`.
- `discoverResult` joins the union, which deletes `return message.result as DiscoverResult` at
  `packages/context-client/src/client.ts:855`.

`2025-11-25` keeps the shared union, with the empty-branch fix applied.

## 5. Version pin (3.1.3)

`packages/context-client/src/client.ts:411` reads
`PROTOCOLS[params.protocolVersion]` without validating the string. `PROTOCOLS[unknown]` is
`undefined`, which is nullish, so the guard below it is skipped and `#setup()` treats an invalid
pin exactly like `'auto'`. A config file or an API consumer passing a bad version string silently
gets probing instead of a failure.

The constructor validates with `isSupportedProtocolVersion` before indexing, and throws the
`UnsupportedProtocolVersionError` that already exists at `client.ts:153`.

## 6. HTTP cancellation (3.5.1)

The server implemented its half: `runStatelessExchange` wires the incoming `request.signal` to
`finish()` and tears the throwaway `ContextServer` down when the caller hangs up. The client never
hangs up — `HTTPTransport`'s `AbortController` is armed only for time-to-headers and is discarded
before `#handleSSEResponse` reads the body, deliberately, so a long streamed tool call is not cut
off. So an aborted `callTool` rejects locally while the server runs the tool to completion.

`#sendMessage` already tracks per-id state (`#pendingMethods`), so it gains
`#exchangeControllers: Map<RequestID, AbortController>`. The existing controller stops being
discarded at headers: the timeout timer is still cleared there (time-to-headers semantics
unchanged), but the controller stays registered for the life of the exchange, so aborting it
tears down the SSE body the server is writing into.

`write()` intercepts an outgoing `notifications/cancelled`, reads `params.requestId`, and aborts
that entry **only** when the in-flight request's revision has `requiresHandshake === false`, read
from `PROTOCOLS[version]` and never from a version literal. On the session path
`notifications/cancelled` remains the channel: a session server cannot read a dropped POST as a
cancellation, and dropping it would kill the stream carrying the response.

The entry is marked cancelled before aborting, so the `catch` in `#sendMessage` skips
`#failRequest` — `request()` already rejected the exchange locally, and a second error frame for a
settled id is noise.

## Testing

**`context-rpc` unit.** `RequestScheduler` in isolation: cap honoured; queue drains in order;
past the bound answers `INTERNAL_ERROR` without running the handler; a cancel of a *queued*
request never runs it and writes nothing; `abortAll` reaches running and queued entries.
`ContextRPC`: a quick request behind a slow one answers first; a notification is processed while a
request is in flight; `notifications/cancelled` aborts a running handler's signal; an invalid
response frame rejects its caller; `onError` fires for an unroutable frame; dispose and peer EOF
each abort handler signals.

**`context-protocol`.** An arbitrary object no longer validates as a server result; `{}` and
`{_meta}` still do; a `2026-07-28` result without `resultType` is rejected; `discoverResult`
validates through the union rather than through a cast. Same coverage for `clientResult`.

**`context-client`.** An unsupported version string throws instead of probing.

**`http-client`.** A cancel aborts the fetch on a stateless revision and does not on a session
one.

**Integration.** The two suites that currently document serialization in prose —
`integration-tests/suites/interop-2026-07-28-stdio.test.ts` (the cancellation test's header) and
`integration-tests/support/interop/mokei-stdio-server-cancellation.ts` — are rewritten to assert
that cancellation actually lands. The filed 5 s-sleep/quick-tool measurement becomes a real
concurrency test. The SDK v2 interop suites must stay green: the result-union tightening is the
one change that could break against a live peer, which is why those suites gate this wave.

**Baseline to beat:** 834 package tests, 0 failures; integration 37 passed / 22 backend-gated
skips / 0 failures.

## Follow-ups this design does not take

- 3.5.6 transport minors, 3.5.7 doc minors, 3.5.8 `SSEWriter` logging.
- The full per-revision `ServerRequest` / `ServerNotification` type split (3.4) — this wave splits
  only the result side, which 3.1.2 forces.
- Validating a response against the *sent method's* own result schema, which would remove the
  union question entirely. Rejected here as a design change rather than a fix: the exchange
  registry in `context-rpc` is deliberately method-unaware.
