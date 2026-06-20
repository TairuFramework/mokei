# MCP draft — deferred groundwork (G5 baggage/inbound / G7 follow-ups)

**Status:** backlog
**Origin:** `milestones/2026-06-08-mcp-draft-migration.md` — non-breaking groundwork that
could not land in Phase 0.

## Shipped (no longer in this item)

On `feat/mcp-draft-groundwork-g5-g8`:

- **G8** — infer draft from `$schema`; tool/prompt schemas declaring 2020-12 validate
  against `Ajv2020` (`@enkaku/schema@0.16.1` `{ draft }`). Default stays draft-07 →
  non-breaking.
- **G5 outbound** — `ContextClient.request()` injects `_meta.traceparent` + `_meta.tracestate`
  from the active OTel span (`@enkaku/otel@0.16.1`).

On `feat/mcp-draft-g5-baggage` (2026-06-19):

- **G5 baggage** — `currentTraceMeta()` now also emits the SEP-414 `baggage` `_meta` key
  via `formatBaggage(getActiveBaggage() ?? [])` (`@enkaku/otel@0.17.0`). New pure,
  unit-tested `baggageMetaFromEntries` helper in `context-client/src/trace.ts` (omits the
  key when empty / all-dropped). The upstream `getActiveBaggage` blocker is resolved.

On `feat/mcp-draft-groundwork-g5-g8` (2026-06-20):

- **G8 strict-mode** — `strict: false` threaded into tool/prompt schema validators in
  `context-server/src/definitions.ts`. Valid 2020-12 constructs (e.g. `prefixItems` 2-tuple)
  no longer log to user stderr. (`@enkaku/schema@0.17.0` `ValidatorOptions.strict`.)
- **G7 walk depth** — `collectHeaderAnnotations` in `http-client` now traverses local `$ref`
  + `allOf`/`anyOf`/`oneOf` composites; raises a schema-authoring error when `x-mcp-header`
  appears inside array `items`/`prefixItems` (unsupported path model). Flat path model kept.
- **G5 inbound** — `context-server` now activates the request's W3C trace context + baggage
  for the handler. New `context-server/src/trace.ts` (`activeContextFromMeta` /
  `baggageEntriesFromMeta` / `withRequestMeta`); `_handleRequest` wraps dispatch once via
  `withRequestMeta(request.params._meta, …)` (trace outer, baggage inner). Uses
  `@enkaku/otel@0.17.1` `extractW3CTraceContext` + `withActiveBaggage` (the asks filed
  2026-06-20 shipped in enkaku #42). Server spans now child the client trace.

## Remaining gap

- **G7 part 5** — stale-schema fallback: on `-32001` HeaderMismatch, refresh via `tools/list`
  and retry the `tools/call`. Resilience nicety; matters only against a live draft server.
  Deferred: no live draft server emits it, and `-32001` already means `SESSION_EXPIRED_CODE`
  in mokei (`http-client/src/errors.ts`).

## Notes

- G5/G8 enkaku upstream asks landed in `@enkaku/{schema,otel}@0.16.1` (enkaku #33);
  the `getActiveBaggage` + `strict` passthrough follow-ups landed in `@enkaku/{otel,schema}@0.17.0`
  (enkaku `chore/mokei-follow-ups`); the G5-inbound `extractW3CTraceContext` + `withActiveBaggage`
  asks landed in `@enkaku/otel@0.17.1` (enkaku #42). All consumed by mokei's `^0.17.1` catalog pins.
- **No remaining enkaku blockers.** Only G7 part 5 remains, self-contained in `@mokei/http-client`.
