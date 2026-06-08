# MCP Draft Phase 0 + Upstream Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the non-breaking MCP-draft groundwork that can ship on the current `2025-11-25` baseline, and run the upstream (Enkaku) investigations that gate the rest, without touching the breaking architecture.

**Architecture:** Two parts. **Part A — Upstream checks (U1/U2/U3):** investigation/spike tasks that produce written findings and decisions; no production code. **Part B — Phase 0 groundwork (G1–G8):** additive, backward-compatible changes to `context-protocol` (schemas), `context-server` (population + ordering), and `http-client` (headers). Items blocked by upstream findings (G5 otel, G8 schema 2020-12) are explicitly deferred behind their checks.

**Tech Stack:** TypeScript, `@enkaku/schema` (AJV-backed JSON Schema), `@enkaku/transport` (`DirectTransports` for server tests), vitest. Tests live in each package's `test/` dir as `*.test.ts`. Run a single package's unit tests with `pnpm --filter <pkg> test:unit`.

**Source-of-truth references:** `docs/superpowers/specs/2026-06-08-mcp-draft-migration-design.md` (the gap analysis this plan implements — Phase 0 items G1–G8 and upstream items U1–U3).

---

## Important context for the implementer

- **Caveman chat mode is active** in this repo session for human-facing replies, but **all code, comments, and commit messages are written normally** (full English). Follow the repo's `AGENTS.md` guardrails: `type` not `interface`; `Array<T>` not `T[]`; no `any`; `ID`/`HTTP` casing; `pnpm` only; never edit generated files.
- **Schemas are plain objects** ending in `as const satisfies Schema`, with a paired `export type X = FromSchema<typeof x>`. Mirror the existing style exactly (see `packages/context-protocol/src/rpc.ts`).
- **Runtime validation is inbound-only.** `ContextRPC` validates incoming messages via `validateMessageIn`; outgoing results are typed but not re-validated. Adding *optional* fields to result schemas is therefore safe for both sides on `2025-11-25` (clients ignore unknown fields; servers may emit them).
- **`new Ajv()` in `@enkaku/schema` is draft-07** (confirmed in `@enkaku/schema@0.16.0/lib/validation.js`). This is why G8 is blocked (see Task 2).
- **Index re-exports are explicit and named** (`packages/context-protocol/src/index.ts`). Any new exported type must be added there. Schema-shape tests import directly from `../src/<file>.js`, so they don't depend on index.

---

# Part A — Upstream Enkaku Checks (do first)

These produce findings/decisions, not production code. Each writes its result into a findings doc so the breaking-phase plan can consume it.

## Task 1: Create the upstream findings document

**Files:**
- Create: `docs/superpowers/specs/2026-06-08-mcp-draft-upstream-findings.md`

- [ ] **Step 1: Create the findings doc skeleton**

```markdown
# MCP Draft — Upstream (Enkaku) Findings

Companion to `2026-06-08-mcp-draft-migration-design.md`. Records the resolution of
upstream items U1–U3 before the breaking migration phase.

## U2 — `@enkaku/schema` JSON Schema draft level
_(filled by Task 2)_

## U3 — `@enkaku/otel` availability & `_meta` mapping
_(filled by Task 3)_

## U1 — Transport model vs stateless + MRTR
_(filled by Task 4)_
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-06-08-mcp-draft-upstream-findings.md
git commit -m "docs: add MCP draft upstream findings doc skeleton"
```

## Task 2: U2 — Confirm `@enkaku/schema` JSON Schema draft level (gates G8)

**Files:**
- Read only: `node_modules/.pnpm/@enkaku+schema@0.16.0/node_modules/@enkaku/schema/lib/validation.js`
- Modify: `docs/superpowers/specs/2026-06-08-mcp-draft-upstream-findings.md`

- [ ] **Step 1: Probe the AJV draft level**

Write a throwaway probe to confirm whether the shared validator accepts a 2020-12-only construct. Run from the repo root:

