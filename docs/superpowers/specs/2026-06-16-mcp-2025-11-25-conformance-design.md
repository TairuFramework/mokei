# MCP 2025-11-25 conformance — design

**Status:** approved (brainstormed 2026-06-16)
**Branch:** `fix/mcp-spec-conformance`
**Origin backlog:** `docs/agents/plans/backlog/2026-06-12-mcp-2025-11-25-conformance.md`

## Goal

Close the MUST-level and schema-shape non-conformances against the `2025-11-25`
MCP revision that mokei already targets. Single spec, all 12 backlog items, one
branch. Items 3–5 carry forward into the future draft migration unchanged; items
1, 6, 7 touch initialize/session code the draft will later remove but are MUSTs
for everything shipped before the cut, so they are fixed now.

## Decisions

- **Supported versions:** strict — `2025-11-25` only. Introduce one exported
  `SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25']` in
  `packages/context-protocol/src/rpc.ts`; every version check reads from it.
  Widening later is a one-line change.
- **Absent `MCP-Protocol-Version` header (server):** allowed (back-compat with
  clients that omit it) — treat as the version negotiated at `initialize`.
  Present-but-unsupported header → 400. Do not 400 on absent.
- **Origin validation default:** secure-by-default. When `allowedOrigins` is
  unset, default to localhost-only (`http://localhost*`, `http://127.0.0.1*`,
  `http://[::1]*`). Explicit `allowedOrigins: '*'` opts out. A request with no
  Origin header when an allowlist is configured is rejected (403). This is a
  behavior change for current users — note in changelog.
- **404 → re-initialize:** typed signal, not silent auto-reinit. Transport
  clears `#sessionID` and surfaces a typed `SessionExpiredError`; the client
  layer decides whether to re-`initialize`. The retry policy on top of this
  signal is owned by the separate `http-transport-resilience` backlog; this spec
  owns only the typed-signal contract.
- **Tool errors as results:** `#callTool` converts handler exceptions AND
  `createTool` input-validation `INVALID_PARAMS` (SEP-1303) into
  `{isError: true, content: [{type: 'text', ...}]}`. Protocol/transport errors
  (parse, method-not-found) stay JSON-RPC errors — only tool-execution and
  input-validation convert.
- **Progress emitter:** thread `_meta.progressToken` into the server handler
  context and inject a `progress(token, value)` emitter that fires
  `notifications/progress`; no-op when the token is absent.

## Sequencing

Grouped by package-dependency order. Cross-package vitest resolves built `lib/`,
not `src/`, so each phase rebuilds `lib/` before the next phase's tests run.

### Phase A — `context-protocol` schemas (foundation)

Pure schema/const changes, no runtime behavior. Carry forward to the draft.

- **Item 3 — sampling `toolChoice` shape** (`sampling.ts:71-113`): rename
  `{type: 'auto'|'required'|'tool', toolName}` → `{mode: 'auto'|'required'|'none'}`
  (SEP-1577). Drop the `tool` variant, add `none`.
- **Item 4 — sampling content blocks** (`sampling.ts:58-68,190-215`): extend
  `SamplingMessage.content` beyond single `text|image` to include `audio`,
  `tool_use`, `tool_result`, and the array form. Reconcile with
  `initialize.ts:48-61`, which already declares the `sampling.tools` capability —
  complete SEP-1577 so the schemas can carry it (preferred) or drop the property.
- **Item 5 — SEP-1330 titled enums** (`schema.ts:80-156`): add `oneOf`/`anyOf`
  const+title variants alongside legacy `enum`+`enumNames`. Extend
  `ElicitResult.content` (`elicitation.ts:106-115`) with `{type: 'number'}` and
  `{type: 'array', items: {type: 'string'}}`. Minor: `schema.ts:23-77` — add
  `pattern` to string schema, make min/max `number` not `integer`.
- **Item 11 — URL elicitation completion** (`server.ts:34-44`, `rpc.ts:6-10`):
  add the `notifications/elicitation/complete` schema and the
  `URL_ELICITATION_REQUIRED = -32042` constant. The request schema already
  exists; only the completion path is missing.
- **Item 12 (partial) — constant:** add the `-32002` resource-not-found constant
  (`rpc.ts:6-10`). Note that the draft moves it to `-32602` (breaking-cut doc).

