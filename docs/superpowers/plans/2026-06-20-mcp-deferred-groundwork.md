# MCP Deferred Groundwork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the self-contained MCP-draft deferred groundwork — G8 strict-mode noise suppression and the G7 `x-mcp-header` deep schema walk — and file the enkaku upstream ask that unblocks G5 inbound.

**Architecture:** Three independent units, no ordering dependency. G8 = two-line option change in `context-server/src/definitions.ts`. G7 = rewrite of the `collectHeaderAnnotations` walk in `http-client/src/x-mcp-header.ts` to traverse `$ref` / `allOf`/`anyOf`/`oneOf` and to error (not silently miss) on array-element annotations. G5 inbound = author an upstream request file in the `../enkaku` checkout (uncommitted); the server wiring is deferred until enkaku releases the helper.

**Tech Stack:** TypeScript (ESM, `nodenext`), vitest, `@enkaku/schema` (Ajv/Ajv2020 under the hood), `@enkaku/otel`, pnpm workspace.

## Global Constraints

- `type` not `interface`; `Array<T>` not `T[]`; no `any` (use `unknown` / specific types).
- Casing: `HTTP` / `ID` / `JWT` (no `Http`/`Id`).
- Package manager: `pnpm` / `pnpx` only — never `npm`/`npx`.
- Do not edit generated files (`.gen.ts`, `__generated__/`, `lib/`).
- Conventional-commit messages; end commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Branch: `feat/mcp-deferred-groundwork` (already created; the design spec is committed there).
- **Do NOT commit anything to the `../enkaku` repo** — Task 3 only authors a file there.

---

### Task 1: G8 strict-mode — silence valid-2020-12 stderr noise

**Files:**
- Modify: `packages/context-server/src/definitions.ts:29-31` and `:51-53`
- Test: `packages/context-server/test/lib.test.ts` (append a `describe` block)

**Interfaces:**
- Consumes: `createTool(description, inputSchema, handler)` and `createPrompt(description, argumentsSchema, handler)` from `packages/context-server/src/definitions.ts` — existing exports, signatures unchanged.
- Produces: nothing new; behavior change only (Ajv2020 strict-mode warnings suppressed for tool/prompt schemas).

- [ ] **Step 1: Write the failing test**

Append to `packages/context-server/test/lib.test.ts` (the file already imports from `vitest`; add `vi` to that import if absent):

```ts
import { createTool } from '../src/definitions.js'

describe('G8 strict-mode suppression', () => {
  test('a valid 2020-12 prefixItems schema logs no strict-mode warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      createTool(
        'tuple tool',
        {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          properties: {
            pair: {
              type: 'array',
              prefixItems: [{ type: 'string' }, { type: 'number' }],
            },
          },
        } as const,
        () => ({ content: [] }),
      )
      expect(warn).not.toHaveBeenCalled()
      expect(error).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
      error.mockRestore()
    }
  })

  test('a genuinely broken schema still throws (strict:false suppresses warnings, not compile errors)', () => {
    expect(() =>
      createTool(
        'broken tool',
        { type: 'not-a-real-type' } as unknown as Parameters<typeof createTool>[1],
        () => ({ content: [] }),
      ),
    ).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy pnpm --filter @mokei/context-server run test:unit lib.test`
Expected: FAIL — the `prefixItems` test sees a `console.warn` call (Ajv `strictTuples` warning) because `strict` is still default-on.

- [ ] **Step 3: Add `strict: false` to both validators**

In `packages/context-server/src/definitions.ts`, change the `createPrompt` validator (lines 29-31):

```ts
  const validate = createValidator<ArgumentsSchema, Arguments>(argumentsSchema, {
    draft: inferSchemaDraft(argumentsSchema),
    strict: false,
  })
```

And the `createTool` validator (lines 51-53):

```ts
  const validate = createValidator<InputSchema, Input>(inputSchema, {
    draft: inferSchemaDraft(inputSchema),
    strict: false,
  })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy pnpm --filter @mokei/context-server run test:unit lib.test`
Expected: PASS — no warning, broken-schema test still throws.

- [ ] **Step 5: Commit**

