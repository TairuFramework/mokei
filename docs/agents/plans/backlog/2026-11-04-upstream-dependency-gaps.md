# Upstream dependency gaps

**Status:** backlog -- each item waits on an upstream release, already requested. Recheck during
dependency updates.

- **Manifests worked around by `packageExtensions`** in `scripts/check-packed-consumer.mjs`:
  `@enkaku/client` imports `@enkaku/protocol` without declaring it, `@enkaku/protocol` lists
  `@enkaku/transport` only in `devDependencies`, and `@inkjs/ui` imports `react` without a peer
  dependency. Still present in `@enkaku/*` 0.22.2 and `@inkjs/ui` 2.0.0. Drop each extension once
  fixed, and confirm `pnpm test:packed` still passes.
- **`@sozai/http-server` plugin exports** -- `serveHTTP` captures the handler through a small
  `'mokei:serve'` plugin with a definite-assignment `let`. Replace it with a server accessor once
  `HTTPServer` exposes plugin exports (not in 0.2.1).
- **Monitor bridge `dispose()`** -- `startMonitor` wraps SSE bodies to close them on daemon
  reconnect. Adopt a bridge `dispose()` that ends its sessions when available.
- **`@hozon/store-log` query** -- newest-first, span-filtered log paging for traces (see the
  unified traces follow-ons).
- **Validator cache package** -- a sozai `createValidatorCache({ factory, maxCompiles, maxEntries })`
  over `createValidatorFactory` and `@sozai/json` canonical keys, so the recycle rule in
  `@mokei/decision-flow-server`'s `src/validators.ts` and `@mokei/host-desktop`'s `src/form.ts`
  can move out of mokei.
- **Validator factory in `@sozai/flow-graph`** -- a validator-factory option on
  `FlowGraphOptions`, so the graph's own compiles use the recycled factory.
