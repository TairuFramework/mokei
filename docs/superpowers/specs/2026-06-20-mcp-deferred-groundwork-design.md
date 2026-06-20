# MCP draft — deferred groundwork (G5 inbound / G8 strict / G7 walk depth)

**Date:** 2026-06-20
**Status:** design approved
**Origin:** `docs/agents/plans/backlog/2026-06-09-mcp-draft-deferred-groundwork.md`,
`docs/agents/plans/milestones/2026-06-08-mcp-draft-migration.md`

## Scope

Three independent, self-contained units of the deferred MCP-draft groundwork. No
enkaku upstream blockers (`@enkaku/{otel,schema}@0.17.0` already pinned).

- **G5 inbound** — server-side W3C trace-context extraction.
- **G8 strict-mode** — silence valid-2020-12 strict-mode stderr noise.
- **G7 walk depth** — deeper `x-mcp-header` schema traversal (`$ref` + composites;
  error on array items).

**Explicitly deferred (not in this pass):**

- **G7 part 5** (stale-schema `tools/list` refresh + `tools/call` retry on a
  HeaderMismatch error). Reasons: no server emits HeaderMismatch today (no live
  draft server), the milestone's proposed `-32001` code already means
  `SESSION_EXPIRED_CODE` in mokei (`packages/http-client/src/errors.ts:10`), and it
  cannot be tested against a real draft peer. Revisit when a draft server exists.

## Decisions

| # | Decision |
|---|----------|
| G8 value | `strict: false` (suppress), not `'log'`. |
| G8 scope | Tool/prompt validators only (`context-server/src/definitions.ts:29,51`). Internal validators (client-message, provider configs) untouched. |
| G7 part 5 | Deferred. |
| G7 array items | Annotation inside array `items` → **error** (scalar header cannot map to a multi-element array), not silent miss and not invented index semantics. |
| G7 path model | Stays flat `Array<string>`. `buildParamHeaders` unchanged. |

---

## Unit 1 — G5 inbound (context-server)

### Goal

A server handler should run under the OTel context carried by the incoming
request's `_meta`, so server spans child the client's trace. Today only the
**outbound** side exists (`packages/context-client/src/trace.ts` →
`ContextClient.request()` injects `traceparent`/`tracestate`/`baggage`).

### Design

New file `packages/context-server/src/trace.ts` mirroring the client's. One helper:

```ts
import { extractTraceContext, type Context } from '@enkaku/otel'

export function activeContextFromMeta(
  meta: Record<string, unknown> | undefined,
): Context | undefined
```

It reads `traceparent` / `tracestate` / `baggage` string keys from `meta` and
delegates to `@enkaku/otel`'s `extractTraceContext(header)`. Returns `undefined`
when `meta` is absent or carries no `traceparent`.

### Seam

`packages/context-server/src/server.ts` — `_handleRequest()` (currently ~208–255).
Wrap the dispatch body **once**:

```ts
const ctx = activeContextFromMeta(request.params._meta)
const run = () => /* existing method-dispatch switch */
return ctx ? withActiveContext(ctx, run) : run()
```

`withActiveContext` from `@enkaku/otel`. One wrap covers tools, prompts, and
resources — no per-handler edits at lines 272 / 298 / 234 / 239 / 246.

`@enkaku/otel` inbound exports confirmed available: `extractTraceContext(header:
Record<string, unknown>) → Context | undefined`, `withActiveContext<T>(parent:
Context | undefined, fn: () => T) → T`.

### Tests

- Valid `_meta.traceparent` → a probe handler observes `getActiveTraceContext()`
  matching the injected trace/span ids.
- `tracestate` + `baggage` propagate (probe reads active baggage).
- Absent `_meta` → handler runs, no throw, no active trace context.
- Malformed `traceparent` → no throw; runs without context (extract returns
  `undefined`).

---

## Unit 2 — G8 strict-mode (context-server)

### Goal

Tool/prompt input schemas declaring JSON Schema 2020-12 (e.g. a `prefixItems`
2-tuple) are valid, but Ajv2020 strict mode logs warnings to user stderr. Silence
those for user-authored schemas.

### Design

`packages/context-server/src/definitions.ts` — the two `createValidator` calls
that already pass `{ draft: inferSchemaDraft(...) }`:

