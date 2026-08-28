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

`serveHTTP` starts an HTTP server (via `@hono/node-server`) that bridges each session
to a `ContextServer` you create per connection:

```typescript
import { serveHTTP } from '@mokei/http-server'
import { ContextServer } from '@mokei/context-server'

const { server, dispose } = serveHTTP({
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

// Later, to shut down:
dispose()
```

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
`subscriptions/listen` POSTs are served against transport-isolated per-POST servers that
*borrow* that hub — they do not own it. The handler's own `dispose()` (the value returned by
`serveHTTP`, or `handler.dispose()`) is therefore only the abrupt backstop: it does not
gracefully complete open subscriptions, so any still-open `subscriptions/listen` stream is torn
down abruptly with no terminal frame written.

To shut down gracefully, dispose the durable hub-owning `ContextServer` first (or call
`hub.endAllGracefully()` directly), and only then call the HTTP handler's `dispose()`:

```typescript
// 1. Gracefully complete every open subscription against the durable hub-owning server.
await hub.endAllGracefully()

// 2. Only now tear down the HTTP layer.
await dispose()
```

## Documentation

See the full documentation at [mokei.dev](https://mokei.dev).

## License

MIT