```bash
node --input-type=module -e "
import { createValidator } from '@enkaku/schema'
// prefixItems is a 2020-12 keyword; under draft-07 AJV it is unknown and ignored,
// so a value violating it will INCORRECTLY validate.
const v = createValidator({ type: 'array', prefixItems: [{ type: 'string' }] })
const res = v([123]) // 123 is not a string -> should fail under 2020-12
console.log('result has issues:', res && typeof v === 'function' ? !!(res.issues ?? res.message) : 'n/a', JSON.stringify(res))
"
```

Expected: the value validates (no error) — demonstrating `prefixItems` is unknown/ignored, i.e. **draft-07**, not 2020-12.

- [ ] **Step 2: Record the finding under `## U2`**

Replace the `_(filled by Task 2)_` placeholder with:

```markdown
**Confirmed: draft-07.** `@enkaku/schema@0.16.0` constructs a single module-level
`new Ajv({ allErrors: true, useDefaults: false })` (the default `ajv` import = JSON
Schema draft-07) and exposes no per-call draft option. 2020-12 keywords
(`prefixItems`, `$dynamicRef`, `unevaluatedProperties`, etc.) are silently ignored.

**Impact:** Spec item **G8** (loosen `inputSchema`/`outputSchema` to arbitrary JSON
Schema 2020-12 keywords + `$ref` resolution) **cannot be implemented in mokei alone**.

**Upstream ask (Enkaku `@enkaku/schema`):** switch the validator to `Ajv2020`
(`import Ajv2020 from 'ajv/dist/2020'`) or allow `createValidator` to select the
draft / accept an AJV instance. Until then G8 stays deferred (Task 13).
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-08-mcp-draft-upstream-findings.md
git commit -m "docs: record U2 finding — enkaku/schema is draft-07, blocks G8"
```

## Task 3: U3 — `@enkaku/otel` availability & `_meta` mapping (gates G5)

**Files:**
- Modify: `docs/superpowers/specs/2026-06-08-mcp-draft-upstream-findings.md`

- [ ] **Step 1: Confirm dependency status**

Run:

```bash
grep -rn "@enkaku/otel" packages/*/package.json pnpm-workspace.yaml; echo "---store---"; ls node_modules/.pnpm | grep -i "enkaku.otel"
```

Expected: no `@enkaku/otel` entry in any `package.json` (not a current dependency); `@enkaku+otel@0.16.0` present in the pnpm store (catalog-resolvable).

- [ ] **Step 2: Inventory the trace-context API surface**

Run:

```bash
D=node_modules/.pnpm/@enkaku+otel@0.16.0/node_modules/@enkaku/otel
grep -rn "export " "$D/lib" | grep -iE "traceparent|tracestate|baggage|inject|extract|format" | head -40
```

Record which helpers exist for formatting/parsing `traceparent`/`tracestate`/`baggage`.

- [ ] **Step 3: Record the finding under `## U3`**

Replace the placeholder with: dependency status (not currently a dep; available at `0.16.0`), the relevant exported helpers found, and the decision:

```markdown
**Decision:** G5 (OTel `_meta` keys) requires ADDING `@enkaku/otel` as a dependency of
the package that builds outgoing requests (`context-client` / `context-rpc`) — it is not
wired today. Injection point: `_meta` of outgoing requests. Implement in Task 12 only if
the helpers above cover `traceparent`/`tracestate`/`baggage`; otherwise note the gap and
keep G5 deferred.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-08-mcp-draft-upstream-findings.md
git commit -m "docs: record U3 finding — enkaku/otel not a dep; G5 needs it added"
```

## Task 4: U1 — Document transport-model gap for stateless + MRTR (blocks breaking phase, not Phase 0)

**Files:**
- Modify: `docs/superpowers/specs/2026-06-08-mcp-draft-upstream-findings.md`

This is an analysis writeup, not code. It does not block Phase 0 groundwork; it blocks the later breaking phase (B4, B7) and should start in parallel.

- [ ] **Step 1: Re-read the current RPC/transport contract**

Read `packages/context-rpc/src/rpc.ts` (the symmetric duplex model: `request()`, `#sentRequests` correlation, `_handle()` read loop) and confirm how `@enkaku/transport`'s `TransportType<In, Out>` is consumed (`_read()`/`_write()`).

- [ ] **Step 2: Answer the gap questions in writing under `## U1`**

