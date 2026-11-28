# Extension Packages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Stage:** executing
**Mode:** tasks

**Goal:** Give the core server and client generic `@internal` extension hooks, and move all Skills behaviour out of `context-{protocol,server,server-node,client}` into four new `@mokei/extension-skills*` packages, without changing any behaviour on the wire.

**Architecture:**
- **Core hooks:**
  - `ContextServer` takes `extensions: Array<ServerExtension>`. These are handler maps, a resource provider, scopes, cache hints and a capability contribution.
  - `ContextClient` takes `extensions: Array<ExtensionDefinition | {definition, settings?}>` and exports `@internal` helpers that wrapper packages call.
- **Skills moves into new packages:**
  - shared format helpers in `@mokei/extension-skills`;
  - the catalog and server extension in `-server`;
  - the verifying wrapper in `-client`;
  - the disk loader in `-node`.
- **Wire schemas stay** in `@mokei/context-protocol`.

**Tech Stack:** TypeScript (ESM, NodeNext), pnpm workspace, swc + tsc builds, vitest, biome.

**Spec:** `docs/superpowers/specs/2026-11-28-extension-packages-design.md`

## Global Constraints

- **Behaviour is unchanged on the wire.** Errors, gating, cache hints, scopes and verification behave exactly as on the branch before this plan. The moved tests are the proof, so assertions move unchanged; only imports and setup change.
- **Wire schemas stay in `@mokei/context-protocol`.** That covers `skills.ts`, `SKILLS`, `SKILLS_EXTENSION`, `procedure.ts`, the `versions/2026-07-28.ts` wiring, `http-headers.ts` and `server.ts`.
- **Hooks are `@internal`.**
  - Every new hook export carries `@internal` in its TSDoc and is not documented in READMEs as a public API.
  - Extension packages never copy core logic (paging, gating, cache-hint application). They call the core exports.
- **Core gating stays in core.**
  - An extension never skips or re-implements the "enabled, on this revision, declared by the peer" check.
  - Extensions are matched by `definition.id`, not object identity.
- **Package layout** is in the table below. No subpath exports. Only `-node` may use `node:` modules.
- **New packages** copy `packages/context-server-node`'s `package.json` scripts and fields, `tsconfig.json` (without `types: ["node"]` for the portable ones) and `tsconfig.test.json`.
  - The version is `0.16.2`.
  - `description` is one line; `repository.directory` matches the folder.
  - Dependencies are `workspace:^` for `@mokei/*` and `catalog:` for third-party.
  - Each package has `README.md` and `src/index.ts` with a `@module` TSDoc header.
- **Commands.**
  - Lint: `rtk proxy pnpm run lint`.
  - Build: `rtk proxy pnpm run build`.
  - Tests per package: `pnpm --filter <pkg> test`.
  - pnpm only. pnpm install, build, test and commit need the sandbox disabled (store lock; http-server binds ports).
- **Rebuild dependency `lib/` before dependent tests.** Cross-package tests import built `lib/`, so rebuild in this order: protocol → server/client → extension packages.
- **Commits** are Conventional Commits and end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01P6ASyxpPboP9pEXvhS9irB
  ```
- **No local paths in committed docs.** Never write `docs/superpowers/`, `.superpowers/`, `/Users/`, worktree or scratchpad paths in READMEs, architecture docs or changesets.

| Package | Contents | Dependencies |
|---|---|---|
| `@mokei/extension-skills` | the shared format helpers (`skill-format.ts`) | `@mokei/context-protocol`, `yaml` |
| `@mokei/extension-skills-server` | the catalog and `skillsServerExtension` | `@mokei/extension-skills`, `@mokei/context-protocol`, `@mokei/context-server`, `@mokei/context-rpc`, `@sozai/codec` |
| `@mokei/extension-skills-client` | `createSkillsClient` and verification | `@mokei/extension-skills`, `@mokei/context-protocol`, `@mokei/context-client`, `@sozai/codec`; dev: `@mokei/extension-skills-server`, `@mokei/context-server` |
| `@mokei/extension-skills-node` | the disk loader | `@mokei/extension-skills`, `@mokei/extension-skills-server`; dev: `@types/node` |

## Review Focus

1. **A server with both a user `resources` handler and the Skills extension.** A `skill://` URI goes to the catalog; any other URI reaches the user handler. `resources/list` returns only the user's list. *Covered in Task 1, test `provider owns its URIs and leaves others to resources handler`.*
2. **Two copies of `SKILLS`** (a structurally equal definition object that isn't `===` the registry's). It is still enabled and gated as the same extension. *Covered in Tasks 1 and 2, tests `matches extensions by id`.*
3. **An extension method whose extension is configured but has no handler** (`resources/directory/read` with `directoryRead` off). It returns `METHOD_NOT_FOUND`, never reaches the core `switch`, and never returns `-32602`. *Covered in Task 1, test `extension method without handler is METHOD_NOT_FOUND`, and Task 4's moved test.*
4. **Tasks unaffected.** A server with `tasks` and no `extensions` keeps answering `tasks/get`; the new no-handler rule doesn't touch registry entries that aren't in `extensions`. *Covered in Task 1, test `tasks keep core handling`.*
5. **A client built without `extensions: [SKILLS]` and wrapped by `createSkillsClient`.** Every wrapper method rejects before sending, with the same error the local gate threw before (`MethodNotInRevisionError` or whatever `#refuseUndeclaredDefinition` throws). *Covered in Task 5's moved test.*

