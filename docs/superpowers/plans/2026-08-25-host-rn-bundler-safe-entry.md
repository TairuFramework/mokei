# RN/Metro-safe `@mokei/host` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@mokei/host` and `@mokei/context-server` bundle under React Native / Metro (Hermes) by moving all Node-only child-process/stdio/daemon code into two new sibling packages, `@mokei/host-node` and `@mokei/context-server-node`.

**Architecture:** Split the Node stdio layer out of two barrels. The generic `ContextHost` (direct + HTTP contexts) stays in the now-RN-safe `@mokei/host`; `NodeContextHost extends ContextHost` adds the one child-process method (`addLocalContext`) in `@mokei/host-node`, alongside the daemon (`createClient`/`runDaemon`), `ProxyHost`, and `spawnHostedContext`. Symmetrically, `serveProcess` moves from `@mokei/context-server` into `@mokei/context-server-node`. Node consumers stay byte-identical; the RN `ContextHost` simply lacks `addLocalContext` at the type level.

**Tech Stack:** TypeScript (NodeNext ESM), pnpm workspaces + catalog, swc (build:js), tsc (build:types / test:types), vitest, biome. Build via `pnpm build`; per-package `swc src -d ./lib` + `tsc --emitDeclarationOnly`.

**Spec:** `docs/superpowers/specs/2026-08-25-host-rn-bundler-safe-entry-design.md`

## Global Constraints

