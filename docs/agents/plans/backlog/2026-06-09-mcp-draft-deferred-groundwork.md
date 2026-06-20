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

## Remaining gap

- **G5 inbound** — server-side extraction: parse incoming `_meta.traceparent` and run the
  handler under `withActiveContext` so server spans link to the client trace. Outbound only
  so far. **Self-contained mokei work — not blocked.**
- **G7 part 5** — stale-schema fallback: on `-32001` HeaderMismatch, refresh via `tools/list`
  and retry the `tools/call`. Resilience nicety; matters only against a live draft server.
- **G7 walk depth** — `collectHeaderAnnotations` covers object `properties` depth only;
  extend to array `items` / `$ref` / `allOf`|`anyOf`|`oneOf` (needs a richer argument-path
  model than the current flat property path).
- **G8 strict-mode opt-in** — upstream `ValidatorOptions.strict` (`boolean | 'log'`) landed
  in `@enkaku/schema@0.17.0` (mokei already pins `^0.17.0`). Remaining mokei work: thread
  `strict: false` (or `'log'`) where `Ajv2020` is constructed so valid 2020-12 constructs
  (e.g. `prefixItems` 2-tuple) stop logging to user stderr. **Upstream unblocked.**

## Notes

- G5/G8 enkaku upstream asks landed in `@enkaku/{schema,otel}@0.16.1` (enkaku #33);
  the `getActiveBaggage` + `strict` passthrough follow-ups landed in `@enkaku/{otel,schema}@0.17.0`
  (enkaku `chore/mokei-follow-ups`), both consumed by mokei's `^0.17.0` catalog pins.
- **No remaining enkaku upstream blockers** — every item here is now self-contained mokei work.
- G7 follow-ups are self-contained in `@mokei/http-client` and could land any time.
