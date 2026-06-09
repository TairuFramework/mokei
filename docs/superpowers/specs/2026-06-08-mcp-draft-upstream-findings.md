# MCP Draft — Upstream (Enkaku) Findings

Companion to `2026-06-08-mcp-draft-migration-design.md`. Records the resolution of
upstream items U1–U3 before the breaking migration phase.

## U2 — `@enkaku/schema` JSON Schema draft level

**Confirmed: draft-07.** `@enkaku/schema@0.16.0` constructs a single module-level
`new Ajv({ allErrors: true, useDefaults: false })` (the default `ajv` import = JSON
Schema draft-07) and exposes no per-call draft option. 2020-12 keywords
(`prefixItems`, `$dynamicRef`, `unevaluatedProperties`, etc.) are silently ignored.

**Impact:** Spec item **G8** (loosen `inputSchema`/`outputSchema` to arbitrary JSON
Schema 2020-12 keywords + `$ref` resolution) **cannot be implemented in mokei alone**.

**Upstream ask (Enkaku `@enkaku/schema`):** switch the validator to `Ajv2020`
(`import Ajv2020 from 'ajv/dist/2020'`) or allow `createValidator` to select the
draft / accept an AJV instance. Until then G8 stays deferred.

_Probe note:_ the root-resolved probe failed with `ERR_MODULE_NOT_FOUND` (package
not hoisted to repo root). Inspecting `lib/validation.js` confirmed `import { Ajv }
from 'ajv'` + a single module-level `new Ajv({ allErrors: true, useDefaults: false })`,
no `Ajv2020`. Re-running the probe against the installed `lib/index.js` threw
`Error: strict mode: unknown keyword: "prefixItems"` (AJV draft-07 rejects the
2020-12 keyword as unknown), directly establishing the draft-07 finding.

## U3 — `@enkaku/otel` availability & `_meta` mapping

**Dependency status:** `@enkaku/otel` is **not currently a dependency** of any
workspace package (no hits in `packages/*/package.json` or `pnpm-workspace.yaml`).
It is **available at `@enkaku/otel@0.16.0`** in the pnpm store.

**Exported trace-context helpers (`@enkaku/otel@0.16.0`):**

- `injectTraceContext(header)` / `extractTraceContext(header)` — inject/extract trace
  context into/from a header object. **Note:** these use Enkaku's own compact fields
  `tid` (traceId) + `sid` (spanId), **not** W3C headers. No `tracestate`, no `baggage`.
- `formatTraceparent(traceID, spanID, traceFlags)` / `parseTraceparent(header)` —
  format/parse a **W3C `traceparent`** header value (version `00` only). Type
  `TraceparentData = { traceID, spanID, traceFlags }`.
- `setSpanOnContext`, `withActiveContext`, `getActiveSpan`, `getActiveTraceContext`,
  `createTracer`, `withSpan`, `withSyncSpan` — span/context plumbing (not header codecs).
- `AttributeKeys`, `SpanNames`, `ZERO_TRACE_ID` — semantic constants.

A repo-wide grep of the installed lib for `tracestate`/`baggage` returned **none**.

**Verdict for G5: INSUFFICIENT.** Only `traceparent` is covered. `@enkaku/otel@0.16.0`
provides **no `tracestate` and no `baggage`** formatting/parsing, and its
`inject`/`extractTraceContext` helpers emit non-W3C `tid`/`sid` fields rather than the
standard `traceparent` header. The trio required by G5 is not fully supported.

**Decision:** G5 (OTel `_meta` keys) requires ADDING `@enkaku/otel` as a dependency of
the package that builds outgoing requests (`context-client` / `context-rpc`) — it is not
wired today. Injection point: `_meta` of outgoing requests. Because the helpers cover
**only `traceparent`** (and not `tracestate`/`baggage`), **G5 stays deferred** as a
full-trio mapping: either implement G5 with `traceparent` only (using
`formatTraceparent`/`parseTraceparent`) and explicitly document the `tracestate`/`baggage`
gap, or file an upstream ask for `@enkaku/otel` to add `tracestate`/`baggage` codecs.

## U1 — Transport model vs stateless + MRTR

Current model (`packages/context-rpc/src/rpc.ts`): `ContextRPC` is a **symmetric
bidirectional duplex** over `@enkaku/transport` `TransportType<In, Out>`. The transport
is a single `ReadableWritablePair` — exactly one inbound read stream (`read()` /
`[Symbol.asyncIterator]`) and one outbound write stream (`write()` / `getWritable()`).
`request()` (lines ~201-228) allocates a monotonic numeric id (`#requestID++`), stores a
`RequestController` (an `AbortController` merged with a `Deferred`) in `#sentRequests`,
writes the request, and returns the deferred promise. The single `_handle()` read loop
(`handleNext`) demuxes every inbound frame in `_handleMessage()`: responses are matched
back to `#sentRequests[id]` and resolve/reject the deferred; requests get an entry in
`#receivedRequests` and produce a single `Response`; notifications fan out to
`_handleNotification()`. There is one id-space and one frame multiplex shared by both
directions.