Replace the placeholder with answers to:

```markdown
1. Can `@enkaku/transport`'s duplex `TransportType<In,Out>` model:
   (a) request-scoped response streams (notifications flow on the originating
       request's response stream), and
   (b) a single opt-in `subscriptions/listen` long-poll stream,
   without a persistent server→client channel? — Yes/No + why.
2. MRTR continuation: server returns `inputRequests` in a result instead of calling
   `request()`. Where does the continuation state live, and how does the current
   `#sentRequests` correlation need to change (or be removed) for the server side?
3. Recommendation: extend `@enkaku/transport` with a new contract, add a new transport
   shape, or reimplement correlation in `context-rpc` above the existing transport?
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-08-mcp-draft-upstream-findings.md
git commit -m "docs: record U1 finding — transport model gap for stateless+MRTR"
```

---

# Part B — Phase 0 Groundwork (non-breaking, ships on 2025-11-25)

Independent tasks. Suggested order: Task 5 (G3 guard) → 6 (G6 order) → 7 (G4 extensions) → 8/9 (G1 cache fields) → 10 (G2 headers) → 11 (G7 spike) → 12 (G5, gated on Task 3) → 13 (G8, deferred behind Task 2).

## Task 5: G3 — Resource-not-found error code (verification + regression guard)

**Context:** The draft changes resource-not-found from `-32002` to `-32602`. **mokei core never raises `-32002`** — `resources/read` delegates to user handlers (`context-server/src/server.ts:217-221`), and the only built-in not-found errors (tool/prompt) already use `INVALID_PARAMS` (`-32602`). So there is **no code change**; this task confirms that and adds a regression guard.

**Files:**
- Test: `packages/context-server/test/lib.test.ts`
- Modify: `docs/superpowers/specs/2026-06-08-mcp-draft-migration-design.md` (annotate G3)

- [ ] **Step 1: Confirm no `-32002` exists**

Run:

```bash
grep -rn "32002" packages/
```

Expected: no matches.

- [ ] **Step 2: Add a regression-guard test for unknown-tool error code**

In `packages/context-server/test/lib.test.ts`, using the existing `expectServerResponse` helper (see top of that file), add:

```ts
describe('Error codes (MCP draft alignment)', () => {
  test('unknown tool returns INVALID_PARAMS (-32602)', async () => {
    const { transports } = createTestContext({
      tools: { known: createTool({ description: 'x', inputSchema: { type: 'object' } }, async () => ({ content: [] })) },
    })
    transports.client.write({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'missing' } } as ClientRequest)
    const res = await transports.client.read()
    expect(res.value).toMatchObject({ id: 1, error: { code: INVALID_PARAMS } })
    await transports.dispose()
  })
})
```

> If `createTool`'s signature differs, match the existing usage already present in this test file (it is imported there). Keep the assertion on `error.code === INVALID_PARAMS`.

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @mokei/context-server test:unit`
Expected: PASS (the behavior already holds; this locks it in).

- [ ] **Step 4: Annotate the spec**

In the migration spec's G3 row, append: `Verified: mokei core raises no -32002; no code change. Regression guard added. Guidance: resource handlers should use -32602 for not-found.`

- [ ] **Step 5: Commit**

```bash
git add packages/context-server/test/lib.test.ts docs/superpowers/specs/2026-06-08-mcp-draft-migration-design.md
git commit -m "test: guard unknown-tool error code (-32602); confirm no -32002 (G3)"
```

## Task 6: G6 — Deterministic `tools/list` and `prompts/list` ordering

**Context:** Draft: servers SHOULD return tools in deterministic order. The server builds `#toolsList`/`#promptsList` from object entries in the constructor (`context-server/src/server.ts:123-141`). Sort both by `name` once at construction.

**Files:**
- Modify: `packages/context-server/src/server.ts`
- Test: `packages/context-server/test/lib.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/context-server/test/lib.test.ts`:

