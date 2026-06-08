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
_(filled by Task 4)_