**1. Can the duplex `TransportType<In, Out>` model (a) request-scoped response streams
and (b) a single opt-in `subscriptions/listen` long-poll, without a persistent
server→client channel?**

**Yes — at the `context-rpc` layer, not at the `@enkaku/transport` layer.** The
transport itself is direction-symmetric: every frame written by the peer arrives on the
one shared read stream, and `TransportType` has no concept of per-request substreams. So
"request-scoped response streams" is a *logical* construct that `context-rpc` must build
on top of the flat frame multiplex, not something the transport provides natively.

(a) Request-scoped streaming is achievable: tag each notification (e.g. progress)
arriving on the read loop with the originating request id (the protocol already does this
for `notifications/progress` via `progressToken`, and `notifications/cancelled` via
`requestId`). `_handleMessage()` already routes by id; it would route stream-scoped
notifications to the matching `#sentRequests[id]` controller (which would need to expose a
stream/iterator sink instead of a one-shot `resolve`). No persistent server→client
channel is required *as long as the request is in flight* — the frames simply ride the
same duplex back to the requester while its read loop is running.

(b) A single opt-in `subscriptions/listen` long-poll is just one more in-flight request
whose response stream stays open: the client issues `subscriptions/listen`, keeps that one
`#sentRequests` entry alive, and the server emits subsequent server-initiated messages as
stream frames correlated to that request id. This gives server→client delivery without a
*separate* always-on channel — it is the existing duplex carrying one long-lived logical
stream. **Caveat:** the duplex is still physically bidirectional and long-lived; "no
persistent server→client channel" holds only in the logical sense (no second transport,
no out-of-band push) — the underlying duplex read stream must remain open for the
long-poll to receive anything.

**2. MRTR continuation — where does state live, and how must `#sentRequests` change on
the server side?**

In MRTR the *server* no longer calls `request()` to ask the client something; instead it
returns `inputRequests` inside its result and **terminates its turn**. The continuation
state therefore cannot live in `#sentRequests` on the server: today `#sentRequests` holds
in-memory `Deferred`s that assume the asker keeps a live promise awaiting a correlated
response on the same connection. With MRTR the server has already returned and unwound its
call stack — there is no pending deferred to resolve, and on a stateless transport there
may be no shared connection at all when the client comes back with the filled inputs.

So for the server side the model inverts: the *client* drives correlation. The server
emits `inputRequests` as plain result data carrying its own correlation token(s)
(per-input ids the server minted), and the client later issues a fresh request
(continuation) echoing those tokens. The server reconstructs continuation state from a
**durable, connection-independent store keyed by those tokens** (session/turn id +
input-request ids), not from `#sentRequests`. Concretely: `#sentRequests` on the *server*
is no longer used for soliciting client input — it would either be removed for that path
or repurposed only for genuine server-initiated requests (if any remain). The
abort/cancel wiring tied to `#sentRequests` (lines ~209-216) likewise does not apply,
since there is no outstanding server-side deferred to cancel; cancellation of an MRTR turn
becomes a client-issued notification against the stored continuation token instead.

**3. Recommendation.**

**Reimplement correlation in `context-rpc` above the existing `@enkaku/transport`** — do
not extend or fork the transport. The transport's single-duplex `read()/write()` +
async-iterator surface is already sufficient to carry every frame; the gaps (request-
scoped streaming, `subscriptions/listen` long-poll, and MRTR continuation tokens) are all
*correlation and state-management* concerns that belong in `ContextRPC`, not in the
byte/frame plumbing. Specifically: (i) generalize `#sentRequests` controllers so a request
can resolve a *stream* of correlated frames rather than a single response; (ii) add a
continuation-token store decoupled from `#sentRequests` for MRTR, keyed by server-minted
input-request ids and survivable across (stateless) reconnects; (iii) keep
`@enkaku/transport` untouched so all existing transports (stdio, HTTP, direct) work
unchanged. Extending `@enkaku/transport` with a new contract or adding a new transport
shape would push protocol-level correlation into the wrong layer and break the clean
separation that lets mokei reuse every transport interchangeably.

## G7 — x-mcp-header custom headers (SEP-2243)

**Source:** Draft spec page `https://modelcontextprotocol.io/specification/draft/basic/transports/streamable-http`
(SEP-2243 merged PR; spec fully reflects the merged semantics).

### (a) Exact mapping — source of values, naming convention, client/server side

The spec is fully specified. Key rules:

- **Server side — annotation:** A server marks a tool parameter to be mirrored into
  an HTTP header by adding `"x-mcp-header": "<Name>"` as an extension property on
  that parameter's schema entry inside the tool's `inputSchema`. `<Name>` is the
  name-portion only (not the full header name).
