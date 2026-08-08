# MRTR — multi round-trip requests on `2026-07-28`

**Piece:** D of `backlog/2026-06-20-mcp-draft-remaining.md`
**Origin:** `next/2026-08-04-mcp-mrtr.md`
**Milestone:** `milestones/2026-06-08-mcp-draft-migration.md` (B7, SEP-2322)
**Branch:** `feat/mcp-mrtr`

## Why this spec corrects the milestone

The milestone's Architecture-decision section and the backlog's piece-D entry both describe MRTR
as interleaved frames inside a single exchange: `tools/call` becoming
`1-request → (progress* · inputRequest* · result)`, correlated by a continuation token, wired
into the `_registerStreamExchange` seam in `@mokei/context-rpc`. That reading predates the final
specification and is wrong.

The finalized shape, verified against `@modelcontextprotocol/core` 2.0.0's `wire/rev2026-07-28`
codec and registry, is a **request-level retry loop** built from ordinary request/response pairs:

1. The client sends an ordinary `tools/call`, `prompts/get` or `resources/read`.
2. The server answers with a terminal result carrying `resultType: 'input_required'`, plus
   `inputRequests` (a map of server-assigned key → an embedded `sampling/createMessage`,
   `elicitation/create` or `roots/list` request object, de-JSON-RPC'd) and/or `requestState` (an
   opaque, server-minted string). At least one of the two must be present.
3. The client fulfils each embedded request locally and sends a **fresh JSON-RPC request** — same
   method, same params — with `params.inputResponses` (the same keys, each holding the bare result
   object) and `params.requestState` echoed back verbatim.
4. Repeat until a result carries `resultType: 'complete'`.

Three consequences follow, and they define this piece:

- **No streaming, no continuation store.** Every round is a plain `ContextRPC.request()`.
  Correlation is `requestState`, which lives on the server, not in the client's RPC layer.
  `_registerStreamExchange`, `StreamHandlers`, `StreamFrame` and `ContinuationStore` get no wire
  trigger from this work. They are left in place — piece E (`subscriptions/listen`) is the
  remaining candidate consumer and is the only piece able to judge whether it wants frames — and
  the documents that point at them are corrected instead.
- **The server's handler surface cannot stay stable across revisions.** On `2025-11-25` a handler
  writes `await client.createMessage(...)` and blocks. Under MRTR the handler must *return* and be
  *re-invoked* on the retry. This spec adopts the explicit return, matching the SDK: the handler
  returns an `input_required` result and reads `inputResponses` on the next round. Replaying the
  handler body to preserve the blocking call was rejected — every side effect before a suspend
  point would re-run each round, and non-determinism would silently corrupt correlation. Parking
  the suspended handler in memory was rejected for reintroducing exactly the cross-request server
  state this revision was designed to remove.
- **The client's handler surface does stay stable.** An auto-fulfilment driver dispatches embedded
  requests to the already-configured `createMessage` / `elicit` / `listRoots` handlers, so
  `ContextClient` consumers keep one handler across both revisions and callers of `callTool`,
  `getPrompt` and `readResource` receive the same result type they do today.

One question the milestone left open is answered rather than implemented: `2026-07-28` has no
`notifications/roots/list_changed`. The SDK's era registry omits it, and mokei's `clientNotification`
union already excludes it for the right reason. The "roots list-changed half of B6" is therefore
**no work**, not deferred work.

## Scope

In: the client driver, the server return path, the schema tightening, removal of the setup-time
refusals, all three MRTR methods, `requestState`-only load-shedding legs, the `-32021` emitter, and
interop coverage in both directions.

Out: `subscriptions/listen` (piece E), D1–D3 deprecation handling (piece F), any change to
`2025-11-25` behavior, and any deletion or rewiring of the `context-rpc` streaming arm.

## 1. Protocol package — `@mokei/context-protocol`

### `versions/2026-07-28.ts`

`withResultType` tightens to `resultType: { const: 'complete' }`, and `emptyResult`'s inline
`resultType` does the same. Today both admit `'input_required'` on every terminal branch, so a
`callToolResult`-shaped frame labelled `input_required` validates — the union's discriminator does
no discriminating.

`inputRequiredResult` gains the two constraints it deferred:

- `inputRequests` values stop being open (`additionalProperties: {}`) and become
  `anyOf: [createMessageRequest, elicitRequest, listRootsRequest]`. The map itself stays open on
  its keys, which are server-assigned identifiers unique within the request.
- The at-least-one rule is expressed as
  `anyOf: [{ required: ['inputRequests'] }, { required: ['requestState'] }]`.

