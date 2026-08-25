> Delivered by `docs/superpowers/plans/2026-08-25-host-rn-bundler-safe-entry.md` (the
> implementation plan) and `docs/superpowers/specs/2026-08-25-host-rn-bundler-safe-entry-design.md`
> (the spec).

# `@mokei/host` — React Native / Metro-bundler-safe entry point

**Status:** next
**Origin:** Sakui mobile app shell (walking skeleton, Task 3). Raised by the Sakui repo
while proving the in-process runtime boots under Metro/Hermes on Expo SDK 57.
**Priority:** blocks the Sakui mobile app — it cannot bundle any screen that boots the
runtime until this is addressed.

## Problem

`@mokei/host` cannot be bundled by Metro (React Native / Hermes). Any consumer that
transitively imports it fails hard at bundle time:

```
Unable to resolve module node:url from node_modules/@mokei/host/lib/daemon.js
```

Metro resolves the full module graph and does not tree-shake unused named re-exports
before resolution, so importing *anything* from the package pulls in its Node-only code.

## Root cause

`@mokei/host` exposes a single `.` barrel (`exports: { ".": "./lib/index.js" }`), and
`index.ts` unconditionally re-exports two Node-only modules:

1. **`daemon.js`** — top-level `import { fileURLToPath } from 'node:url'` and
   `import { createDaemonClient, ensureDaemon } from '@tejika/process'` (Node child-process
   / IPC). `node:url` has no Metro shim, so this is the immediate failure.
2. **`host.js`** — top-level `import { NodeStreamsTransport } from '@enkaku/node-streams'`,
   used as a value (spawning a hosted context server over stdio, `host.ts:209`).

This is two layers deep: splitting `daemon.js` out of the barrel removes the `node:url`
error, but `host.js` itself still drags `@enkaku/node-streams` into a bundler target.

The API a bundler-target consumer actually needs is the `ContextHost` class plus the
`ContextTool` / `EnableToolsArg` types from `host.js` — none of which inherently require
`node:url`, `@tejika/process`, or stdio spawning. Those Node-only capabilities
(`createClient` / `runDaemon` from `daemon.js`, and `spawnHostedContext`'s
`NodeStreamsTransport` path in `host.js`) are only used when hosting a local context
server as a child process, which a mobile/browser consumer never does.

## What the consumer needs

A React Native / browser consumer needs to construct a `ContextHost` and add
**direct / HTTP** contexts (`addDirectContext`, HTTP transport) without pulling in:

- `node:url` / `@tejika/process` (`daemon.js`)
- `@enkaku/node-streams` (`host.js`'s local-spawn path)

## Proposed direction (for the implementing agent to design)

The Node coupling is already well-isolated, so the fix is small:

- In `host.ts`, `NodeStreamsTransport` (`@enkaku/node-streams`) is used in **exactly one
  function**, `spawnHostedContext` (`host.ts:179`, transport built at `:209`), which is
  reached only through `ContextHost.addLocalContext` (`:496` → `:507`). Every other part
  of `ContextHost` — construction, `addHTTPContext`, direct contexts, `remove`, tool
  dispatch — plus the pure helpers (`getContextToolID`, `getContextToolInfo`) and
  `createHostedContext` are already Node-free.
- `daemon.js`'s `node:url` + `@tejika/process` reach a consumer only because the `.` barrel
  re-exports `createClient` / `runDaemon` from it.

So:

1. **Isolate the local-spawn transport** — move `spawnHostedContext` (its
   `NodeStreamsTransport` + `spawnContextServer`/`nano-spawn` path) into its own module and
   have `ContextHost.addLocalContext` lazily import it. Then the `ContextHost` class bundles
   without `@enkaku/node-streams`.
2. **Bundler-safe subpath export** — expose the RN/browser-safe surface (`ContextHost`,
   context types, HTTP/direct context helpers, the pure ID helpers) via an export subpath
   that does not reach `daemon.js`.
3. Keep the existing `.` barrel intact for Node consumers (CLI, daemon, tests) —
   this is additive, not a breaking reshuffle of the Node API.

The exact export layout and how to split the spawn path is a design decision for the
plan that picks this up. Validate against a real Metro bundle, not just types.

## Sakui repro / trigger

From the Sakui repo (`apps/mobile`), import anything that transitively reaches
`@sakui/runtime`'s `contexts-manager.ts` (which does `new ContextHost()` and imports
`ContextHost`, `ContextTool`, `EnableToolsArg` from `@mokei/host`), then run:

```
pnpm exec expo export --platform ios --output-dir dist
```

Import chain that triggers it:
`apps/mobile/src/runtime/host.ts` → `@sakui/runtime-host-expo` → `@sakui/runtime-host`
→ `@sakui/runtime` (`contexts-manager.ts`) → `@mokei/host`.

## Verification

- A Metro/Hermes bundle (`expo export`) of a consumer that uses only the RN-safe
  `ContextHost` surface completes with no `node:url` / `@tejika/process` /
  `@enkaku/node-streams` resolution errors.
- The existing Node API (`createClient`, `runDaemon`, local-spawn contexts) is unchanged
  for Node consumers.

## Notes

- The affected Sakui feature (mobile) does not use MCP/LLM context hosting in its current
  milestone — the runtime pulls `@mokei/host` in transitively regardless. A cleaner
  `ContextHost` bundling story is still the right fix, since mobile will need real context
  hosting once LLM/MCP lands there.
