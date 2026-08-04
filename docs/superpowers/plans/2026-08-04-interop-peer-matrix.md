# Interop Peer Matrix + Request-Header Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Stage:** reviewing
**Mode:** tasks
**Spec:** `docs/superpowers/specs/2026-08-03-interop-peer-matrix-design.md`
**Branch:** `feat/interop-peer-matrix`

**Goal:** Close the four-quadrant `2026-07-28` cross-stack peer matrix in the integration
suites, and put mokei's `Mcp-Param-*` header encoder in front of the official SDK's decoder for
the first time.

**Architecture:** Both direction files (`interop-sdk-client.test.ts`, `interop-sdk-server.test.ts`)
gain a revision table and a `describe.each` over it. The table carries only *how to connect* —
server path, HTTP starter, client factory. Assertions that exist on one revision and not the
other live in their own named `describe` block beside the shared one, never as table fields. The
shared expectation helpers (`checkMokeiClient`, `checkSDKClient`) gain one option each so a single
body serves both revisions and both fixtures.

**Tech Stack:** TypeScript, vitest (`describe.each`), `@mokei/context-client`,
`@mokei/http-client`, `@mokei/host`, `@modelcontextprotocol/{client,node,server}` `2.0.0`.

## Global Constraints

- **Tests and fixtures only.** No file under `packages/` is modified by this plan. If a task turns
  a defect up in production code, follow the red-test policy below.
- **Red-test policy** (from the spec): a defect fixable inside this test-scoped change is fixed on
  the branch. A defect needing protocol or transport surgery gets an entry in
  `docs/agents/plans/backlog/2026-06-20-mcp-draft-remaining.md`, and its test lands as
  `test.skip` carrying that entry's path in a comment.
- **No "era" vocabulary.** Assertions and comments name revisions by date (`'2026-07-28'`,
  `'2025-11-25'`). The SDK's `getProtocolEra()` (`'modern'` / `'legacy'`) is never used.
- **Commit per task.** Each task ends with its own commit (`test: …` or `docs: …`), so the review
  package for that task is a real `BASE..HEAD` diff. The user squashes at merge time. This
  overrides the standing single-final-commit preference for this branch, decided 2026-08-04.
- **Naming rules** (`AGENTS.md`): `type` not `interface`; `Array<T>` not `T[]`; no `any`; uppercase
  abbreviations (`URI`, `HTTP`, `SDK`).
- **Tooling:** `pnpm`, never `npm`/`npx`. Lint is `rtk proxy pnpm run lint` from the repo root —
  plain `pnpm lint` hits an `rtk` shim and fails with eslint-not-found.
- **Working directory** for every command below: `/Users/paul/dev/yulsi/mokei`.

---

## File Structure

| File | Change | Responsibility after the change |
|---|---|---|
| `integration-tests/support/interop/fixture.ts` | Modify | Adds the `headerEcho` tool (SDK fixture only), its schema, its rendering helper, and `SDK_TOOL_NAMES` |
| `integration-tests/support/interop/expectations.ts` | Modify | `checkMokeiClient` gains `toolNames`; `checkSDKClient` gains an options object with `protocolVersion` |
| `integration-tests/support/interop/servers.ts` | Modify | Adds `createSDKClient()` and `SDK_STDIO_SERVER_2026_07_28_PATH` |
| `integration-tests/support/interop/sdk-stdio-server-2026-07-28.ts` | Create | `serveStdio(factory, { legacy: 'reject' })` entry point |
| `integration-tests/suites/interop-sdk-client.test.ts` | Rewrite | SDK client → mokei server, both revisions × stdio + HTTP |
| `integration-tests/suites/interop-sdk-server.test.ts` | Rewrite | mokei client → SDK server, both revisions × stdio + HTTP, plus the `2026-07-28`-only block and the header cases |
| `integration-tests/suites/interop-2026-07-28-http.test.ts` | Modify | Loses its SDK `describe` block; becomes mokei ↔ mokei only |
| `docs/agents/plans/backlog/2026-06-20-mcp-draft-remaining.md` | Modify | G7 part 5 blockers corrected; §3.2.3 closed; §3.2.4 pruned |

---

### Task 1: `headerEcho` in the SDK fixture, and a `toolNames` option

The `x-mcp-header` tool goes in the SDK fixture alone, following the documented precedent of the
non-ASCII resource (see the header comment of `fixture.ts`): the annotated surface exists where a
peer enforces it. mokei's own suites keep asserting `['echo', 'sum']` unchanged.

**Files:**
- Modify: `integration-tests/support/interop/expectations.ts:19-57`
- Modify: `integration-tests/support/interop/fixture.ts` (exports near `SUM_OUTPUT_SCHEMA`, the
  `MOKEI_RESOURCE_URIS`/`SDK_RESOURCE_URIS` block, and `createSDKServer`)
- Modify: `integration-tests/suites/interop-sdk-server.test.ts:39,52`

**Interfaces:**
- Produces:
  - `SDK_TOOL_NAMES: ReadonlyArray<string>` — `['echo', 'headerEcho', 'sum']`, already sorted
  - `HEADER_ECHO_INPUT_SCHEMA` — the `x-mcp-header`-annotated schema
  - `headerEchoText(tenant: string | undefined, limit: number | undefined): string`
  - `CheckMokeiClientOptions.toolNames?: ReadonlyArray<string>`