```bash
git add packages/context-server/src/definitions.ts packages/context-server/test/lib.test.ts
git commit -m "feat(context-server): suppress Ajv2020 strict-mode noise on tool/prompt schemas (G8)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: G7 walk depth — traverse `$ref` + composites, error on array items

**Files:**
- Modify: `packages/http-client/src/x-mcp-header.ts:110-162` (the doc comment + `collectHeaderAnnotations`)
- Test: `packages/http-client/test/x-mcp-header.test.ts` (append cases to the existing `collectHeaderAnnotations` describe block)

**Interfaces:**
- Consumes: `isValidHeaderParamName(name)`, `isEligibleType(type)` — existing module-local helpers (unchanged).
- Produces: `collectHeaderAnnotations(inputSchema: unknown): CollectResult` — same signature and `CollectResult` shape (`{ annotations: Array<HeaderAnnotation>; valid: boolean; errors: Array<string> }`); `HeaderAnnotation` stays `{ headerName: string; path: Array<string> }`. `buildParamHeaders` is untouched.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('collectHeaderAnnotations', …)` block in `packages/http-client/test/x-mcp-header.test.ts`:

```ts
  test('collects an annotation behind a $ref', () => {
    const schema = {
      type: 'object',
      properties: { region: { $ref: '#/$defs/Region' } },
      $defs: { Region: { type: 'string', 'x-mcp-header': 'Region' } },
    }
    const result = collectHeaderAnnotations(schema)
    expect(result.valid).toBe(true)
    expect(result.annotations).toEqual([{ headerName: 'Region', path: ['region'] }])
  })

  test('collects an annotation inside an anyOf branch', () => {
    const schema = {
      type: 'object',
      anyOf: [{ properties: { tenant: { type: 'string', 'x-mcp-header': 'Tenant' } } }],
    }
    const result = collectHeaderAnnotations(schema)
    expect(result.valid).toBe(true)
    expect(result.annotations).toEqual([{ headerName: 'Tenant', path: ['tenant'] }])
  })

  test('flags the same annotation repeated across composite branches as duplicate', () => {
    const schema = {
      type: 'object',
      allOf: [
        { properties: { a: { type: 'string', 'x-mcp-header': 'Dup' } } },
        { properties: { b: { type: 'string', 'x-mcp-header': 'Dup' } } },
      ],
    }
    const result = collectHeaderAnnotations(schema)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('Duplicate'))).toBe(true)
  })

  test('errors on an annotation inside array items', () => {
    const schema = {
      type: 'object',
      properties: {
        tags: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string', 'x-mcp-header': 'Id' } } },
        },
      },
    }
    const result = collectHeaderAnnotations(schema)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('array items'))).toBe(true)
  })

  test('errors on an annotation inside prefixItems', () => {
    const schema = {
      type: 'object',
      properties: {
        pair: {
          type: 'array',
          prefixItems: [{ type: 'object', properties: { k: { type: 'string', 'x-mcp-header': 'K' } } }],
        },
      },
    }
    const result = collectHeaderAnnotations(schema)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('array items'))).toBe(true)
  })

  test('errors (no hang) on a circular $ref', () => {
    const schema = {
      type: 'object',
      properties: { self: { $ref: '#/$defs/Node' } },
      $defs: { Node: { type: 'object', properties: { next: { $ref: '#/$defs/Node' } } } },
    }
    const result = collectHeaderAnnotations(schema)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('Circular'))).toBe(true)
  })

  test('errors on an unresolved $ref', () => {
    const schema = { type: 'object', properties: { x: { $ref: '#/$defs/Missing' } } }
    const result = collectHeaderAnnotations(schema)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('Unresolved'))).toBe(true)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk proxy pnpm --filter @mokei/http-client run test:unit x-mcp-header`
Expected: FAIL — the `$ref` / composite / array-items / circular / unresolved cases all fail (current walk only descends `properties`, so it silently collects nothing and reports `valid: true` with no errors).

- [ ] **Step 3: Rewrite the walk**

Replace the doc comment + `collectHeaderAnnotations` in `packages/http-client/src/x-mcp-header.ts` (lines 110-162) with:

```ts
/** Decode a single JSON Pointer reference token (`~1` → `/`, `~0` → `~`). */
function decodePointerToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~')
}

/**
 * Resolve a local JSON Pointer `$ref` (e.g. `#/$defs/Region`) against the schema root.
 * Returns `undefined` for non-local refs or pointers that do not resolve.
 */
