# @mokei/http-client

MCP Streamable HTTP client transport for Mokei.

Connects an MCP `ContextClient` to a server over the [MCP Streamable HTTP](https://modelcontextprotocol.io)
transport, handling session IDs, JSON and SSE responses, automatic reconnection of the
notification stream, and the protocol version header.

## Installation

```bash
pnpm add @mokei/http-client
```

## Usage

```typescript
import { createHTTPClient } from '@mokei/http-client'

// Create a ContextClient backed by the HTTP transport
const client = createHTTPClient({
  url: 'https://mcp.example.com/mcp',
  protocolVersion: '2026-07-28',
  headers: { 'X-Request-ID': crypto.randomUUID() },
  timeout: 30_000,
})

// No handshake on 2026-07-28 — the client sets itself up lazily on its first call.
const { tools } = await client.listTools()
```

`protocolVersion` is required. Pass `'2025-11-25'` to speak the older revision, which does
have a handshake:

```typescript
const client = createHTTPClient({
  url: 'https://mcp.example.com/mcp',
  protocolVersion: '2025-11-25',
})

const initialized = await client.initialize()
const { tools } = await client.listTools()
```

Pass `'auto'` to probe the server and speak whichever revision it supports. The result is
cached for the life of the client:

```typescript
const client = createHTTPClient({
  url: 'https://mcp.example.com/mcp',
  protocolVersion: 'auto',
})
```

For a lower-level transport you can wire into your own client, use `HTTPTransport` directly.
The transport itself is revision-agnostic — the revision is a `ContextClient` concern:

```typescript
import { HTTPTransport } from '@mokei/http-client'

const transport = new HTTPTransport({ url: 'https://mcp.example.com/mcp' })
```

Most applications connect HTTP contexts through the host via `contextHost.addHTTPContext(...)`
or `session.contextHost.addHTTPContext(...)` rather than constructing the client directly.
Those take a `protocolVersion` too, defaulting to `'2026-07-28'`.

## Documentation

See the full documentation at [mokei.dev](https://mokei.dev).

## License

MIT
