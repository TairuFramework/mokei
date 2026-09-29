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

## Elicitation

Enable elicitation when constructing a `ContextHost` by passing `elicit` as a handler or `true`:

```typescript
const host = new ContextHost({
  elicit: async ({ key, params, signal }) => {
    // Present params to the user and return an MCP elicitation result.
    return { action: 'decline' }
  },
})
```

Clients built by the host declare elicitation from their first protocol request. The handler
receives the requesting context's `key`, the server's request `params`, and an `AbortSignal`.
Pass `elicit: false` to `createContext`, `addDirectContext` or `addHTTPContext` to opt out one
context. A context registered with `registerHostedContext` keeps the capabilities and handler
configured when its client was built.

An override can observe or handle requests while retaining the host handler as a fallback:

```typescript
const removeOverride = host.handleElicitation(async (request, fallback) => {
  return await fallback({ signal: request.signal })
})
```

Only one override can be installed at a time, and `handleElicitation` requires the host to have
been constructed with `elicit`. Its returned function removes that override. With `elicit: true`,
requests are declined whenever no override is installed. Without an override, a handler passed at
construction answers requests directly.

URL-mode requests are forwarded to the handler with their `mode`, `elicitationId` and `url` intact.
The host does not forward `notifications/elicitation/complete`, so it cannot report completion of
a URL prompt to the application.

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