- [ ] **Step 1: Add the `toolNames` option to `checkMokeiClient`**

In `integration-tests/support/interop/expectations.ts`, add to `CheckMokeiClientOptions` (after
the `resourceURIs` field, keeping its doc-comment style):

```ts
  /**
   * The exact set of tool names the server under test serves. Defaults to the mokei fixture's,
   * which is what three of the four call sites drive; the two that drive the SDK fixture pass
   * `SDK_TOOL_NAMES`, which also carries the `x-mcp-header`-annotated `headerEcho`.
   *
   * A parameter rather than a subset check, for the same reason `resourceURIs` is one: both sets
   * are exactly known, and "the list contains echo" would pass against a server serving anything
   * at all alongside it.
   */
  toolNames?: ReadonlyArray<string>
```

Add the import of `MOKEI_TOOL_NAMES` to the existing `./fixture.ts` import block, then replace the
body's tool-name assertion (currently line 57):

```ts
  const toolNames = options.toolNames ?? MOKEI_TOOL_NAMES
```

placed beside the existing `const resourceURIs = ...` line, and:

```ts
  const { tools } = await client.listTools()
  expect(tools.map((tool) => tool.name).sort()).toEqual([...toolNames].sort())
```

- [ ] **Step 2: Point the two SDK-server call sites at `SDK_TOOL_NAMES`**

In `integration-tests/suites/interop-sdk-server.test.ts`, add `SDK_TOOL_NAMES` to the
`../support/interop/fixture.ts` import, and change **both** `checkMokeiClient` calls (lines 39 and
52) to:

```ts
      await checkMokeiClient(context.client, {
        resourceURIs: SDK_RESOURCE_URIS,
        toolNames: SDK_TOOL_NAMES,
      })
```

(the HTTP one passes `client` rather than `context.client`).

- [ ] **Step 3: Run the suite to verify it fails**

Run: `cd integration-tests && pnpm exec vitest run suites/interop-sdk-server.test.ts`
Expected: both tests FAIL. First on the missing `SDK_TOOL_NAMES` / `MOKEI_TOOL_NAMES` exports; once
those exist (next step) the failure becomes
`expected [ 'echo', 'sum' ] to deeply equal [ 'echo', 'headerEcho', 'sum' ]`.

- [ ] **Step 4: Add the tool-name exports and the `headerEcho` schema to the fixture**

In `integration-tests/support/interop/fixture.ts`, beside the existing
`MOKEI_RESOURCE_URIS`/`SDK_RESOURCE_URIS` block, add:

```ts
/**
 * The exact tool set each fixture serves. They differ for the same reason the resource sets do:
 * only the SDK side carries `headerEcho`, whose `x-mcp-header` annotations exist to put mokei's
 * `Mcp-Param-*` encoder in front of a conformant decoder. mokei's own server never reads those
 * headers back, so the tool would be inert surface on that side.
 */
export const MOKEI_TOOL_NAMES: ReadonlyArray<string> = ['echo', 'sum']
export const SDK_TOOL_NAMES: ReadonlyArray<string> = ['echo', 'headerEcho', 'sum']
```

Beside `SUM_OUTPUT_SCHEMA`, add the annotated schema and its rendering helper:

```ts
/**
 * Two `x-mcp-header`-annotated arguments (SEP-2243), both optional so the omitted-argument case
 * is reachable. `integer` rather than `number` deliberately: neither mokei's encoder nor the SDK's
 * decoder admits an arbitrary number, and the integer path is compared numerically on the SDK
 * side while mokei writes canonical decimal.
 */
export const HEADER_ECHO_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    tenant: { type: 'string', 'x-mcp-header': 'Tenant' },
    limit: { type: 'integer', 'x-mcp-header': 'Limit' },
  },
  additionalProperties: false,
} as const

/**
 * What `headerEcho` returns. Reaching this text at all is the assertion: the SDK validates every
 * `Mcp-Param-*` header against the body `arguments` *before* dispatch, so a disagreeing or absent
 * header is answered `-32020` and the handler never runs.
 */
export function headerEchoText(tenant: string | undefined, limit: number | undefined): string {
  return JSON.stringify({ tenant: tenant ?? null, limit: limit ?? null })
}
```

- [ ] **Step 5: Register `headerEcho` on the SDK server**

In `createSDKServer()`, after the `sum` registration and before `registerPrompt`:

```ts
  server.registerTool(
    'headerEcho',
    {
      description: 'Echo arguments that are mirrored into Mcp-Param-* request headers',
      inputSchema: fromJsonSchema<{ tenant?: string; limit?: number }>(
        HEADER_ECHO_INPUT_SCHEMA,
        validator,
      ),
    },
    ({ tenant, limit }) => ({ content: [{ type: 'text', text: headerEchoText(tenant, limit) }] }),
  )
```

- [ ] **Step 6: Run the suite to verify it passes**

Run: `cd integration-tests && pnpm exec vitest run suites/interop-sdk-server.test.ts`
Expected: PASS (2 tests).

If instead the mokei HTTP row still reports `['echo', 'sum']` while stdio reports all three, the
schema was rejected client-side: `@mokei/http-client`'s transport drops any tool whose
`x-mcp-header` annotations fail `collectHeaderAnnotations`
(`packages/http-client/src/transport.ts:583-590`) and logs `Excluding tool with invalid
x-mcp-header annotation` with the reasons. Read that warning — it names the constraint violated.