- line 29 (`createPrompt`, arguments schema)
- line 51 (`createTool`, input schema)

Add `strict: false` to each options object:

```ts
createValidator<…>(schema, { draft: inferSchemaDraft(schema), strict: false })
```

`ValidatorOptions` (`@enkaku/schema@0.17.0`) is `{ draft?: '07' | '2020-12';
strict?: boolean | 'log' }`. No other `createValidator` site changes (server
client-message validator, model-provider, provider configs stay strict-default).

### Tests

- `createTool` with a `prefixItems` 2-tuple `$schema: …/2020-12` input schema
  builds cleanly and produces no stderr / Ajv-logger warning (capture
  `console.error`).
- A still-invalid schema construct still surfaces an error (strict:false must not
  swallow genuine schema-compile failures — `false` disables strict *warnings*,
  not compilation errors).
- Existing draft-07 tool/prompt definitions unaffected.

---

## Unit 3 — G7 walk depth (http-client)

### Goal

`collectHeaderAnnotations` (`packages/http-client/src/x-mcp-header.ts:122-162`)
finds `x-mcp-header` annotations only under object `properties`. Annotations behind
`$ref`, `allOf`/`anyOf`/`oneOf`, or inside array `items` are silently missed — the
tool author maps a value to a header but no header is sent. Close the silent gap.

### Design

Extend the `walk` recursion. Header values are scalar strings; the path model stays
flat `Array<string>`; `buildParamHeaders` (`:176-184`) is unchanged.

1. **Root for `$ref`** — thread the schema root into `walk` (closure var captured at
   `collectHeaderAnnotations` entry) so `$ref` can resolve against `#/$defs/*` and
   `#/definitions/*`.
2. **`$ref`** — when a child schema is `{ $ref: '#/$defs/X' }`, resolve to the target
   and continue walking it at the same `path`. Maintain a resolving-ref `Set`; a
   ref that re-enters an in-progress ref → push error
   `Circular $ref at <path>` and stop that branch.
3. **Composites** — for `allOf` / `anyOf` / `oneOf` on a schema node, descend each
   branch schema with the **same** `path` (branches describe the same object level).
   Existing duplicate-annotation detection (`seen` set) naturally catches an
   annotation repeated across branches.
4. **Array items** — if a schema node is `{ type: 'array', items: … }` (or `items`
   present) and the items subtree contains any `x-mcp-header`, push error
   `x-mcp-header "<name>" at <path> cannot be inside array items (scalar header)`.
   Detect by walking items in a detect-only mode that records an error instead of an
   annotation. (A tool with such an annotation is excluded from the list — same
   existing `valid === false` → filtered behavior.)

Path semantics: `$ref` and composites do not add path segments (they don't
introduce a new object key); only `properties` keys do, as today.

### Edge cases

- `$ref` to a non-existent pointer → error `Unresolved $ref "<ref>" at <path>`.
- `$ref` combined with sibling `properties` (allowed in 2020-12) → walk both.
- Nested composites (`allOf` containing `anyOf`) → recurse normally.
- Annotation inside `items` that is itself behind a `$ref` → resolve, still error
  (it's still array-element scope).

### Tests

- `$ref`'d property annotation is collected with correct flat path.
- Annotation under `allOf` / `anyOf` / `oneOf` branch is collected.
- Same annotation in two composite branches → duplicate error (unchanged behavior).
- Annotation inside array `items` → array-items error, tool excluded.
- Circular `$ref` → circular error, no infinite loop.
- Unresolved `$ref` → unresolved error.
- All existing object-`properties` cases still pass (no regression).

---

## Cross-cutting

- **Isolation** — three units, three packages, three seams; no shared state, no
  ordering dependency. Each independently testable.
- **Conventions** — `type` not `interface`; `Array<T>`; `HTTP`/`ID` casing; no
  `any`; `pnpm`. New files follow the existing `trace.ts` / `x-mcp-header.ts`
  patterns.
- **Docs to update on completion**:
  - `backlog/2026-06-09-mcp-draft-deferred-groundwork.md` — move G5 inbound, G8
    strict, G7 walk to shipped; leave G7 part 5 as the remaining gap.
  - `milestones/2026-06-08-mcp-draft-migration.md` — tick the same in the deferred
    groundwork section.
  - `docs/agents/plans/roadmap.md` — update the deferred-groundwork backlog line.
