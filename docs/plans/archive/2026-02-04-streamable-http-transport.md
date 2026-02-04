# Streamable HTTP Transport

**Status:** complete

## Summary

Added `@mokei/http-client` and `@mokei/http-server` packages implementing the MCP Streamable HTTP transport ([2025-11-25 specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#streamable-http)).

### What was built

- **`@mokei/http-client`**: Client transport extending `Transport<ServerMessage, ClientMessage>` from `@enkaku/transport`
  - `HTTPTransport` class -- POST for sending JSON-RPC messages, SSE response handling via `parse-sse`, GET stream for server-initiated messages, session ID lifecycle (`Mcp-Session-Id` header), DELETE on dispose
  - `createHTTPClient()` convenience factory (transport + `ContextClient` wired together)
  - `buildHTTPHeaders()` with `HTTPAuthOptions` (bearer, basic, custom header)

- **`@mokei/http-server`**: Server-side HTTP handler with multi-session support
  - `createHTTPHandler()` -- framework-agnostic `Request -> Response` handler with origin validation, session management, POST/GET/DELETE routing, SSE streaming for responses, and resumability via `Last-Event-ID` replay
  - `SessionManager` -- session creation, tracking, expiry, and cleanup
  - `SSEWriter` -- SSE event formatting with replay buffer
  - `serveHTTP()` -- convenience function (full Hono app on a port)

- **Host migration**: `packages/host/src/http-transport.ts` deleted, replaced by `@mokei/http-client` dependency

- **Integration test**: End-to-end test wiring `HTTPTransport` client to `serveHTTP` server with full session lifecycle
