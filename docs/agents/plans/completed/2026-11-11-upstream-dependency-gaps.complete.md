# Upstream dependency gaps -- adopted

**Status:** complete
**Date:** 2026-11-11
**Replaces:** `backlog/2026-11-04-upstream-dependency-gaps.md`

## What shipped

- **Validator cache.** `@mokei/decision-flow-server` (`validatorFor`) and `@mokei/host`
  (`elicitCompile`) use `@sozai/schema`'s `createValidatorCache` instead of their own recycled
  factories. `createDecisionFlowGraph` passes a shared cache as the `@sozai/flow-graph`
  `validators` option unless the caller gives one.
- **Monitor bridge `dispose()`.** `startMonitor` disposes the retired enkaku bridge on daemon
  reconnect and shutdown, ending its SSE sessions. The SSE body wrapper is gone.
- **Plugin exports.** `serveHTTP` reads the MCP handler with `HTTPServer.use(MOKEI_MCP)`
  (`@sozai/http-server` 0.2.2), so the capturing `'mokei:serve'` plugin is gone.
- **Manifests.** `@enkaku/*` 0.23.2 declares `@enkaku/protocol` and `@enkaku/transport` as
  dependencies, so the packed-consumer check drops both `packageExtensions`.

## Remaining

- `@inkjs/ui` imports `react` without a peer dependency (2.0.0). The `packageExtensions` entry stays
  in `scripts/check-packed-consumer.mjs` until a release fixes it. Third-party: no request filed.