A new `withRetryParams(schema)` composes the retry fields onto exactly the three MRTR request
schemas — `callToolRequest`, `getPromptRequest`, `readResourceRequest` — as optional
`params.inputResponses` (an object whose values are `anyOf` of the three bare result shapes) and
`params.requestState` (a string). Both are absent on round one. The composition sits alongside
`withProtocolMeta` in `clientRequest`, applied only to those three members: the spec reserves these
names on client-initiated requests, and only for methods that can suspend.

`wrapResult` gains one branch. It currently stamps `resultType: 'complete'` unconditionally, which
would overwrite a handler's suspension. A body already carrying `resultType: 'input_required'`
passes through with its own discriminator, still receiving the `serverInfo` `_meta` stamp.

### `versions/types.ts`

`ProtocolDefinition` gains `inputRequestMethods: Set<string>` — the methods this revision can carry
as embedded input requests. Empty on `2025-11-25`, where the same three methods are real entries in
`serverMethods`; the three on `2026-07-28`, whose `serverMethods` stays empty because a server on
that revision sends no requests at all.

A shared, revision-independent map from input-request method to the client capability it requires
lives beside it: `sampling/createMessage` → `sampling`, `elicitation/create` → `elicitation`,
`roots/list` → `roots`. Both the client's handler gate and the server's `-32021` check read it, so
the two cannot drift.

## 2. Client — `@mokei/context-client`

### The driver

A new `src/mrtr.ts` holds the loop, kept out of `client.ts` — that file is already ~1170 lines and
§3.4 of the backlog records an intent to shrink it, not grow it.

```
round = 1 .. maxRounds
  entries = inputRequests ?? {}
  if entries is non-empty:
    validate each embedded request against its method's schema
    dispatch all entries in parallel under an AbortController linked to the
      caller's signal; the first failure aborts its siblings
    responses = { key: result }
  else:
    sleep 250ms                       // requestState-only load-shedding leg
  send the same method with the original params plus
    { inputResponses: responses, requestState }
  complete       -> return it
  input_required -> carry its payload into the next round
exhausted -> InputRequiredRoundsExceededError
```

Both leg kinds count against the round cap. Embedded requests are validated *before* a user handler
sees them, so a malformed frame fails the flow rather than reaching consumer code as untyped data.
The `requestState`-only leg is a legal server behavior meaning "retry me, I am not finished"; without
the pacing delay nothing throttles that loop, since no handler work happens in the round.

Each retry goes through `ContextClient.request()` unchanged, so every round is decorated with a
fresh `_meta` envelope — required, since each round is a genuinely separate request on a revision
with no session.

Dispatch routes by embedded method to the handlers a client is already constructed with:
`sampling/createMessage` → `createMessage`, `elicitation/create` → `elicit`, `roots/list` →
`listRoots`. No handler configured for an embedded method fails the flow with
`InputRequiredNotSupportedError` naming the key and method.

### Options and errors

`ContextClientParams` gains `inputRequired?: { autoFulfill?: boolean; maxRounds?: number }`,
defaulting to `true` and `10`. `RequestOptions` gains `allowInputRequired?: boolean`, which returns
the raw suspended result to the caller instead of driving rounds.

`request()`'s current unconditional throw becomes a three-way branch: opted in with
`allowInputRequired` → return the result as-is; auto-fulfil on → run the driver; otherwise → throw
`InputRequiredNotSupportedError`. That error keeps its name and gains a second use, so the two
reasons a suspension is refused are one type.

`InputRequiredRoundsExceededError` is new, carrying the method, the cap and the last payload.

`#refuseUnsupportedHandlers` gates on `serverMethods.has(m) || inputRequestMethods.has(m)`. Today it
throws `MRTRNotSupportedError` at setup for any of the three handlers on `2026-07-28`; after this
change all three are fulfilable there and the refusal stops firing. The error class stays — it is
the right answer for a revision that carries a handler's method neither way.

### Timeouts

`timeout` keeps its current meaning and applies per leg. `RequestOptions` gains
`maxTotalTimeout?: number`, which bounds the whole flow by shrinking the budget handed to each leg. Without it a ten-round flow costs ten times the
timeout the caller asked for — the same defect §3.4 records against the header-refresh retry, and
worth not repeating on a loop an order of magnitude longer.

## 3. Server — `@mokei/context-server`

### Handler surface

`HandlerRequest<C>` gains three members alongside `client`, `progress` and `signal`:

- `inputResponses?: Record<string, InputResponse>` — this round's fulfilled results, keyed as the
  handler keyed its `inputRequests`.
- `requestState?: unknown` — the decoded payload when a `verify` hook is configured, the raw string
  otherwise.
- `mintRequestState: (payload: unknown) => string` — the `mint` hook, or `JSON.stringify` when none
  is configured.

The tool, prompt and read-resource handler return types widen with `| InputRequiredResult`. The
other handlers do not: the specification allows suspension on exactly three methods.

An `inputRequired({ inputRequests, requestState })` builder is exported, enforcing the at-least-one
rule at construction so a handler cannot mint a frame the wire schema will reject.