```ts
describe('Deterministic list ordering (G6)', () => {
  test('tools/list returns tools sorted by name', async () => {
    const noop = async () => ({ content: [] })
    const { transports } = createTestContext({
      tools: {
        charlie: createTool({ description: 'c', inputSchema: { type: 'object' } }, noop),
        alpha: createTool({ description: 'a', inputSchema: { type: 'object' } }, noop),
        bravo: createTool({ description: 'b', inputSchema: { type: 'object' } }, noop),
      },
    })
    transports.client.write({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} } as ClientRequest)
    const res = await transports.client.read()
    const names = (res.value as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name)
    expect(names).toEqual(['alpha', 'bravo', 'charlie'])
    await transports.dispose()
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @mokei/context-server test:unit`
Expected: FAIL — names are in insertion order `['charlie','alpha','bravo']`.

- [ ] **Step 3: Sort the lists at construction**

In `packages/context-server/src/server.ts`, immediately after the tools loop (currently ends near line 141, before the `if (this.#toolsList.length !== 0)` block) and after the prompts loop (near line 127), add sorts. Concretely, change the prompts block to:

```ts
    for (const [name, prompt] of Object.entries(params.prompts ?? {})) {
      const { handler, ...info } = prompt
      this.#promptHandlers[name] = handler
      this.#promptsList.push({ name, ...info })
    }
    this.#promptsList.sort((a, b) => a.name.localeCompare(b.name))
    if (this.#promptsList.length !== 0) {
      this.#capabilities.prompts = {}
    }
```

and the tools block to:

```ts
    for (const [name, tool] of Object.entries(params.tools ?? {})) {
      const { handler, ...info } = tool
      this.#toolHandlers[name] = handler
      this.#toolsList.push({ name, ...info })
    }
    this.#toolsList.sort((a, b) => a.name.localeCompare(b.name))
    if (this.#toolsList.length !== 0) {
      this.#capabilities.tools = {}
    }
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @mokei/context-server test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/context-server/src/server.ts packages/context-server/test/lib.test.ts
git commit -m "feat: deterministic tools/list and prompts/list ordering (G6)"
```

## Task 7: G4 — Add `extensions` field to client and server capabilities

**Context:** Draft adds an `extensions` field to `ClientCapabilities` and `ServerCapabilities`. Mirror the existing `experimental`/`experimentalCapabilities` pattern in `packages/context-protocol/src/initialize.ts`.

**Files:**
- Modify: `packages/context-protocol/src/initialize.ts`
- Test: `packages/context-protocol/test/lib.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/context-protocol/test/lib.test.ts` (import `clientCapabilities`, `serverCapabilities` from `../src/initialize.js` at the top alongside existing imports):

```ts
describe('Extensions capability (G4)', () => {
  test('client and server capabilities expose an extensions object', async () => {
    expect(clientCapabilities.properties.extensions).toBeDefined()
    expect(clientCapabilities.properties.extensions.type).toBe('object')
    expect(serverCapabilities.properties.extensions).toBeDefined()
    expect(serverCapabilities.properties.extensions.type).toBe('object')
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @mokei/context-protocol test:unit`
Expected: FAIL — `extensions` undefined.

- [ ] **Step 3: Add the schema and fields**

In `packages/context-protocol/src/initialize.ts`, after `experimentalCapabilities` (ends line 13), add:

```ts
export const extensionsCapabilities = {
  additionalProperties: {
    additionalProperties: true,
    properties: {},
    type: 'object',
  },
  description: 'Optional extensions beyond the core protocol that this party supports.',
  type: 'object',
} as const satisfies Schema
```

Add `extensions: extensionsCapabilities,` to the `properties` of both `clientCapabilities` (after `experimental: experimentalCapabilities,`, line 26) and `serverCapabilities` (after `experimental: experimentalCapabilities,`, line 67).

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @mokei/context-protocol test:unit`
Expected: PASS.

- [ ] **Step 5: Verify types build**

Run: `pnpm --filter @mokei/context-protocol test:types`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/context-protocol/src/initialize.ts packages/context-protocol/test/lib.test.ts
git commit -m "feat: add extensions field to client/server capabilities (G4)"
```

## Task 8: G1 (schema) — Add `CacheableResult` fields to list/read result schemas