---

### Task 1: Server extension hook in `@mokei/context-server`

**Files:**
- Create: `packages/context-server/src/extension.ts`
- Modify: `packages/context-server/src/server.ts`, `packages/context-server/src/cache.ts`, `packages/context-server/src/index.ts`
- Test: `packages/context-server/test/extension-hook.test.ts` (new); `packages/context-server/test/extensions.test.ts` (the `_extensions` case that claims `logging/setLevel`, near line 213)

Skills stays wired as it is in this task: `skills` option, `#skills` and cases unchanged. The hook is added alongside, and Task 4 moves Skills onto it.

**Interfaces:**
- Produces, in `extension.ts`, all exported from `index.ts` and marked `@internal`:
  ```ts
  export type ExtensionMethodHandler = (request: ExtensionHandlerRequest) => unknown | Promise<unknown>
  export type ExtensionHandlerRequest = HandlerRequest<{ client: ServerClient; params: Record<string, unknown> }>
  // HandlerRequest's existing fields: signal, meta, auth, MRTR context
  export type ResourceProvider = {
    owns(uri: string): boolean
    read(uri: string): ReadResourceResult['contents'][number] // throws RPCError INVALID_PARAMS when not found
  }
  export type ServerExtension = {
    definition: ExtensionDefinition
    settings?: Record<string, unknown>
    handlers: Partial<Record<string, ExtensionMethodHandler>>
    resources?: ResourceProvider
    capabilities?: { resources?: true }
    cache?: CacheHints
    scopes?: ReadonlyArray<string>
  }
  ```
- `ServerConfig.extensions?: ReadonlyArray<ServerExtension>`. The test-only `_extensions` is kept as is.
- `CACHEABLE_METHODS` stays exported for the core methods. `applyCacheHints(method, result, hints, extraMethods?)`, or an equivalent, lets the server pass the configured extensions' method names. Core's set loses `skills/list`, `skills/get` and `resources/directory/read` in Task 4, not here.

- [ ] **Step 1: Write failing tests** in `test/extension-hook.test.ts`. They use a fake definition passed through `_registry`. The definition claims a real wire method the core `switch` does not handle on `2026-07-28` with `clientDeclaration: 'none'`; use `skills/list` with a fake id `test/ext`, so the inbound validators accept it.
  - `dispatches an extension method to its handler`: `skills/list` returns the handler's value, with cache hints applied (`ttlMs` and `cacheScope` present on `2026-07-28`).
  - `extension method without handler is METHOD_NOT_FOUND`: a fake definition claiming `skills/list` and `skills/get` with only a `skills/list` handler. `skills/get` gives error code `-32601`.
  - `declares the extension with its settings`: `server/discover` lists `extensions['test/ext']` equal to `settings`.
  - `capabilities.resources gives resources: {} without a resources param`: then `resources/list` gives `{resources: []}`, `resources/templates/list` gives `{resourceTemplates: []}`, and `resources/read` of an unowned URI gives `-32602` with message `Resource not found: <uri>`.
  - `provider owns its URIs and leaves others to resources handler`: an owned `test://a` is answered by the provider; `file:///x` by the user handler; `resources/list` is the user's.
  - `scopes and cache replace the server's for extension requests`: `requiredScopes({method:'skills/list'})` equals the extension's `scopes`, or `[]` when unset, even when server-wide scopes exist. The same holds for `resources/read` of an owned URI. The extension's `cache.ttlMs` overrides the server's; an unset field falls back to the server's.
  - `matches extensions by id`: the definition passed in `extensions` is a structural copy (`{...def}`) of the one in `_registry`. Dispatch still works.
  - `rejects duplicate extension ids`: the constructor throws `Error` with a message containing the id.
  - `tasks keep core handling`: a server with `tasks` and an unrelated extension still answers `tasks/get` for an unknown id with the existing error, not `METHOD_NOT_FOUND`.
