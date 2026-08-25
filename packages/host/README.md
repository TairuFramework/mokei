# Mokei MCP host

`@mokei/host` is the RN/browser-safe host surface (`ContextHost`, `addDirectContext`,
`addHTTPContext`, local tools, http-client). The Node-only stdio and daemon layer
(`NodeContextHost.addLocalContext`, `spawnHostedContext`, `ProxyHost`, `createClient`,
`runDaemon`) lives in `@mokei/host-node`.

## Installation

```sh
npm install @mokei/host
```

## Protocol revisions

`addHTTPContext`, `addDirectContext`, `createHostedContext`, `NodeContextHost.addLocalContext`
(from `@mokei/host-node`), `spawnHostedContext` (from `@mokei/host-node`) and
`ProxyHost.spawn` (from `@mokei/host-node`) each take an optional `protocolVersion`,
defaulting to `'auto'`: the client probes the server and speaks the newest revision both
sides support, `'2026-07-28'` where the server serves it and `'2025-11-25'` otherwise. Pin
an explicit revision to skip the probe's extra round trip.

## Security

The daemon control socket exposes a `spawn` channel that runs arbitrary
commands. Its trust boundary is the local OS user: the socket is `chmod 0600`
after listen, so only the owner can drive it. The daemon itself does not
authenticate connections — do not relax the socket permissions or expose the
socket to other users.

The monitor UI server binds `127.0.0.1` by default and gates every `/api`
request with a Host-header allowlist (DNS-rebinding defense) plus a per-start
bearer token (CSRF defense). The `--host` opt-in for remote binding still
requires the token; exposing the spawn channel beyond localhost is at the
operator's risk.

## [Documentation](https://mokei.dev)