function resolveLocalRef(root: unknown, ref: string): unknown {
  if (!ref.startsWith('#/')) {
    return undefined
  }
  const tokens = ref.slice(2).split('/').map(decodePointerToken)
  let node: unknown = root
  for (const token of tokens) {
    if (node == null || typeof node !== 'object') {
      return undefined
    }
    node = (node as Record<string, unknown>)[token]
  }
  return node
}

/**
 * Walk a tool `inputSchema` and collect every `x-mcp-header` annotation, validating the
 * SEP-2243 constraints: header names must be valid tokens, case-insensitively unique
 * within the schema, and may annotate only primitive (boolean/integer/string, optionally
 * nullable) types.
 *
 * Traverses nested object `properties`, local `$ref` targets (`#/$defs/*`,
 * `#/definitions/*`, with circular-ref detection), and the `allOf`/`anyOf`/`oneOf`
 * composition keywords (branches share the parent's argument path). An `x-mcp-header`
 * found inside array element schemas (`items` / `prefixItems`) is an ERROR — a scalar
 * header cannot carry a multi-element array value — rather than a silent miss. The
 * argument-path model stays a flat `Array<string>` of object-property keys.
 */
export function collectHeaderAnnotations(inputSchema: unknown): CollectResult {
  const annotations: Array<HeaderAnnotation> = []
  const errors: Array<string> = []
  const seen = new Set<string>()
  const root = inputSchema

  const walk = (
    schema: unknown,
    path: Array<string>,
    refStack: Set<string>,
    inArray: boolean,
  ): void => {
    if (schema == null || typeof schema !== 'object') {
      return
    }
    const node = schema as Record<string, unknown>
    const here = path.join('.') || '<root>'

    // $ref: resolve against root, guard cycles, continue at the same path.
    // 2020-12 allows sibling keywords next to $ref, so we still walk the rest of this node.
    const ref = node['$ref']
    if (typeof ref === 'string') {
      if (refStack.has(ref)) {
        errors.push(`Circular $ref "${ref}" at ${here}`)
      } else {
        const target = resolveLocalRef(root, ref)
        if (target === undefined) {
          errors.push(`Unresolved $ref "${ref}" at ${here}`)
        } else {
          walk(target, path, new Set(refStack).add(ref), inArray)
        }
      }
    }

    // Composition: descend each branch at the same object level / path.
    for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
      const branches = node[key]
      if (Array.isArray(branches)) {
        for (const branch of branches) {
          walk(branch, path, refStack, inArray)
        }
      }
    }

    // Array element schemas: descend in error-detect mode (inArray = true).
    for (const key of ['prefixItems', 'items'] as const) {
      const sub = node[key]
      if (Array.isArray(sub)) {
        for (const entry of sub) {
          walk(entry, path, refStack, true)
        }
      } else if (sub != null && typeof sub === 'object') {
        walk(sub, path, refStack, true)
      }
    }

    // Object properties.
    const properties = node['properties']
    if (properties == null || typeof properties !== 'object') {
      return
    }
    for (const [key, rawChild] of Object.entries(properties as Record<string, unknown>)) {
      if (rawChild == null || typeof rawChild !== 'object') {
        continue
      }
      const child = rawChild as Record<string, unknown>
      const childPath = [...path, key]
      const annotation = child['x-mcp-header']
      if (annotation !== undefined) {
        const at = childPath.join('.')
        if (inArray) {
          errors.push(`x-mcp-header at ${at} cannot be inside array items (scalar header)`)
        } else if (typeof annotation !== 'string' || !isValidHeaderParamName(annotation)) {
          errors.push(`Invalid x-mcp-header name at ${at}`)
        } else if (seen.has(annotation.toLowerCase())) {
          errors.push(`Duplicate x-mcp-header "${annotation}" at ${at}`)
        } else if (!isEligibleType(child.type)) {
          errors.push(`x-mcp-header "${annotation}" at ${at} must annotate boolean/integer/string`)
        } else {
          seen.add(annotation.toLowerCase())
          annotations.push({ headerName: annotation, path: childPath })
        }
      }
      walk(child, childPath, refStack, inArray)
    }
  }

  walk(inputSchema, [], new Set<string>(), false)
  const valid = errors.length === 0
  return { annotations: valid ? annotations : [], valid, errors }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk proxy pnpm --filter @mokei/http-client run test:unit x-mcp-header`
Expected: PASS — all new cases plus every pre-existing `collectHeaderAnnotations` case (nested object properties, invalid name, duplicate, non-primitive type) still green.

- [ ] **Step 5: Commit**

```bash
git add packages/http-client/src/x-mcp-header.ts packages/http-client/test/x-mcp-header.test.ts
git commit -m "feat(http-client): deepen x-mcp-header walk to \$ref + composites, error on array items (G7)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: G5 inbound — file the enkaku upstream ask (no enkaku commit)