**Context:** Draft adds `ttlMs` (number, freshness hint) and `cacheScope` (`"public"|"private"`) to results of `tools/list`, `prompts/list`, `resources/list`, `resources/read`, `resources/templates/list`. For Phase 0 they are **optional** additive fields. Define a shared `cacheableResult` fragment in `rpc.ts` and add it to each result schema's `allOf`.

**Files:**
- Modify: `packages/context-protocol/src/rpc.ts`
- Modify: `packages/context-protocol/src/tool.ts`, `prompt.ts`, `resource.ts`
- Modify: `packages/context-protocol/src/index.ts`
- Test: `packages/context-protocol/test/lib.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/context-protocol/test/lib.test.ts` (import `cacheableResult` from `../src/rpc.js`, and `listToolsResult` is already imported via `../src/tool.js`):

```ts
describe('Cacheable results (G1)', () => {
  test('cacheableResult defines ttlMs and cacheScope', async () => {
    expect(cacheableResult.properties.ttlMs.type).toBe('number')
    expect(cacheableResult.properties.cacheScope.enum).toEqual(['public', 'private'])
  })

  test('listToolsResult composes cacheableResult', async () => {
    // allOf includes the cacheable fragment
    const fragments = listToolsResult.allOf
    const hasCache = fragments.some(
      (f) => 'properties' in f && (f as { properties?: Record<string, unknown> }).properties?.ttlMs,
    )
    expect(hasCache).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @mokei/context-protocol test:unit`
Expected: FAIL — `cacheableResult` not exported.

- [ ] **Step 3: Add the `cacheableResult` fragment**

In `packages/context-protocol/src/rpc.ts`, after the `paginatedResult` block (ends line 222), add:

```ts
// CacheableResult — MCP draft caching hints (additive on 2025-11-25).
export const cacheableResult = {
  properties: {
    cacheScope: {
      description:
        'Controls whether shared intermediaries may cache the response. "public" allows shared caching; "private" restricts it to the requesting client.',
      enum: ['public', 'private'],
      type: 'string',
    },
    ttlMs: {
      description:
        'Freshness hint in milliseconds. Allows clients to cache the response and reduce polling. Complements listChanged notifications.',
      type: 'number',
    },
  },
  type: 'object',
} as const satisfies Schema
export type CacheableResult = FromSchema<typeof cacheableResult>
```

- [ ] **Step 4: Compose it into the five result schemas**

In `packages/context-protocol/src/tool.ts`, add `cacheableResult` to the imports from `./rpc.js` (line 4-12 block) and add it to `listToolsResult.allOf` (currently `[paginatedResult, {...}]`, line 215):

```ts
  allOf: [
    paginatedResult,
    cacheableResult,
    {
      properties: {
        tools: {
          items: tool,
          type: 'array',
        },
      },
      required: ['tools'],
      type: 'object',
    },
  ],
```

Apply the same pattern (add `cacheableResult` to imports and into the `allOf` array) in:
- `packages/context-protocol/src/prompt.ts` → `listPromptsResult`
- `packages/context-protocol/src/resource.ts` → `listResourcesResult`, `listResourceTemplatesResult`, and `readResourceResult`

> For `readResourceResult` the base is `result` (not `paginatedResult`); insert `cacheableResult` as the second element of its `allOf`, leaving the existing base first.

- [ ] **Step 5: Export the new type from index**

In `packages/context-protocol/src/index.ts`, add `type CacheableResult,` to the named exports from `./rpc.js` (the block around lines 65-84, alongside `type Result`).

- [ ] **Step 6: Run unit + type tests**

