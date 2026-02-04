# Streamable HTTP Transport

Spec-compliant implementation of the MCP Streamable HTTP transport
([2025-11-25 specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#streamable-http))
for both client and server sides.

---

## Packages

Two new packages:

- **`@mokei/http-client`** -- Client-side HTTP transport
- **`@mokei/http-server`** -- Server-side HTTP handler with multi-session support

### @mokei/http-client

```
packages/http-client/
  src/
    index.ts             # Public exports
    transport.ts         # HTTPTransport class
    auth.ts              # HTTPAuthOptions, buildHTTPHeaders
    sse.ts               # SSE stream handling (uses parse-sse)
  test/
    transport.test.ts
  package.json
```

Dependencies: `parse-sse`, `@enkaku/transport`, `@mokei/context-protocol`, `@mokei/context-client`

### @mokei/http-server

```
packages/http-server/
  src/
    index.ts             # Public exports
    handler.ts           # createHTTPHandler -- framework-agnostic (Request -> Response)
    session.ts           # Session management (create, track, expire, cleanup)
    sse-writer.ts        # SSE event formatting + replay buffer
    middleware.ts        # mcpHTTPMiddleware -- Hono adapter
    serve.ts             # serveHTTP -- convenience function (full Hono app on a port)
  test/
    handler.test.ts
    middleware.test.ts
  package.json
```

Dependencies: `hono`, `@enkaku/transport`, `@mokei/context-protocol`, `@mokei/context-server`

### Dependency Graph

```
@mokei/http-client
  +-- parse-sse
  +-- @enkaku/transport
  +-- @mokei/context-protocol
  +-- @mokei/context-client

@mokei/http-server
  +-- hono
  +-- @enkaku/transport
  +-- @mokei/context-protocol
  +-- @mokei/context-server

@mokei/host (updated)
  +-- @mokei/http-client (replaces internal http-transport.ts)
  +-- ... (existing deps)
```

---

## Client Transport (@mokei/http-client)

### Public API

```typescript
// transport.ts

type HTTPTransportParams = {
  url: string
  headers?: Record<string, string>
  auth?: HTTPAuthOptions
  timeout?: number          // per-request timeout, default 30_000
}

class HTTPTransport extends Transport<ServerMessage, ClientMessage> {
  constructor(params: HTTPTransportParams)
  get sessionID(): string | null
}

// Convenience: transport + client wired together
function createHTTPClient<T extends ContextTypes>(
  params: HTTPTransportParams,
): ContextClient<T>
```

```typescript
// auth.ts

type HTTPAuthOptions =
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'header'; name: string; value: string }

function buildHTTPHeaders(
  baseHeaders?: Record<string, string>,
  auth?: HTTPAuthOptions,
): Record<string, string>
```

### Internal Behavior

**Sending messages (write -> POST):**

Every `write()` becomes an HTTP POST to the MCP endpoint with headers:
- `Content-Type: application/json`
- `Accept: application/json, text/event-stream`
- `MCP-Protocol-Version: 2025-11-25`
- `Mcp-Session-Id: <id>` (once established)

**Receiving POST responses:**

The transport handles both content types from POST responses:
- `application/json` -- parse and enqueue single message to readable stream
- `text/event-stream` -- pipe through `parseServerSentEvents(response)` from `parse-sse`,
  iterate events, parse `event.data` as JSON and enqueue. Track `event.lastEventId` for
  resumability. Read `event.retry` for reconnection timing.
- `202 Accepted` -- no-op (acknowledgment for notifications/responses sent to server)

**Server-initiated messages (GET stream):**

After initialization, opens a GET request to the MCP endpoint with
`Accept: text/event-stream`. Uses `parseServerSentEvents()` for parsing. On disconnect,
reconnects with `Last-Event-ID` header set to last received `lastEventId`. Respects
`retry` field for reconnection delay timing.

**Session lifecycle:**
- Captures `Mcp-Session-Id` from the `InitializeResult` HTTP response header
- Includes it on all subsequent requests
- On HTTP `404` -- signals session expired (caller can re-initialize)
- On `dispose()` -- sends HTTP DELETE with session ID to terminate the session

---

## Server Handler (@mokei/http-server)

### Public API

Three levels of abstraction:

```typescript
// handler.ts -- framework-agnostic

type HTTPHandlerParams = {
  createServer: (transport: ServerTransport) => ContextServer
  allowedOrigins?: Array<string>       // Origin validation
  sessionTimeoutMs?: number            // Session expiry, default: 300_000
  maxSessions?: number                 // Concurrent session limit, default: 1000
  replayBufferSize?: number            // Events to buffer per stream for resumability
}

type HTTPHandler = {
  handleRequest: (request: Request) => Promise<Response>
  dispose: () => void
}

function createHTTPHandler(params: HTTPHandlerParams): HTTPHandler
```

```typescript
// middleware.ts -- Hono adapter

function mcpHTTPMiddleware(params: HTTPHandlerParams): MiddlewareHandler
```

```typescript
// serve.ts -- convenience (full Hono app)

type ServeHTTPParams = HTTPHandlerParams & {
  port?: number            // default: 3000
  hostname?: string        // default: '127.0.0.1'
}

function serveHTTP(params: ServeHTTPParams): { handler: HTTPHandler; /* ... */ }
```

### Multi-Session Architecture

Each client session consists of:
- `sessionID` -- cryptographically random via `crypto.randomUUID()`
- `transport` -- a `ServerTransport` bridging HTTP to the transport interface
- `server` -- a `ContextServer` created by the `createServer` callback
- `postStreams` -- `Map<string, SSEWriter>` active SSE streams from POST requests,
  keyed by JSON-RPC request `id`
- `getStream` -- `SSEWriter | null` the GET SSE stream for server-initiated messages
- `eventBuffer` -- ring buffer of recent `{ id, data }` for replay on reconnect
- `lastActivity` -- timestamp for session expiry

### Request Routing

| Method | Behavior |
|--------|----------|
| POST | Parse JSON-RPC message. If notification/response: enqueue to transport, return `202`. If request: enqueue to transport, open SSE stream, send response + intermediate messages on that stream. |
| GET | Open SSE stream for server-initiated messages. If `Last-Event-ID` header present: replay buffered events, then continue live. |
| DELETE | Terminate session, dispose `ContextServer`, return `200`. |

### Message Routing (transport write -> HTTP)

When `ContextServer` writes a message to the transport, the bridge inspects it:

- **Response** (has `id`, no `method`) -- route to the POST SSE stream matching that
  request ID, then close that stream after sending
- **Server request or notification** (has `method`) -- route to the GET stream if
  available, otherwise to any active POST stream

### Origin Validation

Check `Origin` header on all requests against `allowedOrigins`. Reject with HTTP `403
Forbidden` if invalid. Per the spec, if `Origin` header is present and invalid, servers
MUST respond with 403.

### Session Creation

Triggered by an `InitializeRequest` POST (no `Mcp-Session-Id` header). The handler:
1. Creates a new session with `crypto.randomUUID()`
2. Creates a `ServerTransport` bridge for the session
3. Calls `createServer(transport)` to get a `ContextServer`
4. Returns the `InitializeResult` with `Mcp-Session-Id` response header

### Session Expiry

Periodic cleanup removes sessions idle longer than `sessionTimeoutMs`. The server
responds with HTTP `404` to requests with an expired `Mcp-Session-Id`, signaling the
client to re-initialize.

### Resumability

Each SSE stream assigns globally unique event IDs (unique within the session). Event IDs
encode the originating stream to enable correct replay routing. When a GET request
includes `Last-Event-ID`, the handler replays buffered events from that point on the
matching stream only (per spec: MUST NOT replay messages from a different stream).

### SSE Event Formatting

SSE events are formatted as plain text (no library needed):

```
id: <eventID>
data: <JSON-RPC message>

```

The `retry` field is sent before closing a connection to guide client reconnection timing.
An initial empty `data` event with an event ID is sent to prime the client for
reconnection.

---

## Migration

### Host Package Changes

- Delete `packages/host/src/http-transport.ts` (replaced by `@mokei/http-client`)
- Delete `packages/host/src/http-context.ts` (auth types move to `@mokei/http-client`)
- Update `packages/host/src/host.ts`: `addHTTPContext()` uses `HTTPTransport` from
  `@mokei/http-client`, or delegates to `createHTTPClient()`
- Add `@mokei/http-client` as dependency of `@mokei/host`

---

## Testing

### Client Transport Tests (`packages/http-client/test/transport.test.ts`)

- Mock `fetch` to simulate server responses (JSON, SSE, 202, 404)
- Test session ID capture from response headers and propagation on subsequent requests
- Test SSE stream reconnection with `Last-Event-ID`
- Test `retry` field handling for reconnection delay
- Test disposal sends DELETE request
- Test 404 handling signals session expired

### Server Handler Tests (`packages/http-server/test/handler.test.ts`)

- Create handler with a test `ContextServer` (echo tool)
- Test full initialization flow: POST `InitializeRequest` -> get `Mcp-Session-Id`
- Test request -> SSE response flow
- Test notification -> 202 flow
- Test GET stream for server-initiated messages
- Test resumability: disconnect, reconnect with `Last-Event-ID`, verify replay
- Test session expiry returns 404 after timeout
- Test origin validation returns 403 for invalid origins
- Test DELETE for session termination
- Test `maxSessions` limit

### Server Middleware Tests (`packages/http-server/test/middleware.test.ts`)

- Test Hono middleware wiring with real Hono app
- Test `serveHTTP` convenience function

### Integration Tests (`integration-tests/`)

- Wire `HTTPTransport` client to `createHTTPHandler` server end-to-end
- Full session lifecycle: initialize, call tools, receive notifications, dispose
- Test reconnection and resumability across real HTTP
