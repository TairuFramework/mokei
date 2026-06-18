# Monitor + daemon security hardening

**Status:** complete
**Date:** 2026-06-16
**Branch:** `fix/monitor-daemon`
**Origin:** 2026-06-12 full audit (critical — unauthenticated RCE exposure).

## Goal

Close the unauthenticated remote-code-execution hole in the host monitor and
harden the daemon control socket and lifecycle. The monitor bridged raw HTTP
onto the daemon control socket, whose `spawn` channel runs arbitrary commands;
the monitor bound all interfaces with no auth, so any LAN peer — or any web page
the user visited (CSRF / DNS-rebinding) — could spawn arbitrary processes.

## Key design decisions

- **Two trust boundaries, two mechanisms.** Network-facing monitor HTTP →
  Host-header allowlist + per-start bearer token. Local daemon socket → `0600`
  file permissions (same-OS-user boundary); the daemon stays
  `requireAuth: false` because only the owner can open a `0600` socket.
- **Host-allowlist = DNS-rebinding defense, token = CSRF defense.** A token
  injected into served HTML alone does not stop rebinding (attacker rebinds to
  127.0.0.1, loads the page as their own origin, reads the token). The browser's
  `Host` header still names the attacker domain, so Host-header validation is the
  real rebinding defense; the token blocks blind cross-origin fetches that can't
  read it. Both are required.
- **Token delivery via HTML injection + wrapped fetch.** The monitor mints a
  per-start `randomBytes(32)` token, splices it into the served `index.html`
  (`window.__MOKEI_TOKEN__`, unicode-escaped against `</script>` breakout), and
  the UI attaches it as `Authorization: Bearer` via a wrapped `fetch` — no
  changes needed to `@enkaku/http-client-transport`.
- **Wildcard binds are loopback-reachable.** `0.0.0.0`/`::` binds include the
  loopback aliases in the allowlist, since the browser reaches them via
  `localhost`.
- **Unified, idempotent daemon shutdown.** A single `dispose()` (guarded by a
  `disposed` flag) kills tracked child processes then runs the socket cleanup;
  both the RPC `shutdown` channel and SIGINT/SIGTERM route to it.
- **Connect-before-remove + poll-on-startup.** Daemon startup connects first and
  exits cleanly if a live daemon already owns the socket (no orphaning); it polls
  the socket with backoff instead of a fixed sleep, and exits `0` on the
  `EADDRINUSE` startup race.

## What was built

- `@mokei/host-monitor`: `injectToken` (HTML), `buildAllowedHosts` +
  `verifyApiRequest` (Host/Origin/token gate, constant-time compare), and
  `startMonitor` wiring — localhost-default bind, token mint, gated `/api` (403
  on failure), token-injected SPA serving.
- Monitor UI (`monitor/`): wrapped `fetch` sends the bearer token.
- `@mokei/cli`: `--host` flag on the `monitor` command.
- `@mokei/host`: socket `chmod 0600` (fatal on failure), child-process tracking
  + `killChildren`, `dispose`-based `RunningServer`, daemon socket helpers
  (`isSocketLive` / `waitForSocket` / `safeRemove`), connect-before-remove +
  signal handlers, controller poll-instead-of-race.

## Status & verification

All five audit items (1–5) implemented. Full build, lint, and test suites green
(host 58, host-monitor 12, session 56, cli 102, plus the rest). A live gate
probe confirmed 403-without-token, forward-with-valid-token, and token-in-HTML.
Two independent code reviews (implementation + pre-merge) returned no
Critical/Important issues; the surfaced minors were fixed (wildcard-bind
allowlist, `serverClosed.promise` await, `EADDRINUSE` clean exit).

## Follow-on (not blocking)

- `killChildren` sends `SIGTERM` only; a child ignoring it would linger. Optional
  `SIGKILL` grace-timer hardening.
- `serveStatic` root is CWD-relative (pre-existing); only real asset files are
  affected, masked by token-injected `/` + SPA fallback.
- The MCP HTTP server's Origin-validation default (same attack class, different
  package) shipped in
  `completed/2026-06-18-mcp-2025-11-25-conformance.complete.md` (item 8).
