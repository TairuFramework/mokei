# @mokei/http-server

MCP Streamable HTTP server handler for Mokei.

Serves an MCP `ContextServer` over the [MCP Streamable HTTP](https://modelcontextprotocol.io)
transport, with session management, SSE streaming, replay buffering, and origin
validation (DNS-rebinding protection).

## Installation

```bash
pnpm add @mokei/http-server
```

## Usage

Both protocol revisions are served. A `2025-11-25` client gets a session (`Mcp-Session-Id`,
resumable GET stream, `DELETE` to terminate); a `2026-07-28` client is handled statelessly —
no session is minted, `GET` and `DELETE` return `405`, and each request is answered by its
own short-lived `ContextServer`. List both revisions in `protocolVersions` to reach both.

The `2025-11-25` session GET/SSE stream is deprecated on `2026-07-28` (SEP-2577): on
`2026-07-28`, notifications travel on the POST response of the request that triggered them, so
there is no equivalent stream to deprecate on that revision — it simply doesn't apply there. The
`2025-11-25` session GET stream itself remains fully supported for the deprecation window. This
does not affect the `2026-07-28` Streamable HTTP transport, which is current and not deprecated.

`serveHTTP` starts an HTTP server (via `@sozai/http-server`) that bridges each session
to a `ContextServer` you create per connection:

```typescript
import { serveHTTP } from '@mokei/http-server'
import { ContextServer } from '@mokei/context-server'

const { server, dispose } = await serveHTTP({
  port: 3000,
  hostname: '127.0.0.1',
  path: '/mcp',
  createServer: (transport) =>
    new ContextServer({
      transport,
      name: 'my-server',
      version: '1.0.0',
      protocolVersions: ['2026-07-28', '2025-11-25'],
      tools,
    }),
})

// The bound URL includes the assigned port when port is 0.
console.log(`${server.url}/mcp`)

// Later, to shut down:
await dispose()
```

For an existing `@sozai/http-server` application, install `mcpPlugin` alongside other Teikyo
plugins. OAuth resource protection comes from `@teikyo/oauth`:

```typescript
import { createServer } from '@sozai/http-server'
import { oauthResourcePlugin } from '@teikyo/oauth'
import { mcpPlugin } from '@mokei/http-server'
import { ContextServer } from '@mokei/context-server'

const app = await createServer({
  plugins: [
    oauthResourcePlugin({ resource, authorizationServers, verifier }),
    mcpPlugin({
      createServer: ({ transport }) => new ContextServer({ transport, name, version, tools }),
      auth: { scopes: ['tools:read'] },
    }),
  ],
})
```

`mcpPlugin` registers a shutdown hook that ends subscriptions gracefully before the handler
closes. Its close hook disposes the handler.

OAuth verification and protected-resource metadata are provided by `@teikyo/oauth`. Mokei no
longer exports `createBearerAuthGate`, `createJWKSVerifier`, `createDIDVerifier`,
`protectedResourceMetadataResponse` or `TokenVerificationError`; import the corresponding OAuth
functionality from `@teikyo/oauth` instead.

If a verifier cannot reach its key service, the request returns `503 Service Unavailable`, so a
temporary key outage is not reported as an authentication failure.

The HTTP server keeps Mokei's `SSEWriter` rather than using Hono's `streamSSE`: its replay buffer
and event IDs support MCP stream resumption, which `streamSSE` does not provide.

To embed the handler in an existing HTTP framework, use `createHTTPHandler` and route
requests to its `handleRequest(request)` method:

```typescript
import { createHTTPHandler } from '@mokei/http-server'

const handler = createHTTPHandler({
  createServer: (transport) =>
    new ContextServer({
      transport,
      name: 'my-server',
      version: '1.0.0',
      protocolVersions: ['2026-07-28', '2025-11-25'],
      tools,
    }),
  allowedOrigins: ['https://app.example.com'],
})

const response = await handler.handleRequest(request)
```

## Subscriptions & graceful shutdown

When `subscriptionHub` is passed to `serveHTTP` / `createHTTPHandler`, `2026-07-28`
`subscriptions/listen` POSTs use per-request servers that borrow the hub. The application owns
and disposes the hub separately.

The result of `await serveHTTP(...)` delegates disposal to the HTTP server. Its shutdown hooks
complete open subscriptions before closing the handler. Await `dispose()` to finish shutdown.

An embedded `createHTTPHandler` needs an explicit graceful shutdown before disposal:

```typescript
await handler.shutdown()
await handler.dispose()
```

## Documentation

See the full documentation at [mokei.dev](https://mokei.dev).

## License

MIT