- [ ] **Step 2: Run** `pnpm --filter @mokei/context-server exec vitest run test/extension-hook.test.ts`. Expected: FAIL (`extensions` is ignored).
- [ ] **Step 3: Implement.**
  - Key `#extensions` by `definition.id`, holding `{definition, settings}`, and update every lookup, including the gate in `_handleRequest`.
  - Store `ServerExtension`s in `#serverExtensions: Map<string, ServerExtension>`.
  - Gate order: the existing registry checks first. Then, when the method's definition id is in `#serverExtensions` and has no handler, return `METHOD_NOT_FOUND`.
  - Dispatch before the core `switch`:
    1. the extension handler;
    2. `resources/read` to the first provider whose `owns(uri)` is true, in `extensions` order;
    3. the "providers only, no `resources` param" fallbacks.
  - Generalise `#isCatalogRequest` into `#extensionFor(request): ServerExtension | undefined`, used by `requiredScopes` and `#cacheFor`.
- [ ] **Step 4: Rewrite the `_extensions` case in `test/extensions.test.ts`** that claims `logging/setLevel`, so it still asserts what it meant to (a test-only definition is declared and gated) under the id-keyed map.
- [ ] **Step 5: Run** `pnpm --filter @mokei/context-server test`. Expected: all pass, including the existing `test/skills.test.ts`.
- [ ] **Step 6: Commit** `feat(context-server): internal extension hook`.

### Task 2: Client extension option and internal helpers in `@mokei/context-client`

**Files:**
- Create: `packages/context-client/src/extension.ts`
- Modify: `packages/context-client/src/client.ts`, `packages/context-client/src/types.ts`, `packages/context-client/src/index.ts`
- Test: `packages/context-client/test/extension-hook.test.ts` (new)

Skills stays on the client in this task: `skills: true` and its methods unchanged. Task 5 removes them.

**Interfaces:**
- `ClientParams.extensions?: ReadonlyArray<ExtensionDefinition | { definition: ExtensionDefinition; settings?: Record<string, unknown> }>`. Each entry is declared like `_extensions`, which stays test-only. The client `#extensions` map is keyed by `definition.id`.
- Exported from `index.ts`, all `@internal`:
  ```ts
  export function requireClientExtension(
    client: ContextClient, definition: ExtensionDefinition, method: string, options?: RequestOptions,
  ): Promise<Record<string, unknown>>
  // awaits setup, runs #refuseUndeclaredDefinition, then #requireServerExtensionAsync; returns server settings

  export function listPaged(
    client: ContextClient, method: string, key: string,
    send: (params: Record<string, unknown>, options: RequestOptions) => Promise<PagedResult>,
    listParams: ListParams<Record<string, unknown>>,
  ): Promise<PagedResult>
  // the existing #listPaged
  ```
  Also exported: the `PagedResult` type, and `splitRequestOptions` / `splitListOptions` if not exported already. `ExtensionNotDeclaredError` is already exported.
- Implement both as module functions in `extension.ts`. They reach private members through accessors that `ContextClient` installs in a `static {}` block, assigning module-scoped functions declared in `client.ts`. Don't make the members public.