- **Client side — construction:** The resulting header name is `Mcp-Param-{Name}`
  (e.g. `"x-mcp-header": "Region"` → header `Mcp-Param-Region`). Clients **MUST**
  support this feature; when a tool definition carries `x-mcp-header` annotations,
  clients **MUST** mirror the designated argument values into the corresponding
  `Mcp-Param-*` headers on every `tools/call` POST.
- **Value encoding:** Values are converted to strings (integer → decimal, boolean →
  `"true"`/`"false"`, string as-is). Non-ASCII, control characters, or
  leading/trailing whitespace must be Base64-encoded with the sentinel wrapper
  `=?base64?{value}?=`. Any plain-ASCII value that itself matches the sentinel
  pattern must also be Base64-encoded.
- **Constraints on `x-mcp-header` values:** must be non-empty; must match RFC 9110
  field-name token syntax (`1*tchar`); must be case-insensitively unique within the
  tool's `inputSchema`; only applicable to primitive types (integer, string,
  boolean — not `number`); may appear at any nesting depth.
- **Null / absent parameters:** client MUST omit the `Mcp-Param-*` header; server
  MUST NOT expect it.
- **Invalid tool rejection:** clients using Streamable HTTP MUST reject (exclude from
  `tools/list` result) any tool definition where an `x-mcp-header` value violates the
  constraints, logging a warning. Clients on other transports (e.g. stdio) MAY ignore
  `x-mcp-header` entirely.
- **Server validation:** servers MUST validate that each `Mcp-Param-{Name}` header
  value matches the corresponding argument value in the request body; mismatch → HTTP
  400 + JSON-RPC error `-32001` (`HeaderMismatch`). Servers MUST NOT reject a request
  solely because a recognized `Mcp-Param-*` header is absent (omission means null/not
  provided). Intermediaries MUST forward unrecognised `Mcp-Param-*` headers and
  otherwise ignore them.
- **Relationship to `Mcp-Method`/`Mcp-Name`:** `x-mcp-header` custom headers are
  additive alongside the required standard headers (`Mcp-Method`, `Mcp-Name`,
  `MCP-Protocol-Version`). They are set in the same step (client constructs the POST),
  after the standard headers, per the client-behavior sequence in the spec.
- **Transport scope:** Streamable HTTP only. Stdio transport clients MAY ignore.

**Status: RESOLVED.** The draft spec page contains the complete normative rules.

### (b) Implied change in `packages/http-client/src/transport.ts` — IMPLEMENTED (parts 1–4)

Parts 1–4 landed on `feat/mcp-spec-update` (G7 code task). Additive and dormant on the
`2025-11-25` baseline: servers on that version emit no `x-mcp-header` annotations, so the
injection/filtering paths are inert until a draft server uses them.

1. **Cache the tool `inputSchema`** — DONE. `HTTPTransport.#handleIncoming` correlates
   responses to their request method via `#pendingMethods` (id → method) and, for
   `tools/list` results, stores each tool's `inputSchema` in `#toolSchemas` keyed by name.
2. **Header injection on `tools/call`** — DONE. `#sendMessage` looks up the cached schema
   for the named tool, collects valid `x-mcp-header` annotations, and appends
   `Mcp-Param-{Name}: {encodedValue}` for each non-null argument.
3. **Value encoding helper** — DONE. `encodeHeaderValue` in `src/x-mcp-header.ts` (pure,
   unit-tested): integer→decimal, boolean→`true`/`false`, string passthrough, Base64
   sentinel (`=?base64?…?=`) for non-ASCII / control / surrounding-whitespace / sentinel
   collisions. `collectHeaderAnnotations` validates names (`1*tchar`), case-insensitive
   uniqueness, and primitive-only types (boolean/integer/string, not `number`).
4. **Tool-list filtering** — DONE. `#handleIncoming` excludes any tool whose `inputSchema`
   carries an invalid `x-mcp-header` annotation and logs a `console.warn`.

**Scope limit (follow-up):** `collectHeaderAnnotations` traverses nested object
`properties` at any depth, but not array `items`, `$ref` targets, or composition keywords
(`allOf`/`anyOf`/`oneOf`). Annotations there are not collected. Those require a richer
argument-path model than the current flat property path; tracked as follow-up. The spec's
"any nesting depth" is met for property nesting only. Nullable primitive types
(e.g. `["string","null"]`) ARE accepted.

5. **Stale-schema fallback** — DEFERRED (follow-up). If no schema is cached at call time the
   request is sent without `Mcp-Param-*` headers (graceful no-op). The `-32001` HeaderMismatch
   detection + `tools/list` refresh + retry is a resilience nicety that only matters against a
   live draft server; not implemented in this groundwork pass.
