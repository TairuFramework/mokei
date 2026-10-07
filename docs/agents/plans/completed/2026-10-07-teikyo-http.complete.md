# mokei MCP HTTP on teikyo

**Status:** complete
**Date:** 2026-10-07
**Spec:** kigu `docs/agents/plans/2026-10-07-teikyo-repo.md`, section "Downstream acceptance consumers → mokei" (the spec lives in kigu, not in this repo)

## Goal

Run mokei's MCP HTTP server on `@sozai/http-server` as a `'mokei:mcp'` plugin, take OAuth from `@teikyo/oauth`, and
end subscriptions gracefully on shutdown.

## What was built

- `HTTPHandler.shutdown()`: refuses new `initialize` and `subscriptions/listen` requests with 503, ends every
  subscription in the supplied hub with terminal frames, then disposes sessions so session-owned hubs end theirs.
  A listen admitted before shutdown but registered after it is still ended gracefully. Idempotent; `dispose()`
  stays the abrupt backstop.
- `mcpPlugin` / `MOKEI_MCP`: mounts the handler on `ctx.route('all', path)` (default `/mcp`), optionally behind
  `@teikyo/oauth`'s `requireBearer()`, with `ctx.limits(path, { bodyBytes: false, timeoutMs: false })`.
  `onShutdown` runs `handler.shutdown()`, `onClose` runs `handler.dispose()`.
- `serveHTTP` is async, composes `oauthResourcePlugin` and `mcpPlugin` on `createServer`, listens before resolving
  and forwards `graceMs`, `signal` and `logger`. Defaults stay port 3000, hostname `127.0.0.1`, path `/mcp`.
- mokei's own OAuth code (verifiers, bearer gate, metadata helpers) was removed; it now lives in `@teikyo/oauth`.

## Key decisions

- **503 on verifier outages** (was 500): an unreachable key service is an availability failure, not an
  authentication failure. Deliberate breaking change.
- **SSE stays on mokei's `SSEWriter`:** it carries the replay buffer and event IDs MCP stream resumption needs, which
  `hono/streaming` `streamSSE` lacks.
- **MCP routes opt out of the server body and timeout limits:** the handler enforces `maxBodyBytes` itself and
  streams are long-lived.
- **Shutdown scope is the whole supplied hub:** subscriptions served by other handlers sharing the hub also end. The
  hub itself is not disposed; its owner still does that.
- **Breaking changes, recorded in a minor changeset:** auth exports removed, `serveHTTP` async, its `server` is a
  sozai `HTTPServer` (bound address via `server.url`), `auth.resourceMetadataURL` dropped (derived from
  `auth.resource`), plus sozai's health routes, request IDs, secure headers and JSON error bodies.

Follow-ons: [backlog](../backlog/2026-10-07-teikyo-http-follow-ons.md).