- [ ] **Step 1: Write failing tests.** Use a fake server (the `fake` helper pattern in `test/skills.test.ts`) and a fake definition through `_registry` claiming `skills/list`.
  - `extensions option declares the extension per request`: the outgoing `_meta` capabilities carry `extensions['test/ext']`.
  - `requireClientExtension refuses an extension not enabled locally`: it throws the same error type as `#refuseUndeclaredDefinition`, and nothing is sent.
  - `requireClientExtension refuses when the server did not declare it`: `ExtensionNotDeclaredError`.
  - `requireClientExtension returns server settings`: deep-equals the server's declared settings.
  - `listPaged walks pages`: two pages concatenated; with `cursor` set, a single page.
  - `matches extensions by id`: a structural copy of the definition in `extensions` works.
- [ ] **Step 2: Run** `pnpm --filter @mokei/context-client exec vitest run test/extension-hook.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** as above. `listSkills` and the other client methods switch to the shared internals, with no duplication.
- [ ] **Step 4: Run** `pnpm --filter @mokei/context-client test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(context-client): extensions option and internal extension helpers`.

### Task 3: `@mokei/extension-skills` package (format helpers)

**Files:**
- Create: `packages/extension-skills/{package.json,README.md,tsconfig.json,tsconfig.test.json,src/index.ts}`
- Move with `git mv`: `packages/context-protocol/src/skill-format.ts` → `packages/extension-skills/src/skill-format.ts`, and `packages/context-protocol/test/skill-format.test.ts` → `packages/extension-skills/test/skill-format.test.ts`
- Modify:
  - `packages/context-protocol/src/index.ts`: drop the `skill-format.js` exports.
  - `packages/context-protocol/package.json`: drop `yaml`.
  - `packages/context-protocol/tsconfig.json`: drop the `dom` lib only if nothing else needs it.
  - Every importer of the moved helpers in `context-server/src`, `context-server-node/src`, `context-client/src` and their tests: import from `@mokei/extension-skills`, and add it as a `workspace:^` dependency. This is temporary; Tasks 4–5 remove it.

**Interfaces:**
- Produces: `@mokei/extension-skills` exports exactly what `context-protocol` exported from `skill-format.js` before, with the same names and signatures.

- [ ] **Step 1: Scaffold the package** per Global Constraints. Deps: `@mokei/context-protocol`, `yaml` (`catalog:` if the catalog has it, otherwise the same range protocol used).
- [ ] **Step 2: Move the files and rewire imports.** Run `pnpm install` (sandbox disabled).
- [ ] **Step 3: Verify** `rg "skill-format|SkillFormatError|parseSkillFrontmatter" packages/context-protocol/src` returns nothing.
- [ ] **Step 4: Build and test.**
  - Run `rtk proxy pnpm run build`.
  - Run `pnpm --filter @mokei/extension-skills test`, `pnpm --filter @mokei/context-protocol test`, `pnpm --filter @mokei/context-server test`, `pnpm --filter @mokei/context-server-node test` and `pnpm --filter @mokei/context-client test`.
  - Expected: all pass; the protocol test count drops by the moved tests.
- [ ] **Step 5: Commit** `refactor: move skill format helpers to @mokei/extension-skills`.

### Task 4: `@mokei/extension-skills-server` and `-node`; Skills leaves the server packages

**Files:**
- Create: `packages/extension-skills-server/{package.json,README.md,tsconfig.json,tsconfig.test.json,src/index.ts,src/extension.ts}` and `packages/extension-skills-node/{package.json,README.md,tsconfig.json,tsconfig.test.json,src/index.ts}`
- Move with `git mv`:
  - `context-server/src/skill-catalog.ts` → `extension-skills-server/src/skill-catalog.ts`
  - `context-server/test/skill-catalog.test.ts` and `context-server/test/skills.test.ts` → `extension-skills-server/test/`
  - `context-server-node/src/skills.ts` → `extension-skills-node/src/skills.ts`
  - `context-server-node/test/skills.test.ts` → `extension-skills-node/test/`
- Modify:
  - `context-server/src/server.ts`: remove the `skills` option, `SKILL_METHODS`, `SKILL_URI_PREFIX`, `#skills`, `#isCatalogRequest`, `#readCatalogFile`, the `skills/*` and `resources/directory/read` cases, the `directoryRead` special gate, and the skills-only `resources` branches now covered by the hook.
  - `context-server/src/cache.ts`: drop the three Skills methods.
  - `context-server/src/index.ts`: drop the catalog exports.
  - `context-server/package.json`: drop `@sozai/codec` and `@mokei/extension-skills` if unused.
  - `context-server-node/src/index.ts`, `package.json`, `README.md`: back to `serveProcess` only.