**Files:**
- Create: `/Users/paul/dev/yulsi/enkaku/docs/agents/plans/backlog/2026-06-20-mokei-g5-inbound-otel.md`

**Interfaces:**
- Consumes: nothing in mokei.
- Produces: a request document only. The mokei-side `context-server` wiring (new `trace.ts` + `_handleRequest` wrap) is deferred to a follow-up once enkaku releases the helper — it cannot build or test against APIs that do not yet exist.

- [ ] **Step 1: Write the request file**

Create `/Users/paul/dev/yulsi/enkaku/docs/agents/plans/backlog/2026-06-20-mokei-g5-inbound-otel.md`:

```markdown
# Upstream ask for mokei G5 inbound: W3C trace-context extraction + baggage activation

**Status:** requested
**Date:** 2026-06-20
**Package:** `@enkaku/otel`
**Origin:** mokei MCP draft-migration, item **G5 inbound** (server-side W3C trace
propagation). Outbound already ships: mokei's `context-client` injects SEP-414
`traceparent` / `tracestate` / `baggage` into request `_meta` using
`formatTraceparent` / `formatBaggage`. The server side cannot reciprocate with the
current API.

## Problem

`@enkaku/otel` exposes `extractTraceContext(header)`, but it reads Enkaku's own
`header.tid` / `header.sid` token fields — **not** the W3C `traceparent` mokei emits.
There is no W3C → `Context` builder, and no way to activate inbound baggage
(`getActiveBaggage` is read-only; no setter is exported). A mokei server therefore
cannot run a request handler under the client's trace/baggage without importing
`@opentelemetry/api` directly, which we want to avoid in `@mokei/context-server`.

## Asks

### 1. `extractW3CTraceContext(meta: Record<string, unknown>): Context | undefined`

Mirror the existing `extractTraceContext`, but for the W3C trio:

- Parse `meta.traceparent` via the existing `parseTraceparent`; if absent/invalid,
  return `undefined`.
- Parse `meta.tracestate` via the existing `parseTracestate` (optional).
- Build a remote `SpanContext` (`isRemote: true`) from the parsed
  `traceID` / `spanID` / `traceFlags`, attach any tracestate, and return the OTel
  `Context` (same `trace.setSpanContext(ROOT_CONTEXT, …)` shape the `tid`/`sid`
  variant already uses).

Returns `undefined` when no valid `traceparent` is present, so callers pay nothing
when tracing is off. Pairs with the existing `withActiveContext(ctx, fn)` for
activation.

### 2. `withActiveBaggage<T>(entries: Array<BaggageEntry>, fn: () => T): T`

Activate parsed `baggage` entries (from the existing `parseBaggage`) so a handler's
`getActiveBaggage()` reflects the client's baggage. Symmetric with the existing
read-only `getActiveBaggage`. (Naming/shape at enkaku's discretion — mokei only needs
"activate these entries for the duration of `fn`".)

## Consumer follow-on (mokei, separate repo)

Once released: add `@enkaku/otel` to `@mokei/context-server`, add
`src/trace.ts` with `activeContextFromMeta(meta) → extractW3CTraceContext(meta)`, and
wrap the `_handleRequest` dispatch once with `withActiveContext` (+ `withActiveBaggage`
when present). One wrap covers tools / prompts / resources.

## Notes

- Self-contained within `@enkaku/otel`; all parsing primitives
  (`parseTraceparent` / `parseTracestate` / `parseBaggage`) already exist.
- No mokei-side blocker beyond this release.
```

- [ ] **Step 2: Verify the file exists and is NOT staged in enkaku**