### Seam behavior

On `2026-07-28` requests only, `_handleRequest` lifts `inputResponses` and `requestState` off
`request.params` before dispatch, so a handler sees exactly the shape it sees on `2025-11-25`. When
a `verify` hook is configured it runs at that point; a refusal answers `-32602` and the handler is
never entered.

On the way out, an `input_required` result:

- skips `applyCacheHints` — a suspended result is not an answer and must not be cached;
- has each embedded request validated against its method's schema;
- has each embedded method's required client capability checked (see §4);
- passes through `wrapResult` with its own `resultType`;
- is refused as an internal error when the method is not one of the three, or when the revision is
  `2025-11-25`. Both are handler bugs with no wire representation, and answering them as a
  malformed result would blame the peer.

`client.createMessage` / `elicit` / `listRoots` keep rejecting with `MRTRNotSupportedError` on this
revision — the explicit-return decision means they are genuinely unavailable, not merely
unimplemented. The message is rewritten to point at the return-based API instead of saying mokei has
not implemented MRTR.

### `requestState` integrity

`ContextServer` gains `requestState?: { mint?: (payload: unknown) => string; verify?: (raw: string)
=> unknown }`.

`requestState` round-trips through the client and re-enters the server as attacker-controlled input.
The specification requires a server that lets it influence authorization, resource access or
business logic to protect its integrity and to reject state that fails verification. mokei ships no
crypto and imposes no key management: unset, the raw string reaches the handler and the handler-facing
type documents it as untrusted; set, the seam rejects refused state before dispatch and the handler
reads the hook's decoded payload. The secure path is one option, not a rewrite.

## 4. `-32021 MISSING_REQUIRED_CLIENT_CAPABILITY`

Before an `input_required` result leaves the server, each embedded method's required capability is
checked against the request's `_meta` `clientCapabilities` using the map from §1. A missing capability
answers `-32021` with `data.requiredCapabilities` and a message naming the offending key and method.

This is the constant's first reachable emitter. §3.3.1 of the backlog records it as having none —
`serverMethods` is empty on this revision, so no handler could need an undeclared client capability —
and §3.2.4 records the `MissingRequiredClientCapability` ladders as unexercised for the same reason.
Both close here.

## 5. Testing

Unit coverage, per package:

- `context-protocol`: `withResultType` rejects `input_required` on every terminal branch; a
  suspended result with neither `inputRequests` nor `requestState` is rejected; an embedded request
  of an unknown method is rejected; retry params validate on the three MRTR methods and only there.
- `context-client`: a two-round flow completes; the cap raises `InputRequiredRoundsExceededError`;
  a `requestState`-only leg paces and counts; sibling dispatches abort when one fails; a missing
  handler raises `InputRequiredNotSupportedError`; `allowInputRequired` returns the raw result;
  `autoFulfill: false` refuses; configuring `createMessage` on `2026-07-28` no longer throws at
  setup.
- `context-server`: retry fields are lifted before dispatch; `verify` refusal answers `-32602` and
  skips the handler; a missing capability answers `-32021`; cache hints are skipped on a suspended
  result; `wrapResult` preserves `input_required`; suspension from a non-MRTR method or on
  `2025-11-25` is an internal error.

Interop, following the piece-A matrix over stdio and HTTP:

- mokei client ↔ SDK 2.0.0 server, where an SDK tool suspends and mokei's driver fulfils it;
- SDK client ↔ mokei server, where a mokei tool returns `inputRequired` and the SDK's own driver
  fulfils it.

Both directions matter for the reason §3.2.1 gives: mokei-against-mokei coverage cannot catch an
encoding disagreement, because both ends share the bug.

## 6. Documentation

- `milestones/2026-06-08-mcp-draft-migration.md`: rewrite the MRTR paragraphs of the Architecture
  decision — the streaming/continuation-token model, the `_registerStreamExchange` claim, and the
  "public handler surface stays stable across versions" promise, which holds for clients and not
  for servers. Mark B7 done and record that the roots half of B6 is answered as no work. Resolve
  the "MRTR continuation state across reconnects" open question: there is no continuation state, so
  a reconnect costs the in-flight round and nothing more.
- `backlog/2026-06-20-mcp-draft-remaining.md`: mark piece D shipped; correct the seam claim in §2;
  close the `-32021` half of §3.3.1 and the capability-ladder line in §3.2.4.
- `docs/agents/architecture.md`: update wherever it describes revision capability parity.

## Open question deliberately not answered

Server-minted handles — the milestone's other open question, about passing handles as tool arguments
across `ContextHost` — is unrelated to MRTR beyond sharing the word "handle". `requestState` is
scoped to one request's retry chain and never reaches a tool argument. The question stays open for
whichever piece needs cross-call server state.
