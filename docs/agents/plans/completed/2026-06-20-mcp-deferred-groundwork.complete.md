# MCP draft — deferred groundwork (G8 strict / G7 walk depth / G5 inbound)

**Status:** complete
**Date:** 2026-06-20
**Branch:** `feat/mcp-deferred-groundwork` (commits `2c078ba`..`8cd605c`)
**Origin:** `backlog/2026-06-09-mcp-draft-deferred-groundwork.md`,
`milestones/2026-06-08-mcp-draft-migration.md`

## What shipped

Three self-contained slices of the MCP-draft deferred groundwork.

- **G8 strict-mode** — `strict: false` added to the tool/prompt `createValidator`
  calls in `context-server/src/definitions.ts`. Valid JSON Schema 2020-12 constructs
  (e.g. a `prefixItems` 2-tuple) no longer trip Ajv2020 `strictTuples` warnings to
  user stderr. Scoped to the two user-schema validators only; internal
  client-message / provider validators stay strict-default. A negative test confirms
  genuine compile errors still throw (`strict:false` suppresses warnings, not
  failures).
- **G7 walk depth** — `collectHeaderAnnotations` (`http-client/src/x-mcp-header.ts`)
  now traverses local `$ref` (`#/$defs/*`, `#/definitions/*`, with circular- and
  unresolved-ref detection) and `allOf`/`anyOf`/`oneOf` composites (branches share
  the parent argument path). An `x-mcp-header` found inside array `items`/`prefixItems`
  is now a hard error (a scalar header cannot carry a multi-element array) rather than
  a silent miss — the tool is excluded from the list with a logged reason. Flat
  `Array<string>` path model and the public signature unchanged; `buildParamHeaders`
  untouched.
- **G5 inbound** — SHIPPED. Initially blocked (enkaku's `extractTraceContext` reads
  `tid`/`sid`, not the SEP-414 W3C `traceparent` mokei emits, and had no baggage
  activation), so an ask was filed to the `../enkaku` checkout for
  `extractW3CTraceContext(meta)` + `withActiveBaggage`. enkaku shipped both in
  `@enkaku/otel@0.17.1` (enkaku #42) within the same session, and the wiring landed:
  new `context-server/src/trace.ts` (`activeContextFromMeta` / `baggageEntriesFromMeta` /
  `withRequestMeta`); `_handleRequest` wraps dispatch once with `withRequestMeta` (trace
  context outer, baggage inner). Server spans now child the client trace. One wrap covers
  tools / prompts / resources.

## Key design decisions

- **G8:** `strict: false` (suppress) over `'log'`, on tool/prompt validators only —
  the noise comes from user-authored 2020-12 schemas, and internal schemas benefit
  from strict checks.
- **G7 array items → error, not index semantics:** a header value is scalar; an array
  element annotation has no unambiguous mapping. Surfacing a loud error beats either a
  silent miss (the prior behavior) or inventing index-path semantics the spec doesn't
  define.
- **G7 walk relocation (implementation deviation, reviewed):** the annotation check
  moved to the top of `walk()` (guarded by `path.length > 0`) instead of inside the
  properties loop, so a `$ref` target carrying the annotation directly on a scalar is
  seen. Confirmed no double-counting, intact dedup, correct `inArray` propagation.
- **G5 builder home → upstream:** keep `@opentelemetry/api` out of mokei; the
  W3C→Context builder belongs in `@enkaku/otel` beside the existing `tid`/`sid`
  variant. enkaku shipped it (`extractW3CTraceContext` + `withActiveBaggage`,
  `@enkaku/otel@0.17.1`, enkaku #42) same-session, so the wiring landed rather than
  deferring. `withActiveBaggage` nests inside `withActiveContext` (it reads the active
  context), so `withRequestMeta` applies trace context outer, baggage inner.

## Verification

Full gate green: lint clean, `pnpm build` green, all tests pass (G5-inbound adds 11
context-server tests; suite 42/42 in that package). Per-task reviews (spec + quality)
plus a final whole-branch review (Ready to merge: Yes) — no Critical/Important findings
left open. The one Important on G5 inbound (a `useLiteralKeys` lint nit) was fixed.

## Remaining (tracked in backlog)

`backlog/2026-06-09-mcp-draft-deferred-groundwork.md`:

- **G7 part 5** — HeaderMismatch `tools/list` refresh + `tools/call` retry. Deferred:
  no live draft server emits it, and the milestone's `-32001` code already means
  `SESSION_EXPIRED_CODE` in mokei. Only remaining item; no enkaku blockers left.

Minor follow-ups (non-blocking, from final review): cache collected annotations in
`#toolSchemas` to skip the per-`tools/call` walk recompute; clarify the
`$ref`-wrapper-plus-target duplicate error message.
