# `@mokei/host` — React Native / Metro-bundler-safe entry point

**Status:** design (approved to write spec)
**Date:** 2026-08-25
**Origin plan:** `docs/agents/plans/next/2026-08-25-host-rn-bundler-safe-entry.md`
**Origin trigger:** Sakui mobile app shell (walking skeleton, Task 3) — the in-process
runtime cannot bundle under Metro/Hermes (Expo SDK 57) because anything importing
`@mokei/host` pulls in Node-only code.

## Problem

`@mokei/host` cannot be bundled by Metro. Any consumer that transitively imports it
fails at bundle time:

```
Unable to resolve module node:url from node_modules/@mokei/host/lib/daemon.js
```

Metro resolves the full module graph and does not tree-shake unused named re-exports
before resolution, so importing *anything* from the package pulls in its Node-only
modules. Dynamic `import()` does not help: Metro still resolves the target at bundle
time. The fix must remove the Node-only modules from the RN-safe barrel's static and
dynamic import graph entirely — i.e. move them behind a separate package.

## Root cause

Three, and only three, Node-only leaks reach a bundler target. Every other dependency
on the RN-safe path (`@enkaku/transport`, `@enkaku/client`, `@sozai/*`,
`@mokei/context-client`, `@mokei/context-protocol`, `@mokei/context-rpc`,
`@mokei/http-client`) was scanned and imports no `node:` builtin.

1. **`@mokei/host` `daemon.ts`** — top-level `import { fileURLToPath } from 'node:url'`
   and `import { createDaemonClient, ensureDaemon } from '@tejika/process'`. `node:url`
   has no Metro shim; this is the immediate failure. Re-exported from `index.ts`.
2. **`@mokei/host` `host.ts:1`** — top-level `import { NodeStreamsTransport } from
   '@enkaku/node-streams'`, plus `spawn.ts` (`nano-spawn`, `node:child_process` types).
   Used only by `addLocalContext` / `spawnHostedContext` (spawning a hosted context
   server over stdio).
3. **`@mokei/context-server` `server.ts:1`** — top-level `import { NodeStreamsTransport }
   from '@enkaku/node-streams'`, used only by `serveProcess` (line 611). `@mokei/host`'s
   `addDirectContext` builds a `ContextServer` from this package's barrel, so the
   direct-context path drags `node-streams` through a **second** package.

## What the RN/browser consumer needs

The whole non-spawn host API must bundle under Metro/Hermes:

- `new ContextHost()` and its `addDirectContext` (in-process `ContextServer`) and
  `addHTTPContext` (HTTP transport) methods
- `createHostedContext`, `getContextToolID` / `getContextToolInfo`
- the context/tool types (`ContextTool`, `EnableToolsArg`, `HTTPContextParams`, …)
- `local-tools` helpers
- the `@mokei/http-client` re-exports

Excluded (Node-only, never reached from a bundler target): `addLocalContext` /
`spawnHostedContext` (child-process spawn), `createClient` / `runDaemon` (daemon IPC),
`ProxyHost`, and `serveProcess` (stdio server entry).

## Design

Split the Node stdio / child-process layer out of two barrels into sibling `-node`
packages. The `.` barrels of `@mokei/host` and `@mokei/context-server` become
RN/browser-safe. The generic `ContextHost` class stays in `@mokei/host`; a
`NodeContextHost extends ContextHost` in `@mokei/host-node` adds the one spawning method.

This is a **breaking reshuffle** of the Node import surface (not the additive subpath the
origin plan floated) — chosen deliberately for the stronger isolation: the RN-safe
packages no longer even *list* the Node-only dependencies, so no future accidental static
import can reintroduce the leak. All in-repo consumers are updated in the same lockstep
major bump.

### `@mokei/host` (becomes RN-safe)

**Keeps:** generic `ContextHost` (without `addLocalContext`), `createHostedContext`
(transport-only), `addDirectContext`, `addHTTPContext`, `getContextToolID`,
`getContextToolInfo`, all context/tool types, `local-tools.ts`, and the
`@mokei/http-client` re-exports.

**Removes from `host.ts`:** the line-1 `NodeStreamsTransport` import, the `./spawn.js`
import, the `addLocalContext` method, `spawnHostedContext`, `SpawnHostedContextParams`,
and `AddLocalContextParams`.

**Removes from `index.ts`:** the `daemon.js` re-exports (`createClient`, `runDaemon`,
`DaemonOptions`, `HostClient`), `ProxyHost`, `spawnHostedContext`, and the `spawn.ts`
type re-exports (`SpawnContextServerParams`, `StderrOption`).

**Drops dependencies:** `@enkaku/node-streams`, `@enkaku/server`, `@tejika/process`,
`nano-spawn`, `@mokei/host-protocol`.

### `@mokei/host-node` (new package)

A new package in the existing `host-*` family (`host-monitor`, `host-protocol`).

**Holds:**
- `NodeContextHost extends ContextHost` — adds `addLocalContext` (moved verbatim,
  including its `onStreamError` / `onExit` framing-fault handling).
- `spawnHostedContext` + `SpawnHostedContextParams`.
- `spawn.ts` (`spawnContextServer`, `isSubprocessExit`, `SpawnContextServerParams`,
  `StderrOption`) and `utils.ts` (`filterEnv`, used only by the spawn path).
