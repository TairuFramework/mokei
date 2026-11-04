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

// No handshake on 2026-07-28 — the client sets itself up lazily on its first call, opening
// with one `server/discover` bounded by `setupTimeout` so a server that never answers fails
// instead of hanging.
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

The `2025-11-25` session GET/SSE stream (opened to receive server-initiated notifications
outside a request/response cycle) is deprecated on `2026-07-28` (SEP-2577), though it remains
fully supported here for the deprecation window. On `2026-07-28` notifications travel on the
POST response instead, so there's no equivalent session stream on that revision — this note
does not apply to, and does not deprecate, the `2026-07-28` Streamable HTTP transport itself.

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
Those take a `protocolVersion` too, defaulting to `'auto'`.

## OAuth

`createOAuthMiddleware({ clientID, scopes, resource, handler, store })` gives `HTTPTransport` an
OAuth 2.1 client. It attaches stored bearer tokens, refreshes them shortly before they expire,
and on a 401 discovers the authorisation server and runs PKCE through `handler`.

Tokens live in a `TokenStore`, which is a `KeyValueStore<StoredTokens>`. The generic
`KeyValueStore<V>` interface (`get`, `set`, `delete`, `keys` and an atomic `update`) and its
in-memory implementation `createMemoryStore<V>()` are exported for any other use.
`@mokei/host-node` adds `createJSONFileStore<V>(path)` and `createFileTokenStore(path)`, a JSON
file whose writes are locked across processes. The default store is in memory.

- Tokens are keyed by `tokenStoreKey({ resource, clientID, scopes })`, so clients with
  different IDs or scope sets on one resource keep separate tokens.
- Every middleware sharing a store shares its in-flight refreshes and sign-ins.
- A refresh runs inside `store.update`. With the file store, processes that share a tokens file
  redeem a rotating refresh token once.
- Sign-ins through one `AuthorizationHandler` run one at a time.

### Step-up on `403 insufficient_scope`

When a server answers `403` with a `Bearer error="insufficient_scope", scope="…"` challenge, the
middleware signs in again for the configured scopes, the stored token's scopes and the challenge
scopes together. It stores the new token under the same key and retries the request once.
`StoredTokens.requestedScopes` records the wider set, so later refreshes and re-authorisations do
not narrow it. A `scope` in a 401 challenge joins the authorisation request the same way.

The middleware never prompts for scopes it has already requested. If the authorisation server
granted less than it asked for, the `403` is returned, and the transport surfaces the server's
JSON-RPC error. Concurrent `403`s for one key prompt once. Pass `stepUp: false` to return every
`403` unchanged. `parseBearerChallenge(header)` is exported for reading other challenges.

## Documentation

See the full documentation at [mokei.dev](https://mokei.dev).

## License

MIT
