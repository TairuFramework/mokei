# Extension Plumbing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Stage:** qa
**Mode:** tasks

**Goal:** One registry-driven mechanism for MCP extensions in context-protocol / context-server / context-client, with Tasks migrated onto it and made opt-in on the client.

**Architecture:** A static registry of `ExtensionDefinition`s in `@mokei/context-protocol` drives declaration, peer reading (with the settings `revision` rule) and an extra reachability guard layered on top of each revision's existing `clientMethods`. Server and client compute their enabled extensions at construction; built-ins are enabled by their own feature params only.

**Tech Stack:** TypeScript, vitest, pnpm/turbo, biome.

**Spec:** `docs/superpowers/specs/2026-11-25-extension-plumbing-design.md`

## Global Constraints

- Registry-only: no free-form `extensions` param on server or client. Every declared/read extension has an `ExtensionDefinition`.
- `ProtocolDefinition.clientMethods` keeps its contract (all methods a revision can carry); `tasks/*` stay in the `2026-07-28` set. `packages/context-protocol/test/versions.test.ts` must stay green unchanged.
- Wire schemas and derived types are not moved or recomposed.
- Client `tasks?: boolean` defaults to `false`. Server Tasks stays enabled by its existing `tasks` param.
- Missing peer declaration error shape is exactly today's: `code: MISSING_REQUIRED_CLIENT_CAPABILITY`, `data: { requiredCapabilities: { extensions: { [id]: {} } } }`, message `Client did not declare the <id> extension` (today's Tasks message is `Client did not declare the tasks extension`; keep that literal for Tasks).
- `revision` rule: peer settings `revision` must equal `definition.revision` (both absent = equal), else treated as not declared.
- Kebab-case file names; `pnpm` only; changesets use `patch`.
- Lint with `rtk proxy pnpm run lint`. Cross-package tests resolve built `lib/`: run `pnpm build` (or the dependency's `build`) before testing a dependent package.

## Review Focus

1. Client declares Tasks with an unknown `revision` → server gives no task context on `tools/call` and refuses `tasks/get` with the missing-capability error (Task 2 test).
2. `tasks: false` client calling `waitForTask()` → rejects immediately, emits no `subscriptions/listen` frame, does not fall back to polling (Task 3 test).
3. `'auto'` client resolving to `2025-11-25` against a server with Tasks enabled → no `extensions` in `initialize` result, no Tasks in request (Task 2 + Task 3 tests).
4. Default host / `createHostedContext` against a Tasks server → tools answer without a `CreateTaskResult` (Task 4 test).
5. `getServerExtension(TASKS)` before any other call on `2026-07-28` → triggers one `server/discover` and reuses the snapshot for later capability gates (Task 3 test).

---

### Task 1: Extension registry in context-protocol

**Files:**
- Create: `packages/context-protocol/src/extensions.ts`
- Modify: `packages/context-protocol/src/versions/2026-07-28.ts:72-76` (`declaresTasksExtension` delegates to `readExtension`)
- Modify: `packages/context-protocol/src/index.ts` (export the new module)
- Test: `packages/context-protocol/test/extensions.test.ts`

**Interfaces:**
- Produces:
  - `type ExtensionDefinition = { id: string; revision?: string; protocolVersions: ReadonlySet<ProtocolVersion>; clientMethods: ReadonlySet<string>; serverMethods: ReadonlySet<string> }`
  - `const TASKS: ExtensionDefinition` (`id: TASKS_EXTENSION`, `protocolVersions: {'2026-07-28'}`, `clientMethods: {'tasks/get','tasks/update','tasks/cancel'}`, `serverMethods: {}`)
  - `const EXTENSIONS: ReadonlyArray<ExtensionDefinition>` (`[TASKS]`)
  - `extensionForClientMethod(method: string, registry?: ReadonlyArray<ExtensionDefinition>): ExtensionDefinition | undefined` (same for `extensionForServerMethod`); `registry` defaults to `EXTENSIONS`, overridable for tests
  - `readExtension(capabilities: { extensions?: Record<string, Record<string, unknown>> } | undefined, definition: ExtensionDefinition): Record<string, unknown> | null`
  - `declareExtension(definition: ExtensionDefinition, settings?: Record<string, unknown>): Record<string, unknown>` (adds `revision` when the definition has one)
  - `extensionsFor(enabled: ReadonlyMap<ExtensionDefinition, Record<string, unknown>>, protocol: ProtocolVersion): Record<string, Record<string, unknown>> | undefined` (only definitions whose `protocolVersions` has `protocol`; `undefined` when empty)
  - `missingExtensionError(definition: ExtensionDefinition): RPCError` (the Global Constraints shape; message uses `tasks` for Tasks, otherwise `definition.id`)
  - `requireExtension(definition: ExtensionDefinition, capabilities: ... | undefined): void` (throws `missingExtensionError`)

- [ ] **Step 1: Write failing tests** in `extensions.test.ts`:
  - `readExtension` returns settings when declared without revision against `TASKS`; returns `null` when absent; returns `null` for `{ revision: '2' }` against `TASKS`; for a test definition with `revision: '1'`, returns settings for `{ revision: '1' }`, `null` for `{}` and for `{ revision: '2' }`.
  - `declareExtension(TASKS)` → `{}`; with test def `revision: '1'` and settings `{ a: 1 }` → `{ a: 1, revision: '1' }`.
  - `extensionForClientMethod('tasks/get')` → `TASKS`; `('tools/call')` → `undefined`.
  - `extensionsFor(new Map([[TASKS, {}]]), '2025-11-25')` → `undefined`; `'2026-07-28'` → `{ 'io.modelcontextprotocol/tasks': {} }`.
  - `requireExtension(TASKS, {})` throws with `code === MISSING_REQUIRED_CLIENT_CAPABILITY`, `message === 'Client did not declare the tasks extension'`, `data` deep-equals `{ requiredCapabilities: { extensions: { 'io.modelcontextprotocol/tasks': {} } } }`.
  - `declaresTasksExtension({ extensions: { [TASKS_EXTENSION]: { revision: 'x' } } })` → `false`.
- [ ] **Step 2: Run** `pnpm --filter @mokei/context-protocol exec vitest run test/extensions.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `extensions.ts` per Interfaces; move `RPCError`/`MISSING_REQUIRED_CLIENT_CAPABILITY` imports from wherever `server.ts` gets them today. Make `declaresTasksExtension` call `readExtension(capabilities, TASKS) != null` (import cycle: if `extensions.ts` imports `TASKS_EXTENSION` from `versions/2026-07-28.ts`, inline the check there instead of importing back; keep one source of truth for the id).
- [ ] **Step 4: Run** the context-protocol suite `pnpm --filter @mokei/context-protocol test` — expect PASS, `versions.test.ts` untouched.
- [ ] **Step 5: Commit** `feat(context-protocol): extension registry`.

### Task 2: Server gating, advertising and client-capability accessor

**Files:**
- Modify: `packages/context-server/src/server.ts` (`requireTasksExtension` at ~145 removed; capabilities at ~297; `_handleRequest` ~603; `initialize` case ~761; `server/discover` ~824; `subscriptions/listen` ~829; `tasks/*` ~835-856; `#callTool` ~882; `CreateTaskResult` check ~700)
- Modify: `packages/context-server/src/types.ts:109` (`HandlerRequest` gains `clientCapabilities: ClientCapabilities`)
- Test: `packages/context-server/test/extensions.test.ts`; existing `tasks-*.test.ts` stay green unchanged

**Interfaces:**
- Consumes: Task 1 exports.
- Produces:
  - `ServerParams` gains `/** @internal test hook */ _extensions?: ReadonlyArray<{ definition: ExtensionDefinition; settings?: Record<string, unknown> }>` and `_registry?: ReadonlyArray<ExtensionDefinition>` (lookup registry, defaults to `EXTENSIONS`; tests pass a test-only definition supporting `2025-11-25`).
  - `HandlerRequest.clientCapabilities: ClientCapabilities` (always set; `{}` when none).

- [ ] **Step 1: Write failing tests** in `extensions.test.ts`, using `test-context-manager.ts` helpers and a test definition `TEST_EXT = { id: 'dev.mokei/test-ext', revision: '1', protocolVersions: {'2025-11-25','2026-07-28'}, clientMethods: {}, serverMethods: {} }`:
  - `2025-11-25`: server with `_extensions: [{ definition: TEST_EXT }]`, `_registry: [TEST_EXT, TASKS]`, and `tasks` set → `initialize` result `capabilities.extensions` equals `{ 'dev.mokei/test-ext': { revision: '1' } }` (Tasks absent).
  - `2026-07-28`: same server → `server/discover` `capabilities.extensions` has both ids.
  - `2025-11-25`: a tool handler sees `clientCapabilities.extensions['dev.mokei/test-ext']` from the `initialize` params; on `2026-07-28` it sees per-request `_meta` capabilities.
  - `2026-07-28`, server with Tasks: request `tasks/get` with client capabilities `{ extensions: { [TASKS_EXTENSION]: { revision: '9' } } }` → error with the Global Constraints shape; `tools/call` on a task-capable tool with the same capabilities → `handler.task` is `undefined` (Review Focus 1).
  - `2026-07-28`, server without `tasks`: `tasks/get` → `METHOD_NOT_FOUND`, message `Unsupported method: tasks/get`.
  - `subscriptions/listen` with `notifications.taskIds` and no Tasks declaration → same missing-capability error as today.
- [ ] **Step 2: Run** `pnpm --filter @mokei/context-server exec vitest run test/extensions.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.**
  - Constructor builds `#extensions: Map<ExtensionDefinition, Record<string, unknown>>` from `tasks` (→ `TASKS`) plus `_extensions`; `#capabilities.extensions` no longer set directly.
  - `#clientCapabilitiesFor(request, protocol): ClientCapabilities` returns `readRequestMeta(request).clientCapabilities ?? {}` when `protocol.requiresRequestMeta`, else `this.#clientInitialize?.capabilities ?? {}`. Use it everywhere `readRequestMeta(request).clientCapabilities` is read today (MRTR `missingInputCapabilities`, `#callTool`, `CreateTaskResult` check), and pass it into every `HandlerRequest`.
  - `_handleRequest`, after the existing `clientMethods` check: `const definition = extensionForClientMethod(request.method, registry)`; if defined and (`!#extensions.has(definition)` or `!definition.protocolVersions.has(protocol.version)`) throw today's `METHOD_NOT_FOUND`; else `requireExtension(definition, clientCapabilities)`. Drop the per-case `if (this.#tasks == null) break` / `requireTasksExtension` lines in `tasks/*` cases that this now covers.
  - `subscriptions/listen` with `taskIds`: keep `if (this.#tasks == null) break`, replace `requireTasksExtension` with `requireExtension(TASKS, clientCapabilities)`.
  - `initialize` and `server/discover` capabilities: `{ ...this.#capabilities, extensions: extensionsFor(this.#extensions, protocol.version) }` with `extensions` omitted when `undefined` (replaces the Tasks-stripping block). `buildDiscoverResult` call passes the 2026-07-28 view.
  - `declaresTasksExtension` call sites switch to `readExtension(clientCapabilities, TASKS) != null`.
- [ ] **Step 4: Run** `pnpm --filter @mokei/context-server test` — expect PASS including all existing `tasks-*` suites.
- [ ] **Step 5: Commit** `feat(context-server): registry-driven extension gating`.

### Task 3: Client opt-in, declaration, gating and server-extension reading

**Files:**
- Modify: `packages/context-client/src/types.ts:137` (`ClientParams` gains `tasks?: boolean` and the same `@internal` `_extensions` / `_registry` hooks as the server)
- Modify: `packages/context-client/src/client.ts` (capabilities ~472, `#initialize` ~845, `#capabilitiesFor` ~968, `request()` ~647, `#openListen` ~1335, `waitForTask` ~1907, new `getServerExtension`)
- Modify: `packages/context-client/src/errors.ts` (add `ExtensionNotDeclaredError`), `packages/context-client/src/index.ts` (export it)
- Test: `packages/context-client/test/extensions.test.ts`; existing tests that rely on tasks (`tasks-client.test.ts`, `task-waiter.test.ts`, `mrtr.test.ts`, `subscriptions*.test.ts` where task filters are used) gain `tasks: true` and nothing else

**Interfaces:**
- Consumes: Task 1 exports.
- Produces:
  - `ClientParams.tasks?: boolean` (default `false`)
  - `ContextClient.getServerExtension(definition: ExtensionDefinition, options?: RequestOptions): Promise<Record<string, unknown> | null>`
  - `class ExtensionNotDeclaredError extends Error` with `readonly extension: string`, message `Server did not declare the <id> extension`
  - internal `#requireServerExtensionAsync(definition, options?)` throwing it (no caller yet)

- [ ] **Step 1: Write failing tests** in `extensions.test.ts`:
  - Default client on `2026-07-28`: captured `tools/call` `_meta['io.modelcontextprotocol/clientCapabilities']` has no `extensions` key; against a Tasks server a task-capable tool returns a plain `CallToolResult`.
  - `tasks: true` on `2026-07-28`: `_meta` capabilities include `{ extensions: { 'io.modelcontextprotocol/tasks': {} } }`.
  - `tasks: true` on `2025-11-25`: `initialize` params have no `extensions`; with `_extensions: [{ definition: TEST_EXT }]` and `_registry` they carry `{ 'dev.mokei/test-ext': { revision: '1' } }`.
  - Default client: `client.tasks.get('t1')` rejects locally (existing unsupported-method error class) and no frame is written.
  - Default client: `client.waitForTask(...)` rejects with that same error; transport sees no `subscriptions/listen` and no `tasks/get` (Review Focus 2).
  - Default client: `request('subscriptions/listen', { notifications: { taskIds: ['t1'] } })` rejects locally.
  - `getServerExtension(TASKS)` on `2026-07-28` against a Tasks server → `{}`; against a server built with `_extensions: [{ definition: { ...TASKS, revision: '9' } }]` (declares `{ revision: '9' }`) → `null`; called first, exactly one `server/discover` is sent, and a following `listTools()` sends no second one (Review Focus 5). On `2025-11-25` it reads the `initialize` result.
- [ ] **Step 2: Run** `pnpm --filter @mokei/context-client exec vitest run test/extensions.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.**
  - Constructor builds `#extensions` map (`TASKS` when `params.tasks === true`, plus `_extensions`); `#capabilitiesFor(protocol)` returns `{ ...this.#capabilities, extensions: extensionsFor(this.#extensions, protocol.version) }` (omit when `undefined`). `#initialize` sends `this.#capabilitiesFor(protocol)` instead of `this.#capabilities`.
  - `request()`: after the `clientMethods` check, refuse an extension method whose definition is not enabled or not on the resolved revision with the same error the `clientMethods` check throws; refuse `subscriptions/listen` with `notifications.taskIds` when Tasks is not enabled.
  - `waitForTask()`: check Tasks enabled before creating/using `#taskWaiter`; `#openListen()` refuses a filter with `taskIds` when Tasks is not enabled.
  - `getServerExtension`: on handshake revisions read `#serverCapabilities`; otherwise populate `#serverCapabilitySnapshot` exactly as `#requireServerCapabilityAsync` does (extract a shared `#serverCapabilitiesAsync(options)`), then `readExtension(capabilities, definition)`.
- [ ] **Step 4: Add `tasks: true`** to existing client tests that exercise tasks; run `pnpm --filter @mokei/context-client test` — expect PASS.
- [ ] **Step 5: Commit** `feat(context-client): opt-in Tasks and extension declaration`.

### Task 4: Opt in every in-repo Tasks consumer

**Files:**
- Modify: `packages/host/src/hosted-context.ts:19-39` (`CreateHostedContextParams.tasks?: boolean`, forwarded to `ContextClient`)
- Modify: `packages/host/src/host.ts` (`ContextHostParams.tasks?: boolean`, default `false`, forwarded to every context it creates at ~581 and ~648)
- Modify: `packages/host-node/src/node-host.ts:97` (forward host `tasks`)
- Modify: `packages/flow-host-node/src/service.ts:201` (`new NodeContextHost({ elicit: true, tasks: true, tracing })`)
- Modify: whatever constructs the host/clients used by `packages/decision-flow-server/src/tool-caller.ts` and `packages/flow-host/src/*` (find with `rg "client.tasks|waitForTask"`), opting in with `tasks: true`
- Modify: `integration-tests/suites/tasks.test.ts`, `integration-tests/suites/interop-tasks.test.ts`, and their support clients (`integration-tests/support/interop/servers.ts`) to pass `tasks: true`
- Test: `packages/host/test/` (new case in the hosted-context or host suite)

**Interfaces:**
- Consumes: `ClientParams.tasks` (Task 3).
- Produces: `ContextHostParams.tasks?: boolean`, `CreateHostedContextParams.tasks?: boolean`.

- [ ] **Step 1: Write failing tests** in the host suite: a host with default params against a Tasks-enabled server gets a plain `CallToolResult` from a task-capable tool (Review Focus 4); a host with `tasks: true` gets the task path (result resolved via the host's existing task handling).
- [ ] **Step 2: Run** `pnpm --filter @mokei/host exec vitest run <file>` — expect FAIL on the `tasks: true` case.
- [ ] **Step 3: Implement** the forwarding and opt-ins listed in Files.
- [ ] **Step 4: Run** `pnpm build && pnpm test` from the repo root — expect PASS, including integration suites.
- [ ] **Step 5: Commit** `feat(host): forward Tasks opt-in; opt in flow and decision-flow`.

### Task 5: Docs and changeset

**Files:**
- Modify: `docs/agents/architecture.md` (the `### MCP Tasks` section ~133: client opt-in via `tasks: true`; new short "Extensions" paragraph: registry in `context-protocol/src/extensions.ts`, built-in only, `revision` rule)
- Modify: `packages/context-client/README.md` (document `tasks` and `getServerExtension`) if it documents client params
- Create: `.changeset/extension-registry.md`

- [ ] **Step 1: Write** the changeset:

```md
---
"@mokei/context-protocol": patch
"@mokei/context-server": patch
"@mokei/context-client": patch
"@mokei/host": patch
"@mokei/host-node": patch
"@mokei/flow-host-node": patch
---

Breaking: `ContextClient` no longer declares the Tasks extension by default. Pass `tasks: true` (also accepted by `ContextHost`, `NodeContextHost` and `createHostedContext`) to receive task results, as the MCP extensions spec requires explicit opt-in.

Extensions are described by a registry in `@mokei/context-protocol` (`EXTENSIONS`, `readExtension`). A peer declaring an extension with an unknown settings `revision` is treated as not supporting it. `ContextClient.getServerExtension()` reads the server's declared extensions. Extensions now negotiate through `initialize` on `2025-11-25` where an extension supports that revision.
```

  Add any other package touched in Task 4 (e.g. `@mokei/decision-flow-server`, `@mokei/flow-host`) to the frontmatter.
- [ ] **Step 2: Update** the docs listed above.
- [ ] **Step 3: Run** `rtk proxy pnpm run lint` — expect clean.
- [ ] **Step 4: Commit** `docs: extension registry and Tasks opt-in`.