Run: `pnpm --filter @mokei/context-protocol test:unit && pnpm --filter @mokei/context-protocol test:types`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/context-protocol/src
git commit -m "feat: add CacheableResult (ttlMs, cacheScope) to list/read results (G1 schema)"
```

## Task 9: G1 (server) — Populate cache hints on `tools/list` and `prompts/list`

**Context:** Let server authors set default cache hints, emitted on the server-built list responses. `resources/*` results come from user handlers, so those handlers populate their own (documented, not auto-injected).

**Files:**
- Modify: `packages/context-server/src/server.ts`
- Test: `packages/context-server/test/lib.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/context-server/test/lib.test.ts`:

```ts
describe('Cache hints on lists (G1 server)', () => {
  test('tools/list includes configured ttlMs and cacheScope', async () => {
    const { transports } = createTestContext({
      cache: { ttlMs: 60000, cacheScope: 'public' },
      tools: { a: createTool({ description: 'a', inputSchema: { type: 'object' } }, async () => ({ content: [] })) },
    })
    transports.client.write({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} } as ClientRequest)
    const res = await transports.client.read()
    expect(res.value).toMatchObject({ result: { ttlMs: 60000, cacheScope: 'public' } })
    await transports.dispose()
  })
})
```

> If `createTestContext`'s `TestContextParams` type rejects the `cache` key, that is expected before Step 3 — it is part of the failing state.

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @mokei/context-server test:unit`
Expected: FAIL — no `ttlMs`/`cacheScope` on the result (and/or a type error on `cache`).

- [ ] **Step 3: Add the `cache` config and emit it**

In `packages/context-server/src/server.ts`:

Add the type to `ServerConfig` (after `version: string`, line 67-73 block):

```ts
export type CacheHints = {
  ttlMs?: number
  cacheScope?: 'public' | 'private'
}

export type ServerConfig = {
  name: string
  version: string
  cache?: CacheHints
  complete?: CompleteHandler
  prompts?: PromptDefinitions
  resources?: ResourceDefinitions
  tools?: ToolDefinitions
}
```

Add a private field and assign it in the constructor (near `#serverInfo`):

```ts
  #cache?: CacheHints
```

```ts
    this.#cache = params.cache
```

Update the two server-built list responses in `_handleRequest` (lines 210-211 and 233-234):

```ts
      case 'prompts/list':
        return { prompts: this.#promptsList, ...this.#cache }
```

```ts
      case 'tools/list':
        return { tools: this.#toolsList, ...this.#cache }
```

- [ ] **Step 4: Run unit + type tests**

Run: `pnpm --filter @mokei/context-server test:unit && pnpm --filter @mokei/context-server test:types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/context-server/src/server.ts packages/context-server/test/lib.test.ts
git commit -m "feat: emit configured cache hints on tools/list and prompts/list (G1 server)"
```

## Task 10: G2 — Send `Mcp-Method` and `Mcp-Name` headers on HTTP POST

**Context:** Draft requires `Mcp-Method` and `Mcp-Name` on Streamable HTTP POST. Additive on `2025-11-25` (servers ignore unknown headers). Derive `Mcp-Method` from the message method and `Mcp-Name` from `params.name` when present (tools/call, prompts/get). Add in `#sendMessage` (`packages/http-client/src/transport.ts:89-94`).

**Files:**
- Modify: `packages/http-client/src/transport.ts`
- Test: `packages/http-client/test/transport.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/http-client/test/transport.test.ts` (inside the existing `describe('HTTPTransport', ...)`, using the established `fetchMock`/`getCallByMethod` helpers and `jsonResponse`):

```ts
  test('POST includes Mcp-Method and Mcp-Name headers (G2)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', id: 1, result: { content: [] } }))
    const transport = new HTTPTransport({ url: TEST_URL })
    await transport.write({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search' } } as ClientMessage)
    const [, init] = getCallByMethod(fetchMock.mock.calls, 'POST')
    expect(init.headers['Mcp-Method']).toBe('tools/call')
    expect(init.headers['Mcp-Name']).toBe('search')
    await transport.dispose()
  })
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @mokei/http-client test:unit`
Expected: FAIL — headers undefined.

- [ ] **Step 3: Set the headers in `#sendMessage`**

In `packages/http-client/src/transport.ts`, after the base `headers` object is built (after line 94, before the `if (this.#sessionID)` block):

```ts
    if ('method' in message && typeof message.method === 'string') {
      headers['Mcp-Method'] = message.method
      const name = (message as { params?: { name?: unknown } }).params?.name
      if (typeof name === 'string') {
        headers['Mcp-Name'] = name
      }
    }
```

- [ ] **Step 4: Run unit + type tests**

Run: `pnpm --filter @mokei/http-client test:unit && pnpm --filter @mokei/http-client test:types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/http-client/src/transport.ts packages/http-client/test/transport.test.ts
git commit -m "feat: send Mcp-Method and Mcp-Name headers on HTTP POST (G2)"
```

## Task 11: G7 — `x-mcp-header` custom headers from tool params (spike, then decide)

**Context:** SEP-2243 also adds custom headers from tool parameters via `x-mcp-header`. Exact semantics (which params map to which headers, naming) are **not yet pinned in this plan** and must be read from the SEP before implementing — do not invent the mapping.

**Files:**
- Modify: `docs/superpowers/specs/2026-06-08-mcp-draft-upstream-findings.md` (or a short note appended to the migration spec's G7 row)

- [ ] **Step 1: Read SEP-2243**

Read https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2243 and extract the exact `x-mcp-header` rules: source of the header values, naming convention, and whether it applies client- or server-side.

- [ ] **Step 2: Record a mini-spec**

Append to the findings doc a precise description of the mapping and the concrete `transport.ts` change it implies (a follow-up code task, deferred until the draft semantics are stable).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-08-mcp-draft-upstream-findings.md
git commit -m "docs: spike x-mcp-header semantics from SEP-2243 (G7)"
```

## Task 12: G5 — OTel trace context in request `_meta` (gated on Task 3)

**Context:** Add `traceparent`/`tracestate`/`baggage` to outgoing request `_meta`. **Only start if Task 3 confirmed `@enkaku/otel` exposes the needed helpers.** This requires adding `@enkaku/otel` as a dependency and choosing an injection point in the request path (`context-rpc`/`context-client`).

**Files:**
- Modify: dependency manifest of the package that builds outgoing requests (`packages/context-client/package.json` or `packages/context-rpc/package.json`) — `@enkaku/otel` at the catalog version
- Modify: the request-building path (decided in Step 1)
- Test: the corresponding package `test/`

- [ ] **Step 1: Decide injection point and confirm API**

Re-read the Task 3 findings. Identify where every outgoing **request** is constructed (`ContextRPC.request()` in `packages/context-rpc/src/rpc.ts:201-228` writes `{ jsonrpc, id, method, params }`). Decide whether to inject `_meta` there (covers client + server requests) or at the `context-client` layer. Confirm the exact `@enkaku/otel` helper names from Step 2 of Task 3.

- [ ] **Step 2: STOP and write the concrete sub-plan**

Because the injection point and OTel API are only resolved at this step, write the exact failing test + implementation as a short addendum to this plan (new `### Task 12a` block with real code), then implement it. Do not write speculative code before the API is confirmed.

> Rationale: this task is intentionally a spike-then-implement. G5 is OPT (nice-to-have); if Task 3 found the helpers insufficient, record the gap and keep G5 deferred rather than guessing.

## Task 13: G8 — Loosen `inputSchema`/`outputSchema` to JSON Schema 2020-12 (DEFERRED — blocked by Task 2)

**Context:** Per Task 2 (U2), `@enkaku/schema` validates against **draft-07**, so 2020-12 keywords and proper `$ref` resolution are not honored. G8 **cannot** be implemented in mokei until the upstream `@enkaku/schema` change lands.

**Files:** none (no code this phase).

- [ ] **Step 1: Confirm the blocker is recorded**

Verify the U2 finding and the upstream ask are present in `docs/superpowers/specs/2026-06-08-mcp-draft-upstream-findings.md`.

- [ ] **Step 2: Annotate the migration spec**

In the migration spec's G8 row, append: `DEFERRED — blocked by U2 (enkaku/schema is draft-07). Implement after upstream switches to Ajv2020.`

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-08-mcp-draft-migration-design.md
git commit -m "docs: mark G8 deferred pending enkaku/schema 2020-12 support"
```

---

## Definition of Done (Phase 0)

- Upstream findings doc records U1, U2, U3 with decisions.
- Shipped on `2025-11-25` with all package unit + type tests green: G3 guard, G6 ordering, G4 extensions field, G1 schema + server population, G2 headers.
- G7 spiked (semantics documented), G5 gated on U3 (implemented only if helpers suffice), G8 explicitly deferred behind U2.
- Full check before wrap-up: `pnpm test` and `pnpm lint` pass.