If the SDK process prints `[mcp-sdk] tool 'headerEcho' carries an invalid x-mcp-header
declaration`, the same problem is being reported from the server side instead.

- [ ] **Step 7: Verify nothing else regressed**

Run: `cd integration-tests && pnpm exec vitest run suites/interop-2026-07-28-stdio.test.ts suites/version-detection-http.test.ts suites/version-detection-stdio.test.ts`
Expected: PASS. These all drive the *mokei* fixture, whose tool set is unchanged — this run
confirms that.

Run: `cd integration-tests && pnpm exec vitest run suites/interop-2026-07-28-http.test.ts`
Expected: **one failure**, and only this one —
`expected [ 'echo', 'sum' ] to deeply equal [ 'echo', 'headerEcho', 'sum' ]` in
`'mokei client against an SDK server over Streamable HTTP on 2026-07-28' > 'discovers, lists and
calls across the two stacks'`. That block asserts a hardcoded tool list against the *SDK* fixture;
Task 3 deletes it outright and relocates it. Leave it failing — it is transitional, and this task's
scope is three files. Any *other* failure in this file is a real regression.

---

### Task 2: SDK client → mokei server, both revisions

**Files:**
- Modify: `integration-tests/support/interop/expectations.ts:84-94`
- Modify: `integration-tests/support/interop/servers.ts` (imports; a new export beside
  `connectMokeiHTTPClient`)