- `daemon.ts` (`createClient`, `runDaemon`, `DaemonOptions`, `HostClient`).
- daemon `server.ts` — the process entry `runDaemon` spawns
  (`DAEMON_ENTRY = new URL('./server.js', import.meta.url)`); it must move with `daemon.ts`
  so the relative resolution stays correct.
- `proxy.ts` (`ProxyHost`) — spawns local contexts; imports `runDaemon` and the host class.

**Owns dependencies:** `@enkaku/node-streams`, `@enkaku/server`, `@enkaku/transport`,
`@tejika/process`, `nano-spawn`, `@mokei/host` (`workspace:^`, extends `ContextHost`),
`@mokei/host-protocol`, `@mokei/context-*` (as `server.ts` requires), `@sozai/*`,
`@types/node`.

### `@mokei/context-server` (becomes RN-safe) and `@mokei/context-server-node` (new)

`@mokei/context-server`'s `.` barrel keeps `ContextServer`, `createTool` /
`createPrompt` (`definitions.ts`), the `mrtr.ts` exports, and `types.ts` — all RN-safe.
`serveProcess` and its `@enkaku/node-streams` import move to a new
`@mokei/context-server-node` package (symmetric with `@mokei/host-node`). Drops the
`@enkaku/node-streams` dependency from `@mokei/context-server`.

### Class boundary — non-breaking for Node, honest for RN

The Node path stays byte-identical: `new NodeContextHost().addLocalContext(...)` behaves
exactly as `new ContextHost().addLocalContext(...)` did (the method body is unchanged, only
its host class name and package change). No injected-spawner indirection, no throwing
stub. On the RN path, `ContextHost` simply has no `addLocalContext` in its type — calling
it is a compile-time error, which is the truthful signal that local spawn is unavailable
in that target.

## Migration (in-repo, one lockstep major bump)

| Consumer | Change |
|----------|--------|
| `packages/cli` | `ProxyHost`, `spawnHostedContext`, `runDaemon` imports → `@mokei/host-node` |
| `packages/session` | `session.ts:189` `addLocalContext` path → construct `NodeContextHost` from `@mokei/host-node`; RN-safe type imports (`ContextTool`, `LocalToolDefinition`, `getContextToolInfo`) may stay on `@mokei/host` |
| `integration-tests` | `spawnHostedContext` / `addLocalContext` suites → `@mokei/host-node`; `ContextHost` local-context test → `NodeContextHost` |
| `mcp-servers/sqlite`, `mcp-servers/fetch` | `serveProcess` import → `@mokei/context-server-node` |
| `packages/host/test/fixtures/*.mjs` | `serveProcess` import → `@mokei/context-server-node` |
| docs (`docs/guides/server.md`, package READMEs) | `serveProcess` examples → `@mokei/context-server-node` |

`packages/http-server` depends on `@mokei/context-server` but uses `ContextServer` (the
RN-safe surface), so it stays on the `.` barrel — no change.

**Changeset:** major. Note that external consumers importing `addLocalContext` (via the
class), `spawnHostedContext`, `createClient`, `runDaemon`, or `ProxyHost` from
`@mokei/host` must retarget to `@mokei/host-node`, and `serveProcess` from
`@mokei/context-server` to `@mokei/context-server-node`.

New packages: `@mokei/host-node` and `@mokei/context-server-node` — both added to
`versioning.fixed` in `pnpm-workspace.yaml` so they release in lockstep with the rest of
the public surface.

## Error handling

No runtime behavior changes. All moved code (spawn, daemon, `serveProcess`, framing-fault
handling in `addLocalContext`) is relocated verbatim. The only new failure mode is a
*compile-time* error when RN code references `addLocalContext` on the RN `ContextHost`,
which is the intended, honest signal.

## Testing / verification

1. **Real Metro bundle (the acceptance gate).** An `expo export` (or minimal Metro
   bundle) of a consumer that uses only the RN-safe surface — `new ContextHost()`,
   `addHTTPContext`, `addDirectContext` — completes with no `node:url` /
   `@tejika/process` / `@enkaku/node-streams` resolution error. Types passing is not
   sufficient; the bundle must resolve.
2. **Node API unchanged.** `NodeContextHost().addLocalContext`, `createClient`,
   `runDaemon`, `ProxyHost`, and `serveProcess` work as before from their new packages;
   existing host and integration-test suites pass against the relocated imports.
3. **Full workspace green.** `pnpm build`, `pnpm test`, and `test:types` pass across all
   reshuffled imports (`cli`, `session`, `integration-tests`, `mcp-servers/*`).

## Notes / risks

- The Sakui mobile milestone does not yet use MCP/LLM context hosting; the runtime pulls
  `@mokei/host` transitively regardless. A clean `ContextHost` bundling story is still the
  right fix — mobile needs real context hosting once LLM/MCP lands there.
- The RN-safe dependency scan was done against built `lib/` of each package. The Metro
  bundle in verification step 1 is the authoritative check; a leak the static scan missed
  (e.g. a bare `require` inside a transitive dep) would surface there.
- Two new packages need the standard scaffolding (`package.json`, `tsconfig`,
  `tsconfig.test.json`, build scripts mirroring the sibling `host-*` / `context-server`
  packages) — an implementation-plan concern, kept out of this design.
