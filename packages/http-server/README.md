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
    new ContextServer({ transport, name: 'my-server', version: '1.0.0', tools }),
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
    new ContextServer({ transport, name: 'my-server', version: '1.0.0', tools }),
  allowedOrigins: ['https://app.example.com'],
})

const response = await handler.handleRequest(request)
```

## Documentation

See the full documentation at [mokei.dev](https://mokei.dev).

## License

MIT
