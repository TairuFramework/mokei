# `@mokei/host` — React Native / Metro-bundler-safe entry point

**Status:** complete
**Date:** 2026-08-25
**Origin:** Sakui mobile app shell (walking skeleton). The in-process runtime could not
bundle under Metro/Hermes (Expo SDK 57): any consumer transitively importing `@mokei/host`
failed at bundle time with `Unable to resolve module node:url from .../@mokei/host/lib/daemon.js`.
Metro resolves the full module graph and does not tree-shake unused named re-exports before
resolution, so importing *anything* from the package pulled in its Node-only code.

## Problem / root cause

Three Node-only leaks reached a bundler target through the `@mokei/host` and
`@mokei/context-server` barrels (every other dependency on the RN path was verified clean):

1. `@mokei/host` `daemon.ts` — `node:url` + `@tejika/process` (daemon IPC), re-exported from the barrel.
2. `@mokei/host` `host.ts` — top-level `@enkaku/node-streams` + `nano-spawn` via `spawn.ts`,
   used only by `addLocalContext` / `spawnHostedContext` (spawning a context server over stdio).
3. `@mokei/context-server` `server.ts` — top-level `@enkaku/node-streams`, used only by
   `serveProcess`. `@mokei/host`'s `addDirectContext` builds a `ContextServer` from this barrel,
   so the direct-context path dragged node-streams through a **second** package.

## Design decisions (preserved rationale)

- **Two new sibling packages hold all Node-only code**, symmetric with the existing `host-*`
  family: `@mokei/host-node` (daemon, `ProxyHost`, `spawnHostedContext`, and
  `NodeContextHost`) and `@mokei/context-server-node` (`serveProcess`). Chosen over an
  additive subpath export for stronger isolation — the RN-safe packages no longer even *list*
  the Node-only dependencies, so no future accidental import can silently reintroduce a leak.
- **`NodeContextHost extends ContextHost`** carries the one child-process method,
  `addLocalContext`. The generic `ContextHost` stays in the RN-safe `@mokei/host` with
  `createHostedContext`, `addDirectContext`, `addHTTPContext`. This keeps the Node path's
  method body byte-identical while making the RN type honest: calling `addLocalContext` on the
  RN `ContextHost` is a compile-time error, not a runtime throw.
- **`ProxyHost extends NodeContextHost`** (not `ContextHost`). On the prior code `ProxyHost`
  inherited `addLocalContext` from `ContextHost`; the split moved that method to
  `NodeContextHost`, and `Session.addContext` calls `addLocalContext` on its host — which may
  be a `ProxyHost` (CLI daemon chat). Extending `NodeContextHost` restores exact prior
  behavior. (This corrected the design's original "extends ContextHost" statement.)
- **`Session`'s `contextHost` field/param/getter are typed `NodeContextHost`** and it defaults
  to `new NodeContextHost()`, preserving its `addLocalContext` path. A direct/HTTP-only host is
  now a `NodeContextHost` too (a superset) — a deliberate, accepted consequence of the split.
- **Deliberately API-breaking (major bump).** Kept the whole change additive-free for
  isolation rather than shimming the old barrel.

## What was built

- `@mokei/context-server-node` (new) — `serveProcess`; `@mokei/context-server` dropped its
  `@enkaku/node-streams` dependency.
- `@mokei/host-node` (new) — `NodeContextHost`, `spawnHostedContext`, `createClient`/`runDaemon`,
  the daemon `server.ts`, `ProxyHost`, and the spawn/`utils` helpers; owns the Node-only deps
  (`@enkaku/node-streams`, `@enkaku/server`, `@tejika/process`, `nano-spawn`, `@mokei/host-protocol`),
  which left `@mokei/host`. Its own vitest suite holds the relocated node-behavior tests
  (framing, lifecycle, socket/daemon, protocol-version, feature-gaps) + stdio fixtures.
- `@mokei/host` — now RN/browser-safe; keeps `ContextHost`, `createHostedContext`,
  direct/HTTP context API, local-tools, http-client re-exports, and the RN-safe tests
  (`http-transport`, `local-tools`). Also cleaned of two now-dead deps (`@enkaku/client`,
  `@sozai/stream`) and the transient `@mokei/context-server-node` fixture devDep.
- Consumers retargeted: `cli`, `session`, `integration-tests` → `@mokei/host-node`;
  `mcp-servers/{sqlite,fetch}`, host fixtures, and 7 `integration-tests/support/interop/*`
  stdio servers → `@mokei/context-server-node`. Docs updated: `docs/guides/{host,agent,server}.md`,
  `docs/guides/quick-start.md`, `website/docs/quick-start.mdx`, package READMEs.
- **Regression guard:** `packages/host/test/rn-bundle.test.ts` statically walks the built import
  graph of `@mokei/host` and `@mokei/context-server` (following relative + `@mokei/*` edges) and
  asserts no `node:*` / `@enkaku/node-streams` / `@tejika/process` / `nano-spawn` edge is
  reachable, with a non-vacuity floor. It is a CI tripwire, **not** a substitute for a real
  Metro bundle — see the follow-on item.
- Both new packages added to `versioning.fixed` in `pnpm-workspace.yaml` (lockstep release group).

## Verification status

Whole workspace green: `pnpm build` + `pnpm test` across all packages (host-node 27, session 61,
cli 119, integration-tests 53 passed/22 skipped, host + others pass); lint clean; repo-wide
`build:types` passes. A multi-agent task review per task plus a whole-branch final review passed;
an independent Codex review returned "ship with fixes", whose actionable stale-doc misses were
then fixed. **Not yet done:** the real Metro/Hermes acceptance bundle and the major release —
both extracted to the follow-on item `docs/agents/plans/next/2026-08-25-host-rn-verify-and-release.md`.

## Release note (breaking change, for the pending major bump)

Consumers importing `addLocalContext` (now a method on `NodeContextHost`), `spawnHostedContext`,
`createClient`, `runDaemon`, or `ProxyHost` from `@mokei/host` must switch to `@mokei/host-node`.
Consumers importing `serveProcess` from `@mokei/context-server` must switch to
`@mokei/context-server-node`. The two new packages join the fixed release group and move to the
next major in lockstep with the rest of the public surface.
