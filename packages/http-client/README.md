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
  headers: { 'X-Request-ID': crypto.randomUUID() },
  timeout: 30_000,
})

const initialized = await client.initialize()
const { tools } = await client.listTools()
```

For a lower-level transport you can wire into your own client, use `HTTPTransport` directly:

```typescript
import { HTTPTransport } from '@mokei/http-client'

const transport = new HTTPTransport({ url: 'https://mcp.example.com/mcp' })
```

Most applications connect HTTP contexts through the host via `contextHost.addHTTPContext(...)`
or `session.contextHost.addHTTPContext(...)` rather than constructing the client directly.

## Documentation

See the full documentation at [mokei.dev](https://mokei.dev).

## License

MIT