- **Package manager:** `pnpm` / `pnpx` only — never `npm` / `npx`.
- **Lint/format:** run as `rtk proxy pnpm run lint` (the machine's `rtk` shim otherwise hijacks `pnpm run lint` / `find`). Invoke build tools directly where possible.
- **No behavior change:** every moved unit (spawn, daemon, `serveProcess`, `ProxyHost`, `addLocalContext` framing-fault handling) is relocated verbatim — same logic, same comments. The only new failure mode is a *compile-time* error when RN code calls `addLocalContext` on the RN `ContextHost`.
- **Two new packages** both go in `versioning.fixed` in `pnpm-workspace.yaml` and release in lockstep. Adding packages was explicitly approved.
- **Release:** this is a **major** bump. Record the intent per the `kigu:releasing` skill; do not auto-publish.
- **New-package deps** use `catalog:` for third-party (already in the catalog) and `workspace:^` for `@mokei/*`.
- **Acceptance gate is a real bundle resolution check**, not just types (Task 6).

---

## File Structure

**`@mokei/context-server` (trimmed, RN-safe)**
- Modify `packages/context-server/src/server.ts` — remove `serveProcess` and its `@enkaku/node-streams` import.
- Modify `packages/context-server/src/index.ts` — drop the `serveProcess` re-export.
- Modify `packages/context-server/package.json` — drop `@enkaku/node-streams` dependency.

**`@mokei/context-server-node` (new)**
- Create `packages/context-server-node/{package.json,tsconfig.json,tsconfig.test.json,src/index.ts,src/serve.ts}`.

**`@mokei/host` (trimmed, RN-safe)**
- Modify `packages/host/src/host.ts` — remove the node-streams + spawn imports, the two spawn constants, `SpawnHostedContextParams`, `spawnHostedContext`, `AddLocalContextParams`, and the `addLocalContext` method.
- Modify `packages/host/src/index.ts` — drop daemon, `ProxyHost`, `spawnHostedContext`, spawn-type, and `AddLocalContextParams` re-exports.
- Delete `packages/host/src/{daemon.ts,server.ts,proxy.ts,spawn.ts,utils.ts}` (moved).
- Modify `packages/host/package.json` — drop `@enkaku/node-streams`, `@enkaku/server`, `@tejika/process`, `nano-spawn`, `@mokei/host-protocol`.

**`@mokei/host-node` (new)**
- Create `packages/host-node/{package.json,tsconfig.json,tsconfig.test.json,src/index.ts}`.
- Create `packages/host-node/src/node-host.ts` — `NodeContextHost`, `spawnHostedContext`, param types, constants.
- Move `packages/host/src/{daemon.ts,server.ts,proxy.ts,spawn.ts,utils.ts}` → `packages/host-node/src/`.

**Consumers**
- `packages/cli/src/{commands/inspect.tsx,commands/monitor.tsx,commands/proxy.ts,chat/providers.ts}` — retarget node imports to `@mokei/host-node`.
- `packages/session/src/session.ts` — use `NodeContextHost` from `@mokei/host-node`.
- `integration-tests/suites/{host.test.ts,version-detection-stdio.test.ts,interop-sdk-server.test.ts}` — retarget.
- `mcp-servers/{sqlite,fetch}/src/serve.ts` + `packages/host/test/fixtures/{echo-server,structured-server}.mjs` — `serveProcess` → `@mokei/context-server-node`.
- `pnpm-workspace.yaml` — add both packages to `versioning.fixed`.
- Docs: `docs/guides/server.md`, `packages/context-server/README.md`.

**Verification**
- Create `packages/host/test/rn-bundle.test.ts` — static import-graph walk asserting the RN barrels reach no banned specifier.

---

## Task 1: Split `@mokei/context-server-node` out with `serveProcess`

**Files:**
- Create: `packages/context-server-node/package.json`
- Create: `packages/context-server-node/tsconfig.json`
- Create: `packages/context-server-node/tsconfig.test.json`
- Create: `packages/context-server-node/src/serve.ts`
- Create: `packages/context-server-node/src/index.ts`
- Modify: `packages/context-server/src/server.ts` (remove `serveProcess` + node-streams import)
- Modify: `packages/context-server/src/index.ts` (drop `serveProcess` export)
- Modify: `packages/context-server/package.json` (drop `@enkaku/node-streams`)
- Modify: `pnpm-workspace.yaml` (add to `versioning.fixed`)

**Interfaces:**
- Produces: `@mokei/context-server-node` exporting `serveProcess(config: ServerConfig): ContextServer`.
- Consumes: `ContextServer`, `ServerConfig`, and the message types from `@mokei/context-server`.

- [ ] **Step 1: Scaffold the new package.** Create `packages/context-server-node/package.json` (mirror the sibling `@mokei/host-protocol`, version `0.12.0` to match the fixed group's current version):

```json
{
  "name": "@mokei/context-server-node",
  "version": "0.12.0",
  "description": "Mokei Context server Node stdio entry",
  "keywords": ["model", "context", "protocol", "mcp", "server", "llm", "ai"],
  "homepage": "https://mokei.dev",
  "repository": {
    "type": "git",
    "url": "https://github.com/TairuFramework/mokei",
    "directory": "packages/context-server-node"
  },
  "license": "MIT",
  "sideEffects": false,
  "type": "module",
  "exports": { ".": "./lib/index.js" },
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "files": ["lib/*"],
  "scripts": {
    "build": "pnpm run build:clean && pnpm run build:js && pnpm run build:types",
    "build:clean": "del lib",
    "build:js": "swc src -d ./lib --config-file ../../node_modules/@kigu/dev/swc.json --strip-leading-paths",
    "build:types": "tsc --emitDeclarationOnly --skipLibCheck",
    "build:types:ci": "tsc --emitDeclarationOnly --skipLibCheck --declarationMap false",
    "prepublishOnly": "pnpm run build",
    "test": "pnpm run test:types",
    "test:types": "tsc --noEmit --skipLibCheck"
  },
  "dependencies": {
    "@enkaku/node-streams": "catalog:",
    "@mokei/context-protocol": "workspace:^",
    "@mokei/context-server": "workspace:^"
  },
  "devDependencies": {
    "@types/node": "catalog:"
  }
}
```

- [ ] **Step 2: Add the two tsconfig files.** `packages/context-server-node/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.build.json",
  "compilerOptions": {
    "lib": ["es2025", "dom"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./lib",
    "rootDir": "./src",
    "types": ["node"]
  },
  "include": ["./src/**/*"]
}
```

`packages/context-server-node/tsconfig.test.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "..",
    "resolveJsonModule": true
  },
  "include": ["./src/**/*"]
}
```

- [ ] **Step 3: Write `serve.ts` with the moved `serveProcess`.** Copy the body verbatim from `packages/context-server/src/server.ts:611-616`, importing `ContextServer`/`ServerConfig` and the message types from the barrel:

```ts
import { NodeStreamsTransport } from '@enkaku/node-streams'
import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import { ContextServer, type ServerConfig } from '@mokei/context-server'

/**
 * Create a Context server communicating over the process's stdio streams.
 */
export function serveProcess(config: ServerConfig): ContextServer {
  const transport = new NodeStreamsTransport<ClientMessage, ServerMessage>({
    streams: { readable: process.stdin, writable: process.stdout },
  })
  return new ContextServer({ ...config, transport })
}
```

Confirm the `streams` argument matches the original (`packages/context-server/src/server.ts:611-615`); reproduce it exactly if it differs.

- [ ] **Step 4: Write `index.ts`.** `packages/context-server-node/src/index.ts`:

```ts
/**
 * Mokei Context server Node stdio entry.
 *
 * @module context-server-node
 */

export { serveProcess } from './serve.js'
```

- [ ] **Step 5: Remove `serveProcess` from `@mokei/context-server`.** In `packages/context-server/src/server.ts` delete line 1 (`import { NodeStreamsTransport } from '@enkaku/node-streams'`) and the whole `serveProcess` function (lines 611-616). In `packages/context-server/src/index.ts`, remove `serveProcess,` from the `./server.js` export block (the block currently reads `ContextServer, type ServerConfig, type ServerEvents, type ServerParams, serveProcess`).

- [ ] **Step 6: Drop the dependency.** In `packages/context-server/package.json` remove the `"@enkaku/node-streams": "catalog:"` line. Verify nothing else in `packages/context-server/src` imports it: `grep -rn "node-streams" packages/context-server/src` must return nothing.

- [ ] **Step 7: Add both new packages to fixed versioning now (do it once).** In `pnpm-workspace.yaml`, inside `versioning.fixed`'s single group array, add `- '@mokei/context-server-node'` and `- '@mokei/host-node'` (alphabetical placement: after `@mokei/context-server`, and after `@mokei/host` respectively).

- [ ] **Step 8: Install and build the touched packages.**

Run: `pnpm install`
Then: `pnpm --filter @mokei/context-server --filter @mokei/context-server-node build`
Expected: both build clean.

- [ ] **Step 9: Assert the RN barrel is clean.**

Run: `grep -rn "node-streams" packages/context-server/lib || echo CLEAN`
Expected: `CLEAN`.

- [ ] **Step 10: Type-check.**

Run: `pnpm --filter @mokei/context-server --filter @mokei/context-server-node test:types`
Expected: PASS.

- [ ] **Step 11: Commit.**

```bash
git add packages/context-server-node packages/context-server pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat: extract @mokei/context-server-node with serveProcess"
```

---

## Task 2: Retarget `serveProcess` consumers

**Files:**
- Modify: `mcp-servers/sqlite/src/serve.ts:4`
- Modify: `mcp-servers/fetch/src/serve.ts:2`
- Modify: `mcp-servers/sqlite/package.json`, `mcp-servers/fetch/package.json`
- Modify: `packages/host/test/fixtures/echo-server.mjs:1`, `packages/host/test/fixtures/structured-server.mjs:1`
- Modify: `docs/guides/server.md`, `packages/context-server/README.md`

**Interfaces:**
- Consumes: `serveProcess` from `@mokei/context-server-node` (Task 1). `createTool` / `type ToolDefinitions` stay imported from `@mokei/context-server`.

- [ ] **Step 1: Update the mcp-servers.** In `mcp-servers/sqlite/src/serve.ts` and `mcp-servers/fetch/src/serve.ts`, split the import: keep `createTool` (and any other RN-safe names) from `@mokei/context-server`, and import `serveProcess` from `@mokei/context-server-node`. Example (sqlite):

```ts
import { serveProcess } from '@mokei/context-server-node'
// keep other @mokei/context-server imports (createTool, types) as-is
```

Add `"@mokei/context-server-node": "workspace:^"` to each of `mcp-servers/sqlite/package.json` and `mcp-servers/fetch/package.json` dependencies.

- [ ] **Step 2: Update the host test fixtures.** In `packages/host/test/fixtures/echo-server.mjs` and `structured-server.mjs`, change `import { createTool, serveProcess } from '@mokei/context-server'` to import `createTool` from `@mokei/context-server` and `serveProcess` from `@mokei/context-server-node`.

- [ ] **Step 3: Update docs.** In `docs/guides/server.md` and `packages/context-server/README.md`, change every `serveProcess` import example from `@mokei/context-server` to `@mokei/context-server-node` (leave `createTool` / `inputRequired` / type imports on `@mokei/context-server`).

- [ ] **Step 4: Install, build, and run the host + mcp-server tests.**

Run: `pnpm install`
Then: `pnpm --filter @mokei/mcp-sqlite --filter @mokei/mcp-fetch build`
Then: `pnpm --filter @mokei/host test:unit`
Expected: fixtures spawn and the host suite passes (this exercises the moved `serveProcess` end-to-end over stdio).

- [ ] **Step 5: Commit.**

```bash
git add mcp-servers packages/host/test/fixtures docs/guides/server.md packages/context-server/README.md pnpm-lock.yaml
git commit -m "refactor: point serveProcess consumers at @mokei/context-server-node"
```

---

## Task 3: Create `@mokei/host-node` and move the Node-only host code

This is the atomic host split: `@mokei/host` is trimmed and `@mokei/host-node` is created in the same task, because the moved code cannot leave `@mokei/host` in a compiling state on its own.

**Files:**
- Create: `packages/host-node/{package.json,tsconfig.json,tsconfig.test.json}`
- Create: `packages/host-node/src/{index.ts,node-host.ts}`
- Move: `packages/host/src/{daemon.ts,server.ts,proxy.ts,spawn.ts,utils.ts}` → `packages/host-node/src/`
- Modify: `packages/host/src/host.ts`, `packages/host/src/index.ts`, `packages/host/package.json`

**Interfaces:**
- Consumes from `@mokei/host`: `ContextHost`, `createHostedContext`, `HostedContext`, `CreateContextParams`, all context/tool types.
- Produces (`@mokei/host-node` barrel):
  - `class NodeContextHost extends ContextHost` with `addLocalContext<T>(params: AddLocalContextParams): Promise<ContextClient<T>>`
  - `spawnHostedContext<T>(params: SpawnHostedContextParams): Promise<HostedContext<T>>`, `type SpawnHostedContextParams`, `type AddLocalContextParams`
  - `createClient`, `runDaemon`, `type DaemonOptions`, `type HostClient`
  - `ProxyHost`, `type ProxySpawnParams`
  - `type SpawnContextServerParams`, `type StderrOption`

- [ ] **Step 1: Scaffold `packages/host-node/package.json`.**

```json
{
  "name": "@mokei/host-node",
  "version": "0.12.0",
  "description": "Mokei Context host Node stdio and daemon entry",
  "keywords": ["model", "context", "protocol", "mcp", "host", "llm", "ai"],
  "homepage": "https://mokei.dev",
  "repository": {
    "type": "git",
    "url": "https://github.com/TairuFramework/mokei",
    "directory": "packages/host-node"
  },
  "license": "MIT",
  "sideEffects": false,
  "type": "module",
  "exports": { ".": "./lib/index.js" },
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "files": ["lib/*"],
  "scripts": {
    "build": "pnpm run build:clean && pnpm run build:js && pnpm run build:types",
    "build:clean": "del lib",
    "build:js": "swc src -d ./lib --config-file ../../node_modules/@kigu/dev/swc.json --strip-leading-paths",
    "build:types": "tsc --emitDeclarationOnly --skipLibCheck",
    "build:types:ci": "tsc --emitDeclarationOnly --skipLibCheck --declarationMap false",
    "prepublishOnly": "pnpm run build",
    "test": "pnpm run test:types",
    "test:types": "tsc --noEmit --skipLibCheck"
  },
  "dependencies": {
    "@enkaku/client": "catalog:",
    "@enkaku/node-streams": "catalog:",
    "@enkaku/server": "catalog:",
    "@enkaku/transport": "catalog:",
    "@mokei/context-client": "workspace:^",
    "@mokei/context-protocol": "workspace:^",
    "@mokei/host": "workspace:^",
    "@mokei/host-protocol": "workspace:^",
    "@sozai/stream": "catalog:",
    "@tejika/process": "catalog:",
    "nano-spawn": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:"
  }
}
```

- [ ] **Step 2: Add the two tsconfig files** (identical shape to Task 1 Step 2, in `packages/host-node/`). `tsconfig.json` uses `"lib": ["es2025", "dom"]`, `"types": ["node"]`, `outDir ./lib`, `rootDir ./src`. `tsconfig.test.json` extends it with `noEmit`, `rootDir: ".."`, `resolveJsonModule`, and `"include": ["./src/**/*", "./test/**/*"]`.

- [ ] **Step 3: Move the four self-contained Node files unchanged.** `git mv` these from `packages/host/src` to `packages/host-node/src` — their imports are already relative/workspace and need no edit:

```bash
git mv packages/host/src/spawn.ts packages/host-node/src/spawn.ts
git mv packages/host/src/utils.ts packages/host-node/src/utils.ts
git mv packages/host/src/daemon.ts packages/host-node/src/daemon.ts
git mv packages/host/src/server.ts packages/host-node/src/server.ts
```

(`daemon.ts`'s `DAEMON_ENTRY = new URL('./server.js', import.meta.url)` keeps resolving because `server.ts` moves with it.)

- [ ] **Step 4: Move and re-home `proxy.ts`.** `git mv packages/host/src/proxy.ts packages/host-node/src/proxy.ts`. Change its host import from the local path to the workspace package — line 11 becomes:

```ts
import { ContextHost } from '@mokei/host'
```

(`./daemon.js` and `./utils.js` imports stay — those files moved alongside it.)

- [ ] **Step 5: Create `packages/host-node/src/node-host.ts`** holding `spawnHostedContext`, its param type, the two constants, `AddLocalContextParams`, and `NodeContextHost`. Move the bodies verbatim from `packages/host/src/host.ts` (`SpawnHostedContextParams` 161-177, `spawnHostedContext` 179-250, `AddLocalContextParams` 264-275, `addLocalContext` method 496-542) and the constants (44, 47):

```ts
import { NodeStreamsTransport } from '@enkaku/node-streams'
import {
  type ClientTransport,
  type ContextClient,
  type ContextTypes,
  type UnknownContextTypes,
  UnsupportedProtocolVersionError,
} from '@mokei/context-client'
import type { ProtocolVersion } from '@mokei/context-protocol'
import { isSupportedProtocolVersion } from '@mokei/context-protocol'
import {
  ContextHost,
  createHostedContext,
  type HostedContext,
} from '@mokei/host'

import {
  isSubprocessExit,
  type SpawnContextServerParams,
  spawnContextServer,
} from './spawn.js'

/** Default cap on total live stdout framer memory per context (8 MiB). */
const DEFAULT_MAX_BUFFER_SIZE = 8 * 1024 * 1024

/** Grace period (ms) between SIGTERM and SIGKILL when disposing a child. */
const DEFAULT_KILL_TIMEOUT = 5000

export type SpawnHostedContextParams = SpawnContextServerParams & {
  // ... verbatim from host.ts:161-177
}

export async function spawnHostedContext<T extends ContextTypes = UnknownContextTypes>(
  params: SpawnHostedContextParams,
): Promise<HostedContext<T>> {
  // ... verbatim from host.ts:179-250 (uses DEFAULT_MAX_BUFFER_SIZE, DEFAULT_KILL_TIMEOUT,
  // NodeStreamsTransport, createHostedContext, isSupportedProtocolVersion,
  // UnsupportedProtocolVersionError, spawnContextServer)
}

export type AddLocalContextParams = SpawnContextServerParams & {
  key: string
  // ... verbatim from host.ts:264-275
}

export class NodeContextHost extends ContextHost {
  async addLocalContext<T extends ContextTypes = UnknownContextTypes>(
    params: AddLocalContextParams,
  ): Promise<ContextClient<T>> {
    // ... verbatim from host.ts:496-542 — the method body references this._contexts,
    // this._events, this.remove (all inherited @internal members of ContextHost) and
    // the local spawnHostedContext / isSubprocessExit.
  }
}
```

Reproduce every moved block exactly (comments included). The method body needs no edit: `_contexts`, `_events`, and `remove` are inherited `@internal` members.

- [ ] **Step 6: Write `packages/host-node/src/index.ts`.**

```ts
/**
 * Mokei Context host — Node stdio and daemon entry.
 *
 * @module host-node
 */

export { createClient, type DaemonOptions, type HostClient, runDaemon } from './daemon.js'
export {
  type AddLocalContextParams,
  NodeContextHost,
  type SpawnHostedContextParams,
  spawnHostedContext,
} from './node-host.js'
export { ProxyHost, type ProxySpawnParams } from './proxy.js'
export type { SpawnContextServerParams, StderrOption } from './spawn.js'
```

- [ ] **Step 7: Trim `packages/host/src/host.ts`.** Delete: line 1 (`import { NodeStreamsTransport } ...`); line 37 (`import { isSubprocessExit, ... } from './spawn.js'`); the two constants `DEFAULT_MAX_BUFFER_SIZE` (44) and `DEFAULT_KILL_TIMEOUT` (47); `SpawnHostedContextParams` (161-177); `spawnHostedContext` (179-250); `AddLocalContextParams` (264-275); and the `addLocalContext` method (496-542). Keep `createHostedContext`, `addDirectContext`, `addHTTPContext`, `createContext`, and everything else. In the `ContextHost` constructor comment (around line 320, "in ProxyHost, the daemon client"), reword to not imply `ProxyHost` lives in this file — e.g. "and, in the `ProxyHost` subclass, the daemon client".

- [ ] **Step 8: Trim `packages/host/src/index.ts`** to the RN-safe surface:

```ts
/**
 * Mokei Context host.
 *
 * @module host
 */

export {
  type CreateHTTPClientParams,
  createHTTPClient,
  DEFAULT_HTTP_TIMEOUT,
  HTTPTransport,
  type HTTPTransportParams,
} from '@mokei/http-client'
export {
  type AddDirectContextParams,
  type AllowToolCalls,
  ContextHost,
  type ContextTool,
  type CreateContextParams,
  createHostedContext,
  type EnableTools,
  type EnableToolsArg,
  type EnableToolsFn,
  getContextToolID,
  getContextToolInfo,
  type HostedContext,
  type HTTPContextParams,
} from './host.js'
export {
  createLocalToolID,
  createToolFromDefinition,
  getLocalToolName,
  isLocalToolID,
  LOCAL_TOOL_NAMESPACE,
  type LocalTool,
  type LocalToolDefinition,
  type LocalToolExecute,
  toolsToLocalTools,
  toolToLocalTool,
} from './local-tools.js'
```

(Removed vs. before: the `daemon.js` re-export line, `ProxyHost`, `spawnHostedContext`, `AddLocalContextParams`, `AddLocalContextParams`/`SpawnHostedContextParams` names, and `type SpawnContextServerParams, StderrOption`.)

- [ ] **Step 9: Drop `@mokei/host`'s Node deps.** In `packages/host/package.json` remove `@enkaku/node-streams`, `@enkaku/server`, `@tejika/process`, `nano-spawn`, and `@mokei/host-protocol`. Confirm none are still imported: `grep -rn "node-streams\|@tejika/process\|nano-spawn\|host-protocol\|@enkaku/server" packages/host/src` returns nothing.

- [ ] **Step 10: Install and build both host packages.**

Run: `pnpm install`
Then: `pnpm --filter @mokei/host --filter @mokei/host-node build`
Expected: both build clean.

- [ ] **Step 11: Assert `@mokei/host` lib is Node-free.**

Run: `grep -rn "node:url\|node-streams\|@tejika/process\|nano-spawn" packages/host/lib || echo CLEAN`
Expected: `CLEAN`.

- [ ] **Step 12: Type-check both.**

Run: `pnpm --filter @mokei/host --filter @mokei/host-node test:types`
Expected: PASS.

- [ ] **Step 13: Commit.**

```bash
git add packages/host packages/host-node pnpm-lock.yaml
git commit -m "feat: extract @mokei/host-node; make @mokei/host RN-safe"
```

---

## Task 4: Retarget `@mokei/host` Node consumers (cli, session, integration-tests)

**Files:**
- Modify: `packages/cli/src/commands/inspect.tsx:4`, `packages/cli/src/commands/monitor.tsx:1`, `packages/cli/src/commands/proxy.ts:2`, `packages/cli/src/chat/providers.ts:3`
- Modify: `packages/cli/package.json`
- Modify: `packages/session/src/session.ts` (import + field/param/default types)
- Modify: `packages/session/package.json`
- Modify: `integration-tests/suites/{host.test.ts,version-detection-stdio.test.ts,interop-sdk-server.test.ts}`
- Modify: `integration-tests/package.json`

**Interfaces:**
- Consumes: `NodeContextHost`, `spawnHostedContext`, `runDaemon`, `ProxyHost` from `@mokei/host-node`; RN-safe types (`ContextTool`, `EnableToolsArg`, `LocalToolDefinition`, `getContextToolInfo`) stay from `@mokei/host`.

- [ ] **Step 1: cli imports.** Change:
  - `packages/cli/src/commands/inspect.tsx:4` — `import { type HostedContext, spawnHostedContext } from '@mokei/host'` → `spawnHostedContext` from `@mokei/host-node`, keep `type HostedContext` from `@mokei/host`.
  - `packages/cli/src/commands/monitor.tsx:1` and `packages/cli/src/commands/proxy.ts:2` — `import { runDaemon } from '@mokei/host'` → `'@mokei/host-node'`.
  - `packages/cli/src/chat/providers.ts:3` — `import { ProxyHost } from '@mokei/host'` → `'@mokei/host-node'`.
  - Add `"@mokei/host-node": "workspace:^"` to `packages/cli/package.json` dependencies.

- [ ] **Step 2: session.** In `packages/session/src/session.ts`:
  - Split the import block (currently lines 2-7): keep `type ContextTool`, `type EnableToolsArg`, `type LocalToolDefinition` from `@mokei/host`; add `import { NodeContextHost } from '@mokei/host-node'`.
  - Change the field type (line 152) `#contextHost: ContextHost` → `#contextHost: NodeContextHost`, the option type (line 80) `contextHost?: ContextHost` → `contextHost?: NodeContextHost`, the getter return (line 175) `get contextHost(): ContextHost` → `NodeContextHost`, and the default (line 162) `?? new ContextHost()` → `?? new NodeContextHost()`. Update the two doc comments mentioning `ContextHost` (lines 41, 79) to `NodeContextHost`.
  - Add `"@mokei/host-node": "workspace:^"` to `packages/session/package.json` dependencies (keep `@mokei/host` — still used for types).

- [ ] **Step 3: integration-tests.** Change:
  - `integration-tests/suites/host.test.ts:1` — `import { ContextHost } from '@mokei/host'` → `import { NodeContextHost } from '@mokei/host-node'`, and update the `new ContextHost()` / `host.addLocalContext(...)` usage (line 28 area) to `NodeContextHost`.
  - `integration-tests/suites/version-detection-stdio.test.ts:3` and `interop-sdk-server.test.ts:4` — `spawnHostedContext` import → `@mokei/host-node`.
  - Add `"@mokei/host-node": "workspace:^"` to `integration-tests/package.json`.

- [ ] **Step 4: Install and full build.**

Run: `pnpm install`
Then: `pnpm build`
Expected: whole workspace builds clean.

- [ ] **Step 5: Full test + types.**

Run: `pnpm test`
Expected: PASS across cli, session, host, integration-tests.

- [ ] **Step 6: Lint.**

Run: `rtk proxy pnpm run lint`
Expected: clean (formatting of the split import blocks applied).

- [ ] **Step 7: Commit.**

```bash
git add packages/cli packages/session integration-tests pnpm-lock.yaml
git commit -m "refactor: point Node host consumers at @mokei/host-node"
```

---

## Task 5: RN-bundle-safety regression test

Encodes the invariant so a future accidental Node import re-breaking the RN barrel fails CI. Static import-graph walk from each RN barrel's built `lib/index.js`, following relative and `@mokei/*` workspace edges, asserting no edge resolves to a banned specifier.

**Files:**
- Create: `packages/host/test/rn-bundle.test.ts`

**Interfaces:**
- Consumes: built `lib/` of `@mokei/host` and `@mokei/context-server` (so this test depends on a prior `pnpm build`).

- [ ] **Step 1: Write the failing test.** `packages/host/test/rn-bundle.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const BANNED = [/^node:/, /@enkaku\/node-streams/, /@tejika\/process/, /^nano-spawn$/]
const require = createRequire(import.meta.url)

// Resolve a package's built entry to an absolute lib/ path.
function entryOf(pkg: string): string {
  return require.resolve(pkg)
}

// Walk static imports reachable from an entry, following relative and @mokei/* edges only.
function reachableSpecifiers(entry: string): Set<string> {
  const seen = new Set<string>()
  const specs = new Set<string>()
  const stack = [entry]
  while (stack.length) {
    const file = stack.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1]
      specs.add(spec)
      if (spec.startsWith('.')) {
        stack.push(resolve(dirname(file), spec))
      } else if (spec.startsWith('@mokei/')) {
        stack.push(entryOf(spec))
      }
    }
  }
  return specs
}

describe('RN bundle safety', () => {
  for (const pkg of ['@mokei/host', '@mokei/context-server']) {
    test(`${pkg} barrel reaches no Node-only specifier`, () => {
      const specs = [...reachableSpecifiers(entryOf(pkg))]
      const leaks = specs.filter((s) => BANNED.some((re) => re.test(s)))
      expect(leaks).toEqual([])
    })
  }
})
```

Note on resolution: relative specifiers in built `lib` are extensionless-or-`.js`; if `resolve(...)` misses the `.js`, append it in the walker (try `file`, then `file + '.js'`). Adjust the walker until it reads real files, then keep it strict.

- [ ] **Step 2: Run against the current (fixed) tree to verify it PASSES.**

Run: `pnpm build && pnpm --filter @mokei/host exec vitest run test/rn-bundle.test.ts`
Expected: PASS (both packages clean after Tasks 1 and 3).

- [ ] **Step 3: Prove the test bites.** Temporarily add `import 'node:url'` to `packages/host/src/host.ts`, rebuild `@mokei/host`, rerun the test.
Expected: FAIL listing `node:url`. Then revert the temporary import and rebuild.

- [ ] **Step 4: Commit.**

```bash
git add packages/host/test/rn-bundle.test.ts
git commit -m "test: RN bundle-safety guard for host + context-server barrels"
```

---

## Task 6: Real Metro/Hermes bundle validation (acceptance gate) + release intent

The static test (Task 5) guards the invariant; the spec's true acceptance gate is a real Metro bundle. This is validated from the Sakui repo, which triggered the issue.

**Files:**
- Modify: `docs/agents/plans/next/2026-08-25-host-rn-bundler-safe-entry.md` (move to `completed/`, or mark resolved per the `kigu:archive` convention)

- [ ] **Step 1: Link the built packages into Sakui.** From the Sakui repo `apps/mobile`, use the locally built `@mokei/host` / `@mokei/context-server` (pnpm link or a version bump once published). Ensure `@sakui/runtime`'s `contexts-manager.ts` imports resolve to the trimmed `@mokei/host`.

- [ ] **Step 2: Run the Metro export.**

Run (in Sakui `apps/mobile`): `pnpm exec expo export --platform ios --output-dir dist`
Expected: completes with **no** `Unable to resolve module node:url` / `@tejika/process` / `@enkaku/node-streams` error.

- [ ] **Step 3: If the bundle still fails**, capture the exact unresolved specifier and file. If it is a leak the static walker missed (e.g. a bare `require` inside a transitive dep, or a `node:*` reached through `@enkaku/transport` / `@sozai/*`), that dependency needs its own upstream fix — file it as an Enkaku ask in the `../enkaku` checkout per repo convention, and note it in the plan. Do not paper over it by re-adding a Node dep to the RN barrel.

- [ ] **Step 4: Record the release intent.** Per the `kigu:releasing` skill, record a **major** release intent (name e.g. `host-rn-node-split`) covering the fixed group, then preview:

Run: `pnpm change status`
Expected: the whole fixed group (including the two new packages at their initial `0.12.0`) moves to the next major together. Do not run `pnpm version -r` / publish — that is the user's call.

- [ ] **Step 5: Update the changelog note.** Ensure the release note states: consumers importing `addLocalContext` (now on `NodeContextHost`), `spawnHostedContext`, `createClient`, `runDaemon`, or `ProxyHost` from `@mokei/host` must switch to `@mokei/host-node`; `serveProcess` moves from `@mokei/context-server` to `@mokei/context-server-node`.

- [ ] **Step 6: Archive the origin plan.** Move `docs/agents/plans/next/2026-08-25-host-rn-bundler-safe-entry.md` to `docs/agents/plans/completed/` (per `kigu:archive`), noting the delivering spec/plan.

- [ ] **Step 7: Commit.**

```bash
git add docs .changeset pnpm-workspace.yaml
git commit -m "chore: record major release intent for host node split; archive origin plan"
```

---

## Self-Review

**Spec coverage:**
- RN-safe `@mokei/host` (drop daemon/spawn/proxy, generic `ContextHost`) → Task 3.
- `NodeContextHost extends ContextHost` with `addLocalContext`, non-breaking Node path → Task 3 (Steps 5-6), Task 4.
- `@mokei/host-node` holds spawn + daemon + server + proxy → Task 3.
- `@mokei/context-server` RN-safe + `@mokei/context-server-node` with `serveProcess` → Tasks 1-2.
- Drop Node deps from both RN barrels → Task 1 Step 6, Task 3 Step 9.
- Migration of cli/session/integration-tests/mcp-servers/fixtures/docs → Tasks 2, 4.
- `versioning.fixed` + major changeset → Task 1 Step 7, Task 6 Steps 4-5.
- Real Metro bundle acceptance gate → Task 6; static regression guard → Task 5.
- "No other Node leak" premise → Task 5 walker + Task 6 real bundle.

**Placeholder scan:** The `// ... verbatim from host.ts:NN-MM` markers in Task 3 Step 5 point at exact source line ranges to copy — the executor reproduces the real bodies (unchanged relocation); this is a deliberate move-verbatim instruction, not an unspecified TODO. All config files, import blocks, and the test are given in full.

**Type consistency:** `NodeContextHost` (Task 3) is the exact name imported in Tasks 4. `spawnHostedContext` / `AddLocalContextParams` / `SpawnHostedContextParams` names match across `node-host.ts`, the `host-node` barrel, and consumers. `serveProcess` signature (`(config: ServerConfig) => ContextServer`) matches producer (Task 1) and consumers (Task 2). Package names `@mokei/host-node` and `@mokei/context-server-node` are used identically in scaffolds, deps, and imports.
