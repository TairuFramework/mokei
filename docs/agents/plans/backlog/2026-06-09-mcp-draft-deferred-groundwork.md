# MCP draft — deferred groundwork (G5 / G8 / G7 follow-ups)

**Status:** backlog (partly blocked upstream)
**Origin:** `milestones/2026-06-08-mcp-draft-migration.md` — non-breaking groundwork that
could not land in Phase 0.

## Gap

Phase 0 shipped G1–G4, G6, and G7 (parts 1–4) on `2025-11-25`. Three groundwork items
remain, two blocked on `@enkaku/*`:

- **G5** — OTel `_meta` trace context (`traceparent`/`tracestate`/`baggage`, SEP-414).
  `@enkaku/otel@0.16.0` covers `traceparent` only (and is not yet a dependency).
- **G8** — loosen `inputSchema`/`outputSchema` to JSON Schema 2020-12 + `$ref` (SEP-2106).
  `@enkaku/schema@0.16.0` is draft-07 (single module-level AJV, no draft option).
- **G7 follow-ups** — not blocked, but deferred from the Phase 0 pass.

## Scope

- **G8 (after upstream):** once `@enkaku/schema` exposes `Ajv2020` / a configurable draft,
  relax the `context-protocol` schema validation to accept 2020-12 keywords + `$ref`.
  Relaxation (accept more, reject less) → non-breaking. Upstream ask filed at
  `../enkaku/docs/superpowers/specs/2026-06-09-schema-json-schema-2020-12.md`.
- **G5 (after upstream, or partial):** wire `@enkaku/otel` into the outgoing-request
  builder (`context-client` / `context-rpc`) to populate `_meta`. Either implement
  `traceparent`-only now and document the `tracestate`/`baggage` gap, or wait for upstream
  codecs. Ask filed at `../enkaku/docs/superpowers/specs/2026-06-09-otel-tracestate-baggage-codecs.md`.
- **G7 part 5:** stale-schema fallback — on `-32001` HeaderMismatch, refresh via
  `tools/list` and retry the `tools/call`. Resilience nicety; matters only against a live
  draft server.
- **G7 walk depth:** `collectHeaderAnnotations` covers object `properties` depth only;
  extend to array `items` / `$ref` / `allOf`|`anyOf`|`oneOf` (needs a richer argument-path
  model than the current flat property path).

## Notes

- G5/G8 unblock only after the matching enkaku upstream asks land. Track those.
- G7 follow-ups are self-contained in `@mokei/http-client` and could land any time.
