# Monitor + daemon security hardening — design

**Date:** 2026-06-16
**Status:** approved design, ready for implementation plan
**Source:** `docs/agents/plans/next/2026-06-12-monitor-daemon-security.md` (2026-06-12 full audit)

## Problem

The host monitor HTTP server bridges raw HTTP onto the daemon control socket,
which exposes the `spawn` channel (arbitrary command/args/env execution). Today:

- The monitor binds all interfaces with no auth
  (`packages/host-monitor/src/index.ts:44`, `serve({ fetch, port })` with no
  `hostname` → `@hono/node-server` binds `::`/`0.0.0.0`).
- The daemon serves the socket with `requireAuth: false`
  (`packages/host/src/server.ts:118`) and default (world-connectable) socket
  permissions (`server.ts:146`).
- Daemon startup blindly removes an existing socket
  (`packages/host/src/daemon/process.ts:19-21`), has no signal handlers, and the
  controller has spawn races (`controller.ts:41,50-54`).

Combined, items 1+2 are **unauthenticated remote code execution**: anyone on the
LAN, or any web page the user visits (via CSRF / DNS-rebinding), can spawn
arbitrary processes.

## Trust model

Two boundaries, two mechanisms:

- **Monitor HTTP** (network-facing) → Host-header allowlist + secret token.
- **Daemon socket** (local IPC) → `0600` file permissions. The daemon stays
  `requireAuth: false`; only same-OS-user processes can open the socket.

The daemon never trusts the network. The monitor is the only bridge, and it
gates every `/api` request before forwarding to the socket.

### Why both Host-header allowlist *and* token

The two threats need different defenses:

- **DNS rebinding** — attacker rebinds `evil.com` → `127.0.0.1`, loads our page
  as origin `evil.com`, and (being same-origin to itself) can read our injected
  HTML, defeating a token-in-HTML scheme. The real defense is **Host-header
  validation**: in a rebind the browser sends `Host: evil.com:PORT`, which we
  reject. A localhost bind alone does not stop this.
- **CSRF** — a hostile page on normal DNS cannot read cross-origin responses, so
  it cannot learn the token; requiring the token blocks blind `fetch()` spawns.

So: **Host allowlist = rebinding defense, token = CSRF defense.** Both required.

## Scope (5 items, ordered by severity)

### 1. Bind monitor to localhost

- `MonitorParams` gains `host?: string`, default `127.0.0.1`.
- Pass `hostname` to `serve()` in `host-monitor/src/index.ts`.
- CLI `monitor` command gets a `--host` flag (opt-in remote bind).
- Non-localhost binds are allowed but the token is always mandatory regardless.

### 2. Token + Host/Origin gate on `/api`

- **Mint** a secret token at monitor start: `randomBytes(32).toString('hex')`.
- **Deliver** it to the UI by injecting into served `index.html`: add a `/` +
  SPA-fallback route that reads the dist HTML and splices
  `<script>window.__MOKEI_TOKEN__ = "<token>"</script>` before `</head>`.
  `serveStatic` cannot transform responses, so it serves static assets only; the
  HTML entry point is served by the injecting route.
- **Send** it from the UI: `monitor/src/host/client.ts` `createHostClient`
  passes a wrapped `fetch` to `ClientTransport` that adds
  `authorization: Bearer <token>` read from `window.__MOKEI_TOKEN__`.
  (`@enkaku/http-client-transport` `ClientTransport` accepts a custom `fetch` but
  no header option — no upstream change needed.)
- **Validate** in a Hono middleware on `/api`:
  1. `Host` header must match the `host:port` allowlist
     (`127.0.0.1:PORT`, `localhost:PORT`, plus the bind host when remote).
  2. `Origin`, when present, must match the allowlist.
  3. Token constant-time compare (`crypto.timingSafeEqual`).
  4. Any failure → `403` plain text, no detail.
- Static asset GETs need no token (no side effects).

### 3. Daemon socket `0600`

- After `server.listen()` (`host/src/server.ts:146`), `chmodSync(socketPath, 0o600)`.
- A `chmod` failure is **fatal** — refuse to serve an insecure socket.
- Document the trust boundary (same-user only) in a code comment and the README.
- Rationale: the monitor observes MCP *contexts* (all spawned by the daemon as
  the same user) — `0600` does not reduce its visibility. It only blocks a
  *different* OS user from opening the socket and driving the `spawn` channel
  (local code exec as you). Cross-user monitoring would be a deliberate
  authenticated feature, out of scope here.

### 4. Daemon split-brain + signal handling

- **Connect-before-remove** in `process.ts`: try connecting to an existing
  socket first. Connect succeeds → a live daemon already owns it → exit cleanly,
  do not spawn a second. Connect fails (`ECONNREFUSED` / `ENOENT`) → stale →
  remove and start.
- **Signal handlers**: `SIGTERM` / `SIGINT` run the existing `shutdown` path
  (kill children, remove socket). Today a killed daemon leaks both the socket
  file and its spawned MCP children.
- **Children-kill on shutdown**: track spawned child PIDs in `HandlersContext`
  and kill all of them on shutdown. Currently only the per-connection abort
  handler (`server.ts:73-79`) kills a child.

### 5. Spawn races (controller / process)

- Replace the flat `setTimeout(300)` (`process.ts:41`) with **poll-the-socket
  with backoff** until connectable or a timeout — no spurious failure on slow
  startup.
- Guard `rmSync` (`controller.ts:53`) — tolerate `ENOENT` (concurrent removal).
- Two clients both seeing `ECONNREFUSED` both spawn daemons. Mitigate via the
  item-4 connect-before-remove check (the losing daemon's startup connects,
  finds a live owner, and exits cleanly) plus a retry connect after spawn.

## Error handling

- Gate rejects → `403` plain text, no internal detail leaked.
- Daemon startup losing the race → silent clean exit, not an error.
- Socket `chmod` failure → fatal; the daemon refuses to serve.

## Testing

- **Monitor gate** (unit on the Hono app): reject missing token, reject bad
  `Host`, reject bad `Origin`, accept good token + Host.
- **Socket perms**: `statSync` mode is `0600` after listen.
- **Split-brain**: start two daemons on the same socket → the second exits, the
  first's children stay alive.
- **Race**: parallel `runDaemon` calls → exactly one daemon, both clients
  connect successfully.

## Out of scope

- Cross-user authenticated daemon access (would need socket-level auth).
- The MCP HTTP server's Origin-validation default — tracked separately in
  `backlog/2026-06-12-mcp-2025-11-25-conformance.md` (different package, same
  attack class).

## Files touched

- `packages/host-monitor/src/index.ts` — host bind, token mint, HTML injection
  route, `/api` gate middleware.
- `monitor/src/host/client.ts` (+ rebuild → `dist`) — wrapped `fetch` sending
  the token.
- `packages/host/src/server.ts` — socket `chmod 0600`, track child PIDs,
  shutdown kills all children.
- `packages/host/src/daemon/process.ts` — connect-before-remove, signal
  handlers, socket polling.
- `packages/host/src/daemon/controller.ts` — guarded `rmSync`, retry connect.
- CLI `monitor` command — `--host` flag.
