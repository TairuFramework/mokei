# Monitor + daemon security hardening

**Status:** next (critical — unauthenticated RCE exposure)
**Origin:** 2026-06-12 full audit (security, stability, usability, MCP-spec).

## Gap

The host monitor HTTP server bridges raw HTTP onto the daemon control socket, which
exposes the `spawn` channel (arbitrary command/args/env execution). The monitor binds
all interfaces with no auth, so anyone on the LAN — or any web page the user visits,
via CSRF/DNS-rebinding — can spawn arbitrary processes. The daemon socket itself has
no auth and default permissions, and daemon startup/shutdown has split-brain races.

## Scope (ordered by severity)

1. **Bind monitor to localhost** — `packages/host-monitor/src/index.ts:40-44` calls
   `serve({ fetch, port })` with no `hostname`; `@hono/node-server` then binds `::`/
   `0.0.0.0`. Pass `hostname: '127.0.0.1'` (optionally a `--host` opt-in for remote).
   Critical: combined with `packages/host/src/server.ts:58-69` (`spawn` channel →
   `spawnContextServer`), this is unauthenticated remote code execution.
2. **Origin/token check on `/api`** — `packages/host-monitor/src/index.ts:40` forwards
   requests to the daemon with no Origin, CORS-preflight, or token validation. A spawn
   is a side effect that needs no response read, so a hostile page can trigger it with
   `fetch()` even against localhost (and DNS rebinding defeats a localhost bind alone).
   Validate `Origin` against an allowlist and/or require a secret token minted at
   monitor start.
3. **Daemon socket permissions** — `packages/host/src/server.ts:146` listens on
   `~/.mokei-daemon.sock` with default umask permissions and no auth. `chmod` the
   socket to `0600` after listen; document the trust boundary.
4. **Daemon split-brain + signal handling** — `packages/host/src/daemon/process.ts:19-21`
   unconditionally deletes an existing socket, silently orphaning a live daemon's
   children. No SIGTERM/SIGINT handlers, so a killed daemon leaves the socket file and
   spawned MCP children behind. Try connecting before removing the socket; add signal
   handlers that run the shutdown path (kill children, remove socket).
5. **Daemon spawn races** — `packages/host/src/daemon/controller.ts:41,50-54` waits a
   flat 300ms and connects once (spurious failures on slow startup); `rmSync(socketPath)`
   is unguarded (throws if concurrently removed); two clients can both see ECONNREFUSED
   and spawn two daemons. Poll the socket with retries/backoff; tolerate ENOENT.

## Notes

- The MCP HTTP server's Origin-validation default (a spec MUST) is tracked in
  `backlog/2026-06-12-mcp-2025-11-25-conformance.md` — different package
  (`http-server`), same attack class.
- Verified clean in the audit: spawn path itself (nano-spawn, args array, no shell),
  session IDs (`crypto.randomUUID()`), no secrets logged, MCP HTTP server defaults to
  `127.0.0.1`.
