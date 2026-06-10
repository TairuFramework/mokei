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

## Remaining gap

- **G5 baggage** — no `baggage` `_meta` key emitted. `@enkaku/otel@0.16.1` ships
  `formatBaggage`/`parseBaggage` but no active-baggage accessor, so there is nothing to
  format from. Needs an upstream `getActiveBaggage` (new Enkaku ask) or a direct
  `@opentelemetry/api` read.
- **G5 inbound** — server-side extraction: parse incoming `_meta.traceparent` and run the
  handler under `withActiveContext` so server spans link to the client trace. Outbound only
  so far.
- **G7 part 5** — stale-schema fallback: on `-32001` HeaderMismatch, refresh via `tools/list`
  and retry the `tools/call`. Resilience nicety; matters only against a live draft server.
- **G7 walk depth** — `collectHeaderAnnotations` covers object `properties` depth only;
  extend to array `items` / `$ref` / `allOf`|`anyOf`|`oneOf` (needs a richer argument-path
  model than the current flat property path).
- **G8 strict-mode warnings** — `Ajv2020` in default strict mode logs to stderr for valid
  2020-12 constructs (e.g. `prefixItems` 2-tuple without `minItems`/`maxItems`). Harmless
  (validator works) but leaks to user consoles. Needs an upstream `@enkaku/schema` ask for a
  `strict: false` (or `strict: 'log'`) passthrough on `ValidatorOptions`.

## Notes

- G5/G8 enkaku upstream asks landed in `@enkaku/{schema,otel}@0.16.1` (enkaku #33).
- G5 baggage needs a further upstream ask (`getActiveBaggage`) — file locally to
  `../enkaku` per house convention, not the GitHub repo.
- G7 follow-ups are self-contained in `@mokei/http-client` and could land any time.