- Rewrite: `integration-tests/suites/interop-sdk-client.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `createSDKClient(protocolVersion: ProtocolVersion): Client`
  - `CheckSDKClientOptions = { protocolVersion?: ProtocolVersion }`, and
    `checkSDKClient(client: Client, options?: CheckSDKClientOptions): Promise<void>`

- [ ] **Step 1: Write the failing test — rewrite `interop-sdk-client.test.ts`**

Replace the whole file with:

```ts
/** Official SDK v2 client ↔ mokei server, over stdio and Streamable HTTP, on both revisions. */
import { type Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import type { ProtocolVersion } from '@mokei/context-protocol'
import { afterEach, describe, test } from 'vitest'

import { checkSDKClient } from '../support/interop/expectations.ts'
import {
  createSDKClient,
  MOKEI_STDIO_SERVER_2026_07_28_PATH,
  MOKEI_STDIO_SERVER_PATH,
  type RunningHTTPServer,
  startMokeiHTTPServer,
} from '../support/interop/servers.ts'

/**
 * One row per protocol revision, carrying only *how to connect*. Assertions that exist on one
 * revision and not the other stay out of it — the shared body below is identical for both, and
 * the revision-specific part of it is `checkSDKClient`'s own `protocolVersion` option.
 */
type MokeiServerRow = {
  protocolVersion: ProtocolVersion
  stdioServerPath: string
  startHTTPServer: () => Promise<RunningHTTPServer>
}

const ROWS: ReadonlyArray<MokeiServerRow> = [
  {
    protocolVersion: '2025-11-25',
    // The both-revisions servers, deliberately: an SDK client in its default `'legacy'` mode
    // cannot select `2026-07-28` at all, so there is nothing here for a single-revision server
    // to catch, and a dual-revision peer is the more realistic one.
    stdioServerPath: MOKEI_STDIO_SERVER_PATH,
    startHTTPServer: () => startMokeiHTTPServer(),
  },
  {
    protocolVersion: '2026-07-28',
    // Single-revision, matching the reasoning already written into `startSDK20260728HTTPServer`:
    // against a both-revisions peer, a client that silently fell back to `2025-11-25` would pass
    // every assertion below while testing the wrong revision. A pin plus a single-revision server
    // turns that silent fallback into a connect failure.
    stdioServerPath: MOKEI_STDIO_SERVER_2026_07_28_PATH,
    startHTTPServer: () => startMokeiHTTPServer(['2026-07-28']),
  },
]

describe.each(ROWS)('SDK v2 client against the mokei server on $protocolVersion', (row) => {
  let httpServer: RunningHTTPServer | null = null
  let client: Client | null = null

  afterEach(async () => {
    if (client != null) {
      await client.close()
      client = null
    }
    if (httpServer != null) {
      await httpServer.dispose()
      httpServer = null
    }
  })

  test('over stdio', async () => {
    client = createSDKClient(row.protocolVersion)
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: [row.stdioServerPath] }),
    )
    await checkSDKClient(client, { protocolVersion: row.protocolVersion })
  })

  test('over Streamable HTTP', async () => {
    httpServer = await row.startHTTPServer()
    client = createSDKClient(row.protocolVersion)
    await client.connect(new StreamableHTTPClientTransport(new URL(httpServer.url)))
    await checkSDKClient(client, { protocolVersion: row.protocolVersion })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd integration-tests && pnpm exec vitest run suites/interop-sdk-client.test.ts`
Expected: FAIL — `createSDKClient` is not exported from `../support/interop/servers.ts`, and
`checkSDKClient` takes one argument.

- [ ] **Step 3: Add `createSDKClient` to `servers.ts`**

Add to the imports at the top of `integration-tests/support/interop/servers.ts`:

```ts
import { Client } from '@modelcontextprotocol/client'
```

Add beside `connectMokeiHTTPClient`:

```ts
const SDK_CLIENT_INFO = { name: 'mokei-interop-test', version: '1.0.0' }

/**
 * An SDK v2 `Client` for `protocolVersion`.
 *
 * `2025-11-25` is the SDK's default negotiation mode — a plain `new Client(info)`, byte-identical
 * to a client carrying no negotiation option at all. `2026-07-28` pins: the connect-time
 * `server/discover` must offer exactly that revision, and anything else fails loudly rather than
 * falling back to the `initialize` handshake.
 */
export function createSDKClient(protocolVersion: ProtocolVersion): Client {
  return protocolVersion === '2026-07-28'
    ? new Client(SDK_CLIENT_INFO, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
    : new Client(SDK_CLIENT_INFO)
}
```

- [ ] **Step 4: Add the `protocolVersion` option to `checkSDKClient`**

In `integration-tests/support/interop/expectations.ts`, replace the `checkSDKClient` signature and
its first two assertions (lines 89-94) with:

```ts
export type CheckSDKClientOptions = {
  /**
   * Revision the connection is expected to have selected, `'2025-11-25'` by default. Asserted
   * rather than assumed: a client that fell back to the other revision would satisfy every
   * assertion below, since the fixture surface is identical on both.
   */
  protocolVersion?: ProtocolVersion
}

export async function checkSDKClient(
  client: Client,
  options: CheckSDKClientOptions = {},
): Promise<void> {
  // Required on the `initialize` result; a specification SHOULD in the discover result's `_meta`
  // on `2026-07-28`, which mokei stamps on every result (`PROTOCOL.wrapResult`,
  // `packages/context-protocol/src/versions/2026-07-28.ts`).
  expect(client.getServerVersion()).toMatchObject({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  })
  expect(client.getNegotiatedProtocolVersion()).toBe(options.protocolVersion ?? '2025-11-25')
```

The rest of the function body is unchanged.

- [ ] **Step 5: Run it to verify it passes**

Run: `cd integration-tests && pnpm exec vitest run suites/interop-sdk-client.test.ts`
Expected: PASS (4 tests).

Two failures are anticipated by the spec, and each has a decision attached:

- `expected undefined to match object { name: 'interop-fixture', … }` on a `2026-07-28` row.
  mokei's discover result carries no `serverInfo` under `io.modelcontextprotocol/serverInfo`.
  Check it directly with
  `cd integration-tests && pnpm exec vitest run suites/interop-2026-07-28-stdio.test.ts -t serverInfo`
  before concluding anything. This is a small conformance gap in
  `packages/context-protocol/src/versions/2026-07-28.ts` — fixable inside this change under the
  red-test policy only if it really is one line there; otherwise file and skip.
- A connect rejection on the `2026-07-28` **stdio** row. The SDK probes with `server/discover` on
  a disposable sibling process before starting the caller's transport, so this means a fresh mokei
  stdio server did not answer a probe on a fresh connection. That is a genuine defect and unlikely
  to be small: file it in the backlog and land the row as `test.skip` naming the entry.

- [ ] **Step 6: Typecheck**

Run: `cd integration-tests && pnpm exec tsc --noEmit --skipLibCheck`
Expected: no errors.

---

### Task 3: mokei client → SDK server, both revisions

Moves the SDK block out of `interop-2026-07-28-http.test.ts` so the revision files stay
mokei ↔ mokei only, and adds the missing `2026-07-28` stdio row.

**Files:**
- Create: `integration-tests/support/interop/sdk-stdio-server-2026-07-28.ts`
- Modify: `integration-tests/support/interop/servers.ts` (one new path export beside
  `SDK_STDIO_SERVER_PATH`)
- Rewrite: `integration-tests/suites/interop-sdk-server.test.ts`
- Modify: `integration-tests/suites/interop-2026-07-28-http.test.ts` (delete lines 167-237 and the
  imports that become unused)

**Interfaces:**
- Consumes: `SDK_TOOL_NAMES` and `SDK_RESOURCE_URIS` (Task 1). Not `headerEchoText` — that is
  Task 4's dependency.
- Produces: `SDK_STDIO_SERVER_2026_07_28_PATH`; the `describe('mokei client against the SDK server
  on 2026-07-28')` block that Task 4 adds its cases to.

- [ ] **Step 1: Create the `2026-07-28`-only SDK stdio server**

Create `integration-tests/support/interop/sdk-stdio-server-2026-07-28.ts`:

```ts
/**
 * Stdio entry point serving the interop fixture with the official SDK v2 server on `2026-07-28`
 * and nothing else.
 *
 * `legacy: 'reject'` answers a `2025-11-25` opening with the unsupported-protocol-version error
 * instead of pinning a legacy instance. Same reasoning as `startSDK20260728HTTPServer`: against a
 * both-revisions peer, a mokei client that silently fell back would pass every assertion while
 * testing the wrong revision.
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio'

import { createSDKServer } from './fixture.ts'

serveStdio(() => createSDKServer(), { legacy: 'reject' })
```

- [ ] **Step 2: Export its path from `servers.ts`**

Add beside `SDK_STDIO_SERVER_PATH` (line 20):

```ts
/** Serves the fixture on protocol version `2026-07-28` only, via the official SDK v2 server. */
export const SDK_STDIO_SERVER_2026_07_28_PATH = fileURLToPath(
  new URL('./sdk-stdio-server-2026-07-28.ts', import.meta.url),
)
```

- [ ] **Step 3: Write the failing test — rewrite `interop-sdk-server.test.ts`**

Replace the whole file with:

```ts
/** mokei client ↔ official SDK v2 server, over stdio and Streamable HTTP, on both revisions. */
import type { ContextClient } from '@mokei/context-client'
import type { ProtocolVersion } from '@mokei/context-protocol'
import { spawnHostedContext } from '@mokei/host'
import { afterEach, describe, expect, test } from 'vitest'

import { checkMokeiClient } from '../support/interop/expectations.ts'
import {
  GREETING_TEXT,
  GREETING_URI,
  greetingMessage,
  NON_ASCII_RESOURCE_REGISTERED_URI,
  NON_ASCII_RESOURCE_TEXT,
  NON_ASCII_RESOURCE_URI,
  SDK_RESOURCE_URIS,
  SDK_TOOL_NAMES,
} from '../support/interop/fixture.ts'
import {
  connectMokeiHTTPClient,
  type RunningHTTPServer,
  SDK_STDIO_SERVER_2026_07_28_PATH,
  SDK_STDIO_SERVER_PATH,
  startSDK20260728HTTPServer,
  startSDKHTTPServer,
} from '../support/interop/servers.ts'

/** One row per protocol revision, carrying only *how to connect*. */
type SDKServerRow = {
  protocolVersion: ProtocolVersion
  stdioServerPath: string
  startHTTPServer: () => Promise<RunningHTTPServer>
}

const ROWS: ReadonlyArray<SDKServerRow> = [
  {
    protocolVersion: '2025-11-25',
    stdioServerPath: SDK_STDIO_SERVER_PATH,
    startHTTPServer: startSDKHTTPServer,
  },
  {
    protocolVersion: '2026-07-28',
    // Single-revision on both transports, so a client that fell back to `2025-11-25` fails to
    // connect rather than passing every assertion below against the wrong revision.
    stdioServerPath: SDK_STDIO_SERVER_2026_07_28_PATH,
    startHTTPServer: startSDK20260728HTTPServer,
  },
]

const EXPECTATIONS = { resourceURIs: SDK_RESOURCE_URIS, toolNames: SDK_TOOL_NAMES }

describe.each(ROWS)('mokei client against the SDK v2 server on $protocolVersion', (row) => {
  let httpServer: RunningHTTPServer | null = null
  let client: ContextClient | null = null

  afterEach(async () => {
    if (client != null) {
      await client.dispose()
      client = null
    }
    if (httpServer != null) {
      await httpServer.dispose()
      httpServer = null
    }
  })

  test('over stdio', async () => {
    const context = await spawnHostedContext({
      command: process.execPath,
      args: [row.stdioServerPath],
      // Pinned rather than left to the host default: each row's server serves exactly one
      // revision, and `'auto'` would make a probe failure look like a successful fallback.
      protocolVersion: row.protocolVersion,
    })
    try {
      await checkMokeiClient(context.client, {
        protocolVersion: row.protocolVersion,
        ...EXPECTATIONS,
      })
    } finally {
      await context.disposer.dispose()
    }
  })

  test('over Streamable HTTP', async () => {
    httpServer = await row.startHTTPServer()
    client = connectMokeiHTTPClient(httpServer.url, row.protocolVersion)
    await checkMokeiClient(client, { protocolVersion: row.protocolVersion, ...EXPECTATIONS })
  })
})

/**
 * Assertions that exist on `2026-07-28` and have no `2025-11-25` counterpart, so they stay out of
 * the table above rather than becoming configuration.
 *
 * `checkMokeiClient` skips its `initialize()` block on this revision — there is no handshake to
 * assert — so `server/discover` is asserted here instead.
 */
describe('mokei client against the SDK v2 server on 2026-07-28', () => {
  let httpServer: RunningHTTPServer | null = null
  let client: ContextClient | null = null

  afterEach(async () => {
    if (client != null) {
      await client.dispose()
      client = null
    }
    if (httpServer != null) {
      await httpServer.dispose()
      httpServer = null
    }
  })

  test('answers server/discover over Streamable HTTP', async () => {
    httpServer = await startSDK20260728HTTPServer()
    client = connectMokeiHTTPClient(httpServer.url, '2026-07-28')

    const discovered = await client.discover()
    expect(discovered.supportedVersions).toEqual(['2026-07-28'])
    expect(discovered.capabilities.tools).toBeDefined()
  })

  test('answers server/discover over stdio', async () => {
    const context = await spawnHostedContext({
      command: process.execPath,
      args: [SDK_STDIO_SERVER_2026_07_28_PATH],
      protocolVersion: '2026-07-28',
    })
    try {
      const discovered = await context.client.discover()
      expect(discovered.supportedVersions).toEqual(['2026-07-28'])
      expect(discovered.capabilities.tools).toBeDefined()
    } finally {
      await context.disposer.dispose()
    }
  })

  // Every method the specification's standard request headers require an `Mcp-Name` on, and the
  // peer that actually enforces them. The three are not interchangeable: the header mirrors
  // `params.name` for `tools/call` and `prompts/get` but `params.uri` for `resources/read`, so a
  // client deriving the header from one field alone passes two of these and fails the third.
  test('sends Mcp-Name for every method that requires it', async () => {
    httpServer = await startSDK20260728HTTPServer()
    client = connectMokeiHTTPClient(httpServer.url, '2026-07-28')

    const called = await client.callTool({ name: 'echo', arguments: { text: 'hello interop' } })
    expect(called.content).toEqual([{ type: 'text', text: 'hello interop' }])

    const prompt = await client.getPrompt({ name: 'greet', arguments: { name: 'Ada' } })
    expect(prompt.messages).toEqual([
      { role: 'user', content: { type: 'text', text: greetingMessage('Ada') } },
    ])

    const read = await client.readResource({ uri: GREETING_URI })
    expect(read.contents).toEqual([
      { uri: GREETING_URI, mimeType: 'text/plain', text: GREETING_TEXT },
    ])
  })

  // A resource URI is unconstrained text; an HTTP header value is a ByteString. Sending the URI
  // raw makes the `new Headers()` inside `fetch` throw before the request leaves, so a client that
  // does not Base64-wrap it cannot read such a resource at all. Only a peer that runs `Mcp-Name`
  // through the sentinel decoder before cross-checking it against `params.uri` can show that the
  // wrapped form is also *accepted*: mokei's own server never reads the header back, so no
  // mokei-to-mokei test can distinguish the two.
  test('reads a resource whose URI no header value can carry raw', async () => {
    httpServer = await startSDK20260728HTTPServer()
    client = connectMokeiHTTPClient(httpServer.url, '2026-07-28')

    const read = await client.readResource({ uri: NON_ASCII_RESOURCE_URI })
    expect(read.contents).toEqual([
      {
        uri: NON_ASCII_RESOURCE_REGISTERED_URI,
        mimeType: 'text/plain',
        text: NON_ASCII_RESOURCE_TEXT,
      },
    ])
  })
})
```

- [ ] **Step 4: Run it to verify the new rows fail and the old ones pass**

Run: `cd integration-tests && pnpm exec vitest run suites/interop-sdk-server.test.ts`
Expected: the `2025-11-25` rows PASS; the `2026-07-28` rows and the discover tests run for the
first time. They are expected to pass — the HTTP half is the block being moved, and the stdio half
is new. A red on the stdio half is diagnosed against the same two anticipated failures listed in
Task 2 Step 5, plus one specific to this direction: if `serveStdio` answers the mokei client's
`server/discover` with the unsupported-protocol-version error, the `legacy: 'reject'` classifier
did not recognize mokei's envelope claim — read the SDK child's stderr (piped through by
`spawnHostedContext`) before concluding.

- [ ] **Step 5: Delete the moved block from the revision file**

In `integration-tests/suites/interop-2026-07-28-http.test.ts`, delete the entire second `describe`
(lines 167-237, `'mokei client against an SDK server over Streamable HTTP on 2026-07-28'`). Then
remove the imports it alone used: `greetingMessage`, `NON_ASCII_RESOURCE_REGISTERED_URI`,
`NON_ASCII_RESOURCE_TEXT`, `NON_ASCII_RESOURCE_URI` from the `fixture.ts` import, and
`startSDK20260728HTTPServer` from the `servers.ts` import. `GREETING_TEXT` and `GREETING_URI`
become unused too — confirm with a search before removing them.

Update the file's header comment: the second paragraph describing "the second block below" no
longer applies. Replace the whole doc comment with:

```ts
/**
 * `2026-07-28` over Streamable HTTP, mokei against mokei.
 *
 * The cross-stack half of this revision — a mokei client against a real SDK peer — lives in
 * `interop-sdk-server.test.ts`, alongside the `2025-11-25` rows of the same direction, so the
 * organizing axis of the interop suites is direction rather than revision.
 */
```

- [ ] **Step 6: Run both files**

Run: `cd integration-tests && pnpm exec vitest run suites/interop-sdk-server.test.ts suites/interop-2026-07-28-http.test.ts`
Expected: PASS. `interop-2026-07-28-http.test.ts` runs 5 tests (was 8).

- [ ] **Step 7: Typecheck**

Run: `cd integration-tests && pnpm exec tsc --noEmit --skipLibCheck`
Expected: no errors. An unused-import error here means Step 5's import pruning was incomplete.

---

### Task 4: `Mcp-Param-*` header cases

Streamable HTTP only — request headers do not exist on stdio. `headerEcho` is still visible to the
stdio rows through `SDK_TOOL_NAMES` in the shared `listTools` assertion; it is only *called* here.

**Files:**
- Modify: `integration-tests/suites/interop-sdk-server.test.ts` (four tests appended to the
  `2026-07-28` describe block from Task 3)

**Interfaces:**
- Consumes: `headerEchoText` (Task 1), `startSDK20260728HTTPServer`, `connectMokeiHTTPClient`.

- [ ] **Step 1: Write the failing tests**

Add `headerEchoText` to the `../support/interop/fixture.ts` import, then append inside
`describe('mokei client against the SDK v2 server on 2026-07-28', ...)`:

```ts
  /**
   * The `Mcp-Param-*` cases. All three drive mokei's encoder into the SDK's decoder, which
   * validates every declared header against the body `arguments` before dispatch and answers a
   * disagreement `-32020` `HeaderMismatch` (HTTP 400) with the offending pair in `data.mismatch`.
   * So reaching the handler's echoed text at all *is* the assertion.
   *
   * Each case calls `listTools()` first, and must: mokei's transport reads the `x-mcp-header`
   * annotations off a tool `inputSchema` it caches from a `tools/list` result
   * (`packages/http-client/src/transport.ts:571-599`). Without that call no header is sent, the
   * SDK sees a body value with no header, and the case fails as `param-header-missing` — which
   * would be the right failure for the wrong reason.
   */
  test('mirrors a plain x-mcp-header argument into Mcp-Param-*', async () => {
    httpServer = await startSDK20260728HTTPServer()
    client = connectMokeiHTTPClient(httpServer.url, '2026-07-28')
    await client.listTools()

    const called = await client.callTool({ name: 'headerEcho', arguments: { tenant: 'acme' } })
    expect(called.content).toEqual([{ type: 'text', text: headerEchoText('acme', undefined) }])
  })

  // One layer below the `Mcp-Name` defect's shape: a value no header can carry raw, round-tripped
  // through a conformant decoder. mokei wraps it in the `=?base64?…?=` sentinel; the SDK decodes
  // the payload, rejects it if it is not canonical Base64 or not valid UTF-8, and compares the
  // decoded string against the body value.
  test('Base64-wraps a non-Latin-1 x-mcp-header argument', async () => {
    httpServer = await startSDK20260728HTTPServer()
    client = connectMokeiHTTPClient(httpServer.url, '2026-07-28')
    await client.listTools()

    const called = await client.callTool({ name: 'headerEcho', arguments: { tenant: '文書' } })
    expect(called.content).toEqual([{ type: 'text', text: headerEchoText('文書', undefined) }])
  })

  // An integer-typed declaration is compared numerically on the SDK side and written as canonical
  // decimal on mokei's — a distinct path from the string comparison above.
  test('writes an integer x-mcp-header argument as canonical decimal', async () => {
    httpServer = await startSDK20260728HTTPServer()
    client = connectMokeiHTTPClient(httpServer.url, '2026-07-28')
    await client.listTools()

    const called = await client.callTool({ name: 'headerEcho', arguments: { limit: 42 } })
    expect(called.content).toEqual([{ type: 'text', text: headerEchoText(undefined, 42) }])
  })

  /**
   * The absence case, and the one case the peer cannot fail for us: when the body value is absent
   * the SDK MUST NOT expect the header, and a header sent anyway is *ignored*. So this is asserted
   * on the outgoing request instead, by wrapping `globalThis.fetch` — the technique the
   * `Mcp-Session-Id` tripwire in `interop-2026-07-28-http.test.ts` already uses.
   *
   * Patching a global is safe only because vitest runs the tests within a file serially; under
   * `test.concurrent` this would capture (and restore under) its neighbours.
   */
  test('sends no Mcp-Param-* header for an omitted annotated argument', async () => {
    httpServer = await startSDK20260728HTTPServer()
    const sent: Array<Headers> = []
    const original = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof init?.body === 'string' && init.body.includes('"headerEcho"')) {
        sent.push(new Headers(init.headers))
      }
      return await original(input, init)
    }) as typeof globalThis.fetch
    try {
      client = connectMokeiHTTPClient(httpServer.url, '2026-07-28')
      await client.listTools()

      const called = await client.callTool({ name: 'headerEcho', arguments: { limit: 7 } })
      expect(called.content).toEqual([{ type: 'text', text: headerEchoText(undefined, 7) }])
    } finally {
      globalThis.fetch = original
    }

    expect(sent).toHaveLength(1)
    expect(sent[0]?.get('Mcp-Param-Limit')).toBe('7')
    expect(sent[0]?.get('Mcp-Param-Tenant')).toBeNull()
  })
```

- [ ] **Step 2: Run them**

Run: `cd integration-tests && pnpm exec vitest run suites/interop-sdk-server.test.ts`
Expected: PASS (all 8 tests in the `2026-07-28` block plus the 4 table rows).

A `-32020` failure carries its own diagnosis in `data.mismatch`, naming the header and what the
body carried. Read it before changing anything:

- `param-header-missing` — mokei sent no header for a body value that has one declared. Most
  likely the `listTools()` call was dropped, or the annotation was rejected client-side (see the
  warning named in Task 1 Step 6).
- `param-header-invalid-encoding` — the sentinel payload is not canonical Base64 or not valid
  UTF-8. A real encoder defect in `packages/http-client/src/x-mcp-header.ts`, small enough to fix
  on this branch under the red-test policy.
- `param-header-mismatch` — header and body decode to different values. Same file, same policy.

- [ ] **Step 3: Verify the absence case is not vacuous**

The `expect(sent).toHaveLength(1)` line guards it, but confirm the guard works: temporarily change
`init.body.includes('"headerEcho"')` to `init.body.includes('"nosuchtool"')`, run the test, and
confirm it now FAILS on the length assertion. Revert the change.

- [ ] **Step 4: Full integration run and lint**

Run: `cd integration-tests && pnpm exec vitest run`
Expected: PASS, except the backend-gated suites (`cli-chat-llama`, `llama-provider`, and the other
model-backed ones) which skip without a local model server. The interop suites need no backend, so
a skip *there* is a real failure.

Run: `rtk proxy pnpm run lint`
Expected: clean.

---

### Task 5: Reconcile the backlog

The spec declares these follow-ups; they are part of this change, not a later one.

**Files:**
- Modify: `docs/agents/plans/backlog/2026-06-20-mcp-draft-remaining.md` (§1 G7 part 5 at lines
  16-24; §3.2.3 at lines 97-125; §3.2.4 at lines 126-133)

- [ ] **Step 1: Correct the G7 part 5 blockers**

Both recorded blockers are stale. In the `**G7 part 5**` bullet, replace the sentence beginning
"**Deferred:** no server emits HeaderMismatch today" through "pick a non-colliding code then."
with:

```markdown
  **Deferred:** the retry loop itself is unwritten. Both originally recorded blockers are gone
  as of 2026-08-04: SDK `2.0.0`'s server *does* emit `-32020` `HeaderMismatch` for an
  `Mcp-Param-*` disagreement (`core-internal/src/shared/mcpParamHeaders.ts`,
  `validateMcpParamHeaders`, HTTP `400`, offending pair in `data.mismatch`), reachable from the
  integration suite today via `startSDK20260728HTTPServer`; and the `-32001` collision with
  `SESSION_EXPIRED_CODE` is beside the point, since the specification's code is `-32020`, which
  mokei already reserves as `HEADER_MISMATCH`. Self-contained in `@mokei/http-client`.
```

Leave the two `*Update …:*` sentences that follow it in place.

- [ ] **Step 2: Close §3.2.3**

Replace the whole of §3.2.3 (heading and body) with:

```markdown
#### 3.2.3 Point `checkMokeiClient` at the SDK peer for `2026-07-28` — **done 2026-08-04**

Closed by `docs/superpowers/specs/2026-08-03-interop-peer-matrix-design.md`. All four quadrants
(mokei client ↔ SDK server, SDK client ↔ mokei server, each over stdio and Streamable HTTP) now
run on both revisions from the shared expectations, in `interop-sdk-client.test.ts` and
`interop-sdk-server.test.ts`.
```

- [ ] **Step 3: Prune §3.2.4**

Three of its six items are now covered. Replace the list with:

```markdown
- `subscriptions/listen` (also B4).
- The `MissingRequiredClientCapability` ladders — not reachable on `2026-07-28`, where
  `PROTOCOL.serverMethods` is empty and no handler can need an undeclared client capability. The
  emitter arrives with MRTR (B7).
- Task-augmented params — SEP-2663 removed tasks from the specification and mokei never
  implemented them; delete this line rather than covering it.

Covered as of 2026-08-04 (see 3.2.3): `Mcp-Param-*` end to end against the SDK's decoder,
including the Base64 sentinel and integer paths and the omitted-argument case; and
`server/discover`'s `_meta` contents, asserted through the SDK client's `getServerVersion()`.
Negative `Mcp-Name` cases were deliberately not built — written the obvious way (a raw `fetch`
carrying a wrong header) they test the SDK rather than mokei, since the request never goes
through mokei's encoder at all.
```

- [ ] **Step 4: If any red test was filed rather than fixed**

Add a `#### 3.2.5` entry naming the defect, the file and test that carries the `test.skip`, and
what the failure was. Skip this step if every test went green.

- [ ] **Step 5: Verify**

Run: `cd /Users/paul/dev/yulsi/mokei && rg -n "3\.2\.3|3\.2\.4|G7 part 5" docs/agents/plans/backlog/2026-06-20-mcp-draft-remaining.md`
Expected: the cross-references elsewhere in the file (notably §3.2.1's "see 3.2.3" and §3.3.1's
"G7 part 5, §1 above") still resolve to sections that exist.

---

### Task 6: Verify and commit

- [ ] **Step 1: Build**

Run: `cd /Users/paul/dev/yulsi/mokei && pnpm build`
Expected: success. Nothing under `packages/` changed, but cross-package vitest resolves
`@mokei/*` through built `lib/`, so a stale build makes the run below meaningless.

- [ ] **Step 2: Package tests**

Run: `cd /Users/paul/dev/yulsi/mokei && pnpm test`
Expected: PASS.

- [ ] **Step 3: Integration tests**

Run: `cd /Users/paul/dev/yulsi/mokei/integration-tests && pnpm exec vitest run`
Expected: PASS except the backend-gated suites.

- [ ] **Step 4: Lint**

Run: `cd /Users/paul/dev/yulsi/mokei && rtk proxy pnpm run lint`
Expected: clean.

- [ ] **Step 5: Update the plan stage and commit**

Set `**Stage:** reviewing` in this file, then:

```bash
cd /Users/paul/dev/yulsi/mokei
git add integration-tests docs
git commit -m "test: close the 2026-07-28 interop peer matrix and cover Mcp-Param-*"
```

---

## Verification Summary

| What | Command |
|---|---|
| One suite | `cd integration-tests && pnpm exec vitest run suites/<file>.test.ts` |
| One test | add `-t '<name substring>'` |
| Types | `cd integration-tests && pnpm exec tsc --noEmit --skipLibCheck` |
| Everything | `pnpm build && pnpm test && (cd integration-tests && pnpm exec vitest run) && rtk proxy pnpm run lint` |

The interop suites need no model backend, so unlike the backend-gated suites they run
unconditionally: a skip there is a real failure, not a missing local server.
