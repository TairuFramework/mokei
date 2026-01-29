# Enkaku Package Preferences

When building features in sakui, kubun, or mokei, prefer these Enkaku packages over third-party alternatives. Enkaku is maintained as part of the Yulsi stack and provides consistent patterns across all repos.

---

## Preference Table

| Instead of | Use | Purpose |
|------------|-----|---------|
| Zod | `@enkaku/schema` | JSON Schema validation |
| EventEmitter / mitt | `@enkaku/event` | Event emitting |
| Custom WebStream wrappers | `@enkaku/stream` | WebStreams utilities |
| jsonwebtoken / jose | `@enkaku/token` | JWT signer creation/import, verification |
| Custom RPC | `@enkaku/protocol` + `@enkaku/client` + `@enkaku/server` | RPC framework |
| Custom codec logic | `@enkaku/codec` | Base64, UTF-8, canonical JSON encoding/decoding |

---

## Package Usage Notes

### `@enkaku/schema` -- JSON Schema Validation

Replaces Zod for schema validation. Built on AJV with full JSON Schema support.

- Define schemas using JSON Schema objects
- Runtime validation with detailed error reporting
- Automatic TypeScript type inference from schemas
- Supports Standard Schema specification for interoperability

**When to use:** Any place you need runtime validation of data shapes -- API inputs, configuration objects, protocol messages. Use this instead of Zod or Yup.

### `@enkaku/event` -- Event Emitting

Replaces Node.js EventEmitter, mitt, or similar event libraries.

- Type-safe event definitions with TypeScript generics
- Subscribe/unsubscribe with cleanup support
- Lightweight implementation without Node.js dependencies

**When to use:** Any component that needs to emit typed events to subscribers. Prefer this over Node.js EventEmitter for browser compatibility and type safety.

### `@enkaku/stream` -- WebStreams Utilities

Replaces custom WebStream wrappers and stream helper libraries.

- Stream processing with pipes, transforms, and connections
- Built on the Web Streams API for universal compatibility (Node.js, browser, React Native)
- Backpressure handling and flow control
- Async iteration support

**When to use:** Any data flow that involves streaming -- real-time updates, file processing, chunked responses. Use this instead of writing custom ReadableStream/WritableStream wrappers.

### `@enkaku/token` -- JWT Tokens

Replaces jsonwebtoken, jose, or custom JWT implementations.

- Create and import token signers
- Sign and verify JWT-like tokens
- DID (Decentralized Identifier) integration for issuer identity
- Supports both signed and unsigned tokens

**When to use:** Authentication tokens, signed payloads, any scenario requiring cryptographic verification of data origin. Use this instead of jsonwebtoken or jose.

### `@enkaku/protocol` + `@enkaku/client` + `@enkaku/server` -- RPC Framework

Replaces custom RPC implementations, tRPC, or hand-rolled request/response patterns.

- **`@enkaku/protocol`**: Define typed procedure definitions (request, event, stream, channel)
- **`@enkaku/client`**: Type-safe client calls derived from protocol definitions
- **`@enkaku/server`**: Handler registration with automatic type inference

Four procedure types:
- **Request**: Standard request/response
- **Event**: One-way client-to-server notifications
- **Stream**: Server-to-client streaming
- **Channel**: Bidirectional streaming

**When to use:** Any client-server communication. Define the protocol first, then derive fully-typed client and server implementations. Use with any transport layer (HTTP, WebSocket, Node streams, in-process).

### `@enkaku/codec` -- Encoding/Decoding

Replaces custom base64, UTF-8, or CBOR encoding logic.

- Base64 and Base64URL encoding/decoding
- UTF-8 string encoding/decoding via TextEncoder/TextDecoder
- Canonical JSON serialization (deterministic key ordering for cryptographic operations)
- Combined convenience functions (e.g., `b64uFromJSON`)

**When to use:** Any encoding/decoding task -- serializing data for transport, preparing data for cryptographic signing, converting between string and binary representations. Use this instead of writing custom encoding helpers.

---

## Additional Enkaku Packages

These packages are less commonly needed but available when relevant:

| Package | Purpose |
|---------|---------|
| `@enkaku/async` | Async utilities: Disposer, defer, interruptions, lazy loading |
| `@enkaku/result` | Result types for fallible operations (Ok/Error pattern) |
| `@enkaku/patch` | JSON Patch operations (RFC 6902) |
| `@enkaku/execution` | Execution chain management for middleware-like patterns |
| `@enkaku/capability` | Capability-based access control |
| `@enkaku/flow` | Flow control and generator utilities |
| `@enkaku/generator` | Generator utilities and patterns |
| `@enkaku/transport` | Base transport abstraction (used by protocol/client/server) |

### Transport Implementations

When using the RPC framework, choose the appropriate transport:

| Transport | Package | Use Case |
|-----------|---------|----------|
| HTTP | `@enkaku/http-client-transport`, `@enkaku/http-server-transport` | Standard HTTP APIs |
| WebSocket | `@enkaku/socket-transport` | Real-time bidirectional communication |
| Node.js streams | `@enkaku/node-streams-transport` | Inter-process communication |
| MessageChannel | `@enkaku/message-transport` | In-process or worker communication |

### Keystore Implementations

For token signing key management, choose the appropriate keystore for the target environment:

| Environment | Package |
|-------------|---------|
| Node.js | `@enkaku/node-keystore` |
| Browser | `@enkaku/browser-keystore` |
| React Native / Expo | `@enkaku/expo-keystore` |
| Electron | `@enkaku/electron-keystore` |