**Interfaces:**
- Consumes: Task 1's `ServerExtension`, `ResourceProvider` and `ExtensionMethodHandler`; Task 3's helpers.
- Produces:
  - `@mokei/extension-skills-server` exports what `context-server` exported for the catalog before (`createSkillCatalog`, `SkillCatalog`, `SkillDefinition`, `SkillCatalogOptions`, `SkillFileContents`, …), plus:
    ```ts
    export function skillsServerExtension(catalog: SkillCatalog): ServerExtension
    ```
    `skillsServerExtension` returns:
    - `definition`: `SKILLS`;
    - `settings`: `{directoryRead: true}` or `undefined`;
    - `handlers`: `skills/list`, `skills/get`, and `resources/directory/read` only when `catalog.directoryRead`;
    - `resources`: owns URIs starting with `skill://` and reads via `catalog.getFile`;
    - `capabilities`: `{resources: true}`;
    - `cache`: `catalog.cache`;
    - `scopes`: `catalog.scopes`.

    Errors and messages are byte-identical to the old server cases: `No skill is served at <uri>`, `<uri> is not a directory resource`, `Resource not found: <uri>`, all `-32602`, built with `RPCError` from `@mokei/context-rpc`.
  - `@mokei/extension-skills-node` exports `loadSkillDefinitions` and `loadSkillCatalog`, unchanged.

- [ ] **Step 1: Scaffold both packages** (deps per the table). Move the files. In the moved `skills.test.ts`, replace `new ContextServer({..., skills: catalog})` with `extensions: [skillsServerExtension(catalog)]`. Leave the assertions unchanged.
- [ ] **Step 2: Run** `pnpm --filter @mokei/extension-skills-server test`. Expected: FAIL (`skillsServerExtension` is missing).
- [ ] **Step 3: Implement** `skillsServerExtension` in `src/extension.ts`, then remove Skills from `context-server` and `context-server-node` as listed above.
- [ ] **Step 4: Verify core is clean.** `rg -i "skill" packages/context-server/src packages/context-server-node/src` should return nothing. `rg "@sozai/codec" packages/context-server/src` should return nothing before the dependency is dropped.
- [ ] **Step 5: Build and test.**
  - Run `rtk proxy pnpm run build`.
  - Run `pnpm --filter @mokei/extension-skills-server test`, `pnpm --filter @mokei/extension-skills-node test`, `pnpm --filter @mokei/context-server test`, `pnpm --filter @mokei/context-server-node test` and `pnpm --filter @mokei/context-client test`.
  - The client tests use a catalog. Switch their setup to `@mokei/extension-skills-server` (devDependency) now, keeping assertions.
  - Expected: all pass, and the moved test counts match the old ones.
- [ ] **Step 6: Commit** `refactor: move skills server support to @mokei/extension-skills-server and -node`.

### Task 5: `@mokei/extension-skills-client`; Skills leaves the client

**Files:**
- Create: `packages/extension-skills-client/{package.json,README.md,tsconfig.json,tsconfig.test.json,src/index.ts,src/client.ts}`
- Move with `git mv`: `context-client/src/skill-verification.ts` → `extension-skills-client/src/skill-verification.ts`; `context-client/test/skills.test.ts` → `extension-skills-client/test/skills.test.ts`
- Modify:
  - `context-client/src/client.ts`: remove the `skills` option handling, `#requireSkills`, `listSkills`, `getSkill`, `readResourceDirectory`, `readSkillFile`, and the Skills imports.
  - `context-client/src/types.ts`: drop `skills?: boolean`.
  - `context-client/src/index.ts`: drop `SkillVerificationError`, `checkSkillEntry`, `SkillFile` and the reason/params types.
  - `context-client/package.json`: drop `@sozai/codec` and `@mokei/extension-skills` if unused, and the `-server` devDependency if no core test needs it.