Run: `ls /Users/paul/dev/yulsi/enkaku/docs/agents/plans/backlog/2026-06-20-mokei-g5-inbound-otel.md && git -C /Users/paul/dev/yulsi/enkaku status --short`
Expected: the path prints; `git status` shows the file as untracked (`??`). Do NOT `git add` or commit it in the enkaku repo.

- [ ] **Step 3: No commit**

This task produces no mokei git change. Nothing to commit here.

---

### Task 4: Update planning docs + final verification

**Files:**
- Modify: `docs/agents/plans/backlog/2026-06-09-mcp-draft-deferred-groundwork.md`
- Modify: `docs/agents/plans/milestones/2026-06-08-mcp-draft-migration.md` (the "Deferred groundwork (follow-up)" section near line 124)
- Modify: `docs/agents/plans/roadmap.md:105-107` (the deferred-groundwork backlog bullet)

**Interfaces:**
- Consumes: the shipped state from Tasks 1-3.
- Produces: docs reflecting G8 strict + G7 walk shipped; G5 inbound blocked-on-enkaku-ask (filed); G7 part 5 still deferred.

- [ ] **Step 1: Update the backlog doc**

In `docs/agents/plans/backlog/2026-06-09-mcp-draft-deferred-groundwork.md`, move **G8 strict-mode** and **G7 walk depth** into the "Shipped" section, and rewrite the **G5 inbound** bullet under "Remaining gap" to:

```markdown
- **G5 inbound** — server-side extraction blocked on enkaku: needs a W3C
  `traceparent` → OTel `Context` builder. enkaku's `extractTraceContext` reads
  `tid`/`sid`, not W3C. Upstream ask filed 2026-06-20 (`extractW3CTraceContext` +
  `withActiveBaggage`, `../enkaku/docs/agents/plans/backlog/2026-06-20-mokei-g5-inbound-otel.md`).
  `context-server` wiring lands once it releases.
```

Leave only **G7 part 5** as the remaining self-contained gap.

- [ ] **Step 2: Update the milestone doc**

In `docs/agents/plans/milestones/2026-06-08-mcp-draft-migration.md`, in the "Deferred groundwork (follow-up)" section, mark G8 strict + G7 walk depth as shipped, and note the G5 inbound enkaku asks (`extractW3CTraceContext`, `withActiveBaggage`) added to the Upstream (Enkaku) dependencies list.

- [ ] **Step 3: Update the roadmap**

In `docs/agents/plans/roadmap.md`, update the "MCP draft — deferred groundwork" bullet (lines 105-107) to read:

```markdown
- **MCP draft — deferred groundwork** (`backlog/2026-06-09-mcp-draft-deferred-groundwork.md`) —
  G8 + G5 outbound/baggage + **G8 strict-mode + G7 walk depth** shipped. Remaining:
  G5 inbound (enkaku ask filed 2026-06-20: `extractW3CTraceContext` + `withActiveBaggage`),
  G7 part 5 retry.
```

- [ ] **Step 4: Full lint + type-check + test**

Run: `rtk proxy pnpm run lint && pnpm build && rtk proxy pnpm test`
Expected: lint clean, build green, all tests pass (note: cross-package tests resolve built `lib/`, so the preceding `pnpm build` matters).

- [ ] **Step 5: Commit**

```bash
git add docs/agents/plans/
git commit -m "docs: G8 strict + G7 walk shipped; G5 inbound enkaku ask filed

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- G8 strict (decision: `strict:false`, tool/prompt only) → Task 1. ✓
- G7 walk depth (decision: Option A — `$ref` + composites, error on array items, flat path) → Task 2. ✓
- G5 inbound (decision: upstream ask, baggage deferred, file only / no enkaku commit) → Task 3. ✓
- G7 part 5 → explicitly deferred in spec; no task (correct). ✓
- Docs sync → Task 4. ✓

**Placeholder scan:** No TBD/TODO; every code + test step shows full content; commands have expected output. ✓

**Type consistency:** `collectHeaderAnnotations` / `CollectResult` / `HeaderAnnotation` signatures unchanged across Task 2; `createValidator` options object matches `ValidatorOptions = { draft?; strict? }`; `activeContextFromMeta` referenced only in deferred-wiring prose, not as an implemented type. ✓
