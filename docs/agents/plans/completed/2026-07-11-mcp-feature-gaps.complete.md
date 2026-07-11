# MCP 2025-11-25 feature gaps

**Status:** complete
**Date:** 2026-07-11
**Branch:** `feat/mcp-feature-gaps` (commits `d82dc9c`..`fef1fa2`, PR #36)
**Origin:** the 2026-07-02 MCP feature-gaps backlog item (retired by this work)

## What shipped

Four gaps against the `2025-11-25` revision, plus one refactor the first two forced.

- **Client pagination walk** — `ContextClient`'s four list methods (`listTools`,
  `listPrompts`, `listResources`, `listResourceTemplates`) issued a single request and
  dropped `nextCursor`. Against a paginating server, `ContextHost.setup()` therefore
  built its tool set from page one and silently discarded the rest. A private
  `#listPaged` helper now walks until the server stops returning a cursor, and the four
  methods are thin wrappers naming their result key. This was the interop bug the cycle
  existed to fix.
- **Tool `outputSchema` + `structuredContent`** — `createTool` accepts an optional
  `outputSchema`. The server advertises it in `tools/list` (no server change needed —
  the constructor already spreads the definition), validates the handler's
  `structuredContent` against it, and fills `content` with the serialized JSON when the
  handler omits it. The client caches schemas from `listTools`, clears the cache on
  `notifications/tools/list_changed`, and validates results it receives, throwing
  `StructuredContentValidationError` on mismatch.
- **`SentRequest` → `AbortSignal`** — `SentRequest<Result> = Promise<Result> & { id;
  cancel }` was the only cancellation idiom in the request path and a poor one: `.id`
  was read nowhere outside `context-rpc` (and was already `undefined` in
  `ContextHost.callLocalTool`, which cast a bare promise), `.cancel()` was an adapter
  over a signal every layer beneath already spoke, and the type did not survive
  `.then()`. Deleted along with `requestValue` (dead). Every request method now returns
  a plain `Promise` and takes `options.signal`.
- **`createTool` / `createPrompt` parameters object** — positional arguments left no
  room for `outputSchema` without a fourth positional or an overload. Both factories
  now take a single object. Pure refactor, landed separately so the `outputSchema` diff
  stayed legible.
- **`UnsubscribeRequest` typo** — was aliased to `subscribeRequest`, so it typed as a
  `resources/subscribe` request. Invisible because nothing referenced it yet.

## Key design decisions

- **Aggregate by default; an explicit `cursor` opts out.** Callers who pass no cursor
  get every page as one result with `nextCursor` stripped. Callers who pass one are
  driving pagination themselves and get exactly that page, cursor intact. This keeps the
  common case correct-by-default while leaving manual paging available.
- **A bounded walk that fails loudly.** `listMaxPages` (default 100, overridable per
  call) caps the walk. Exceeding it throws `ListMaxPagesError` carrying the partial
  results, page count, and next cursor — chosen over silent truncation, which is the
  failure mode being fixed. The cap is checked *after* a page arrives and *only* when
  that page advertises another, so a cap of N against an N-page server succeeds. A
  server echoing an unchanging cursor terminates at the cap instead of spinning.
- **An output-schema violation is a protocol error, not a tool failure.** It raises
  `INTERNAL_ERROR` with its `issues[]`, not an `isError: true` result. `isError` is the
  channel for a tool telling the *model* it failed; a handler breaking its own declared
  contract is a server-author bug and belongs in the error channel. This distinction is
  load-bearing — see the review finding below.
- **The client validates only what it can.** Schemas are known only after `listTools`.
  A tool with no cached schema, or a result with no `structuredContent`, is passed
  through unvalidated rather than rejected.
- **`content` is auto-filled only when the handler omits it.** The spec says a tool
  returning `structuredContent` SHOULD also return the serialized JSON as a text block;
  a handler that supplies its own `content` has said something more useful than
  `JSON.stringify` would, so it is preserved.
- **Type-level narrowing keys off `[unknown] extends [Output]`.** Declaring an
  `outputSchema` makes `structuredContent` mandatory in the handler's return type;
  tools without one are typed exactly as before. The direction matters: the reverse
  (`[Output] extends [unknown]`) is true for *every* type, since `unknown` is the top
  type, and would silently never narrow.

## Review finding worth remembering

The final whole-branch review caught a bug the unit tests structurally could not see.
The server's `INTERNAL_ERROR` output-validation path was **unreachable end-to-end**:
`#callTool`'s SEP-1303 try/catch swallowed `finalizeResult`'s `RPCError` into an
`isError` result and dropped the `issues[]` — exactly the behaviour the design decision
above rules out. It slipped because all seven `outputSchema` unit tests called
`definition.handler` directly, bypassing `#callTool`, and the host end-to-end test only
asserted the happy path.

Fixed in `fef1fa2` with a dedicated `ToolOutputValidationError extends RPCError` that
`#callTool` re-throws, plus two end-to-end tests that go through a real `ContextServer`
over a transport. Handler-thrown errors and input-validation `INVALID_PARAMS` still
become `isError`, with regression guards.

**The lesson:** a unit test that calls the handler directly does not test the dispatch
path that wraps it. Where a design decision is about *which channel* an error crosses,
the test must cross that channel.

## Process note

A commit from another writer (`7f60287`) landed on this branch mid-development. Its
message claims to implement the pagination walk and output-schema validation; it did
neither, leaving dead facades (an unexported error class, an unpopulated schema map, a
`TypedToolHandler` ignoring its `Output` parameter) and two live bugs behind `any`
types. It was kept by decision, audited, and every facade properly replaced by the
commits that follow. If the branch is squash-merged this is moot; if merged as-is, that
commit's message misrepresents the history.

## Status

All four gaps closed. Full workspace green (19 packages): context-protocol 73,
context-rpc 22, context-client 49, context-server 55, host 62, session 59.

**Breaking:** `SentRequest` and `requestValue` removed (every request method returns
`Promise` and takes an optional `signal`); `createTool`/`createPrompt` take a parameters
object; list methods aggregate by default.

**Deferred:** `resources/subscribe` (gap 3 of the retired backlog item) — the protocol
types exist but there are no client methods, server dispatch, or capability declaration.
Folded into **B4** of `backlog/2026-06-20-mcp-draft-remaining.md`, to be done as the
legacy-side branch of that item only if a real peer needs it.

**Pre-existing lint, left as-is (predates this cycle):** `mcp-servers/{sqlite,fetch}`
`noExplicitAny` in product code; `http-client/src/x-mcp-header.ts` `useLiteralKeys`.