Build `lib/` at phase end.

### Phase B — client/server capability + behavior

- **Item 1 — client `protocolVersion` check** (`client.ts:234` — currently a
  `// TODO`): compare the responded version against
  `SUPPORTED_PROTOCOL_VERSIONS`; on mismatch dispose the transport and throw a
  typed error.
- **Item 2 — declare `logging` + `completions`** (`server.ts:106,128-131,202-217`):
  set `logging: {}` always; set `completions: {}` when `params.complete != null`.
- **Item 10 — tool errors as results** (`server.ts:249-259` + `rpc.ts:170-175`,
  `definitions.ts:62-64`): per the decision above.
- **Item 12 (partial):** server-side `MCP-Protocol-Version` header validation
  (400 on unsupported, allow absent); declare `listChanged: true` where
  `notify('tools/list_changed')` etc. is exposed (`server.ts:137-154`); thread
  `_meta.progressToken` + progress emitter into handler context; client-side
  capability gating before `tools/list` / `setLoggingLevel` / `complete`
  (`host.ts:386-396`, `client.ts:246-252`) and `METHOD_NOT_FOUND` for
  `roots/list` when the capability was not declared (`client.ts:221-229`).

Build `lib/` at phase end.

### Phase C — `http-client` / `http-server` transport MUSTs

- **Item 6 — negotiated-version header** (`http-client/transport.ts:103,282,336`):
  feed `InitializeResult.protocolVersion` back into the transport; send it
  instead of `LATEST_PROTOCOL_VERSION`.
- **Item 7 — 404 → re-initialize** (`http-client/transport.ts:159-162`): clear
  `#sessionID`, surface typed `SessionExpiredError`.
- **Item 8 — origin validation default** (`http-server/handler.ts:112-122`): per
  the decision above (localhost default, missing-Origin-with-allowlist → 403).
- **Item 9 — SEP-1699 cross-stream replay** (`http-server/handler.ts:331-342` +
  `sse-writer.ts:69-76`): index replay buffers per session across all streams;
  resolve `Last-Event-ID` via the encoded stream identity so POST-stream events
  are replayable via GET.

## Testing

Per-item TDD (red → green for every item) plus reusable conformance fixtures for
the schema items.

### Conformance fixtures

Location: `packages/context-protocol/test/conformance/`. Per-SEP files of
valid/invalid samples (`sampling-sep1577.json`, `elicitation-sep1330.json`,
etc.). Each fixture is an array of `{name, message, valid: boolean}`. One
parametrized test validates every sample against its schema and asserts the
accept/reject outcome. Covers items 3, 4, 5, 11. Reusable as the conformance
suite grows and survives the draft migration.

### Behavior tests (per package, vitest)

- **Item 1** — client disposes transport and throws on bad `protocolVersion`;
  accepts `2025-11-25`.
- **Item 2** — `initialize` result declares `logging` always, `completions` when
  `complete` is configured.
- **Item 6** — transport sends the negotiated version header after init, not
  `LATEST`.
- **Item 7** — 404 with an active session → `SessionExpiredError`, `#sessionID`
  cleared.
- **Item 8** — localhost origin allowed by default; foreign origin → 403; missing
  Origin with allowlist → 403; `'*'` opts out.
- **Item 9** — a POST-stream event is replayable via GET `Last-Event-ID`.
- **Item 10** — handler throw → `{isError: true}` result; bad input →
  `{isError: true}`; parse error stays a JSON-RPC error.
- **Item 12** — server 400s an unsupported header, allows absent; `listChanged:
  true` is present; the progress emitter fires `notifications/progress`.

### Gates

`pnpm build` (rebuild `lib/` after each phase before cross-package tests),
`pnpm test`, `rtk proxy pnpm run lint`.

## Out of scope

- Draft breaking hard-cut (B1–B7) — stays in
  `backlog/2026-06-09-mcp-draft-breaking-cut.md`.
- HTTP transport retry policy layered on the item-7 typed signal — owned by
  `backlog/2026-06-12-http-transport-resilience.md`.
- Already verified conformant in the audit (do not re-litigate): lifecycle
  ordering, cancellation, no batching, tool model, Streamable HTTP session
  handling, SSE event IDs + ring buffer, capability-driven declaration from
  config, log-level gating, 2020-12 dialect inference.