**Interfaces:**
- Consumes: Task 2's `requireClientExtension`, `listPaged` and `PagedResult`; Task 3's helpers.
- Produces:
  ```ts
  export type SkillsClient = {
    listSkills(params?: ListParams<ListSkillsRequest['params']>): Promise<ListSkillsResult>
    getSkill(uri: string, options?: RequestOptions): Promise<GetSkillResult>
    readResourceDirectory(/* same signature as the removed ContextClient method */): Promise<…>
    readSkillFile(/* same signature as the removed ContextClient method */): Promise<SkillFile>
  }
  export function createSkillsClient(client: ContextClient): SkillsClient
  ```
  Also exported: `checkSkillEntry`, `SkillFile`, `SkillVerificationError`, `SkillVerificationErrorParams`, `SkillVerificationReason`. Method bodies keep the same checks and the same order. `readResourceDirectory` still throws `ExtensionNotDeclaredError` with `extension: 'io.modelcontextprotocol/skills#directoryRead'` when the server lacks `directoryRead`.

- [ ] **Step 1: Scaffold the package** (deps per the table) and move the files. In the moved test:
  - clients are built with `extensions: [SKILLS]` instead of `skills: true`;
  - calls go through `createSkillsClient(client)`;
  - servers use `skillsServerExtension`.

  Leave the assertions unchanged, including the property test.
- [ ] **Step 2: Run** `pnpm --filter @mokei/extension-skills-client test`. Expected: FAIL (`createSkillsClient` is missing).
- [ ] **Step 3: Implement** `createSkillsClient` in `src/client.ts`, using only `client.request`, `requireClientExtension`, `listPaged` and the format helpers. Then remove Skills from `context-client`.
- [ ] **Step 4: Verify core is clean.** `rg -i "skill" packages/context-client/src` should return nothing, and neither should `rg "@sozai/codec" packages/context-client/src`.
- [ ] **Step 5: Build and test.**
  - Run `rtk proxy pnpm run build`.
  - Run `pnpm --filter @mokei/extension-skills-client test` and `pnpm --filter @mokei/context-client test`.
  - Expected: all pass, and the moved test count matches the old one.
- [ ] **Step 6: Commit** `refactor: move skills client support to @mokei/extension-skills-client`.

### Task 6: Docs, changeset and the final check

**Files:**
- Modify:
  - `packages/context-server/README.md` and `packages/context-client/README.md`: move the Skills sections out, leaving one line each pointing to the extension package.
  - `packages/context-server-node/README.md`
  - `packages/extension-skills*/README.md`: usage per package, as in the spec's usage block, split by side.
  - `docs/agents/architecture.md`: the Skills paragraph and an "Extension packages" paragraph. Hooks are `@internal`, schemas stay in protocol, and the layout is `extension-<name>` plus `-server`, `-client` and `-node`. Keep the generic "Extensions are advertised per revision" paragraph where it is.
  - `docs/agents/plans/backlog/2026-11-25-mcp-extensions.md`: the item 3 text names the new packages; items 4 and 5 say they are to be built as extension packages on the internal hooks.
  - `.changeset/skills-extension.md`: rewrite it for the final layout. List the new packages and the patched core packages: context-protocol (helpers removed, schemas kept), context-server (`extensions` hook), context-server-node (no change, so leave it out), context-client (`extensions` option). Name `createSkillsClient` and `skillsServerExtension`. Don't use "moved" wording, since nothing has been released.
  - Root `README.md`: only if it lists packages; add the four.

- [ ] **Step 1: Make the doc edits.** Then `rg "docs/superpowers|\.superpowers|/Users/" packages/*/README.md docs/agents .changeset` should return nothing.
- [ ] **Step 2: Run the full gate** (sandbox disabled): `rtk proxy pnpm run build`, `rtk proxy pnpm run lint`, `rtk proxy pnpm run --no-bail -r test`. Expected: all pass. Report any failure verbatim.
- [ ] **Step 3: Run the core weight check.**
  - `rg -il "skill" packages/context-server/src packages/context-server-node/src packages/context-client/src` should return nothing.
  - In `packages/context-protocol/src`, only `skills.ts`, `extensions.ts`, `procedure.ts`, `server.ts`, `http-headers.ts`, `index.ts` and `versions/2026-07-28.ts` should match.
  - `yaml` should be absent from `context-protocol/package.json`.
- [ ] **Step 4: Commit** `docs: extension packages for skills`.
