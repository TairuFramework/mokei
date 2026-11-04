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

For an existing `@sozai/http-server` application, install `mcpPlugin` alongside
other `@sozai/http-server` plugins, such as Teikyo's. OAuth resource protection comes from
`@teikyo/oauth`:

```typescript
import { createServer } from '@sozai/http-server'
import { oauthResourcePlugin } from '@teikyo/oauth'
import { mcpPlugin } from '@mokei/http-server'
import { ContextServer } from '@mokei/context-server'

const app = await createServer({
  plugins: [
    oauthResourcePlugin({ resource, authorizationServers, verifier }),
    mcpPlugin({
      createServer: ({ transport, auth, resolveAuth }) =>
        new ContextServer({ transport, auth, resolveAuth, name, version, tools }),
      auth: { scopes: ['tools:read'] },
    }),
  ],
})
await app.listen()
console.log(`${app.url}/mcp`)
```

Handlers read the verified caller from `request.auth`: `issuer`, `subject`, `scopes`, `expiresAt`
and `claims`. `claims` holds the verifier's decoded claims. The verifier checked their signature,
but their shape depends on the verifier. Forward `auth` and `resolveAuth` from `createServer` to
`ContextServer`. On `2025-11-25` sessions, `resolveAuth` gives each request the auth of the token
that carried it, so scopes and expiry stay current after a refresh.

### Per-tool, prompt and resource scopes

`auth.scopes` (or `serveHTTP`'s `auth.requiredScopes`) is required on every request. Tools,
prompts and resources can also require scopes of their own:

```typescript
const tools = {
  purge: createTool({
    description: 'Delete everything',
    inputSchema: { type: 'object' } as const,
    scopes: ['admin'],
    handler: () => ({ content: [] }),
  }),
}
const prompts = {
  audit: createPrompt({ description: 'Audit log', scopes: ['admin'], handler }),
}
const resources = {
  read,
  // One list for every URI, or a synchronous function of the URI.
  scopes: (uri: string) => (uri.startsWith('admin://') ? ['admin'] : []),
}
```

When a `tools/call`, `prompts/get` or `resources/read` carries a token without the scopes it
needs, the handler answers before the request reaches the server, on both revisions. The response
is `403` with a JSON-RPC error body and a challenge naming the server-wide scopes and the
entry's scopes:

```
WWW-Authenticate: Bearer error="insufficient_scope", scope="tools:read admin",
  resource_metadata="…", error_description="tools/call purge requires scope admin"
```

The check reads the parsed body. `ContextServer` enforces the scopes too, whenever a request
carries auth. Without auth (stdio, or HTTP without OAuth), scopes are not enforced.
`tools/list` and `prompts/list` advertise each entry's scopes under
`_meta['dev.mokei/scopes']` (`SCOPES_META_KEY`), and list every entry whatever the caller's
scopes, so step-up can unlock it. `@mokei/http-client`'s OAuth middleware steps up on the `403`.

### Standard request headers

On `2026-07-28`, POSTs must carry the SEP-2243 standard headers, and they must agree with the
body. A request needs `MCP-Protocol-Version` (equal to its `_meta` revision) and `Mcp-Method`.
On `tools/call`, `prompts/get`, `resources/read` and `tasks/get|update|cancel` it also needs
`Mcp-Name`, decoded from the `=?base64?…?=` sentinel when wrapped. Notifications are only checked
for disagreement. Any failure answers `400` with JSON-RPC `-32020` and
`data.mismatch: { header, body }`, before the scope check. `@mokei/http-client` always sends
these headers. Callers that build requests by hand must add them. `validateStandardHeaders` and
`decodeHeaderValue` are exported.

On `tools/call`, each argument the tool's `inputSchema` marks with `x-mcp-header` must arrive in
a matching `Mcp-Param-{Name}` header. An absent or `null` argument needs none, numbers compare
numerically, and tools with invalid annotations are skipped. A missing, badly encoded or
different header is rejected the same way, naming the header in `data.mismatch.header`.
`@mokei/http-client` treats that as a stale schema: it refreshes `tools/list` and retries once.
`validateParamHeaders` is exported.

A `2025-11-25` session is bound to the issuer and subject that sent `initialize`. A request from
any other identity that names the session (POST, GET or DELETE) gets the same `404` as an
unknown session id.

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
and disposes the hub separately. `handler.shutdown()` ends every subscription in the supplied hub,
including those served by other handlers or transports sharing it. Shutdown does not dispose the hub.

The result of `await serveHTTP(...)` delegates disposal to the HTTP server. Its shutdown hooks
complete open subscriptions with terminal frames before closing the handler. In-flight stateless
requests may hold disposal up to `graceMs`. Await `dispose()` to finish shutdown.

An embedded `createHTTPHandler` needs an explicit graceful shutdown before disposal:

```typescript
await handler.shutdown()
await handler.dispose()
```

## Documentation

See the full documentation at [mokei.dev](https://mokei.dev).

## License

MIT
