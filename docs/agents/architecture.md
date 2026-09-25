# Architecture

## Project Overview

Mokei is a TypeScript toolkit for creating, interacting with, and monitoring clients and servers using the Model Context Protocol (MCP). It provides a comprehensive framework for building MCP-based applications with AI model integration.

**Repository**: https://github.com/TairuFramework/mokei
**Documentation**: `docs/guides/` for usage guides, `docs/reference/` for reference material,
`docs/agents/` for agent-facing docs

---

## Architecture

```
+-------------------------------------------------------------+
|                     AgentSession                             |
|  (Automatic agent loop with tool execution)                  |
+-------------------------------------------------------------+
|                        Session                               |
|  (High-level abstraction for chat + MCP)                    |
+-------------------------------------------------------------+
|                     ContextHost                              |
|  (Manages multiple MCP server connections)                   |
+----------------------------+---------------------------------+
|   ContextClient            |          Model Providers         |
|   (MCP client)             | (OpenAI, Anthropic, Ollama, Llama)|
+----------------------------+---------------------------------+
|   ContextServer            |                                  |
|   (MCP server)             |                                  |
+-------------------------------------------------------------+
```

### Communication Flow

1. `NodeContextHost` (`@mokei/host-node`) spawns MCP server processes over stdio;
   `ContextHost.addHTTPContext` connects over Streamable HTTP
2. Client resolves the protocol revision, then discovers tools and prompts -- through an
   `initialize` handshake on `2025-11-25`, or lazily on the first call on `2026-07-28`
3. Tools are namespaced as `contextKey:toolName` (or `local:toolName` for local tools)
4. Session routes tool calls to appropriate MCP servers
5. Results are aggregated and returned to model providers

### Protocol Revisions

Two MCP revisions are supported side by side rather than one superseding the other. Each is a
`ProtocolDefinition` in `packages/context-protocol/src/versions/`, and `PROTOCOLS` maps a
revision to its definition.

- `2025-11-25` is stateful. An `initialize` handshake opens every connection, and servers may
  send requests to clients, so `sampling`, `elicitation` and `roots` work here.
- `2026-07-28` is stateless. There is no handshake: a client reads capabilities from
  `server/discover` and sets itself up on its first call. The log level travels per request in
  `_meta`. Servers send no requests: `sampling`, `elicitation` and `roots` work here too, through
  multi round-trip requests (MRTR, SEP-2322) instead of server-initiated ones — a `tools/call` /
  `prompts/get` / `resources/read` handler that needs client input suspends by returning a
  terminal `resultType: 'input_required'` result, and is re-invoked once the client answers with
  `inputResponses`. The client's `createMessage`/`elicit`/`listRoots` handlers are driven
  automatically by an auto-fulfilment loop, so callers see the same result type as on
  `2025-11-25` by default. Both revisions are now at capability parity. Resource and list-change
  notifications arrive through a long-lived `subscriptions/listen` request, not session
  `resources/subscribe`. The client uses `SubscriptionDriver`; servers use
  `createSubscriptionHub` and `SubscriptionWriter`. Over HTTP, each listen is a streamed
  exchange handled by `runSubscriptionExchange`.

A client speaks one revision, fixed for the lifetime of its transport. `ContextClient` takes a
`protocolVersion`: a revision, or `'auto'` to probe the server and settle on the newest revision
both sides support. Host contexts and the CLI default to `'auto'`. A server takes
`protocolVersions`, the list it serves; listing both serves both.

On `2026-07-28` the HTTP client encodes the `Mcp-Method`, `Mcp-Name` and `Mcp-Param-*` request
headers (SEP-2243). The `Mcp-Param-*` set comes from the `x-mcp-header` annotations the transport
caches per tool from `tools/list`, so a peer that changes a tool's schema afterwards leaves that
cache stale. The transport recovers on its own: a `tools/call` rejected with `-32020` naming an
`Mcp-Param-*` header triggers its own `tools/list` to refresh the annotations, and the call is
re-sent once if the header set changed. Callers see an ordinary successful call, at the cost of up
to two extra round trips. The HTTP server does not read any of these headers; conformance of the
encoder, and the retry itself, are covered by SDK interop tests instead.

### HTTP Authorization

`@mokei/http-client` provides OAuth 2.1 client middleware through `createOAuthMiddleware` and
`TokenStore` (`createMemoryTokenStore`), including protected-resource metadata discovery, PKCE and
token refresh. `@mokei/host-node` adds `createNodeOAuthMiddleware`, `createFileTokenStore` and
`createLoopbackAuthorizationHandler` for Node consumers. `Session.addHTTPContext` accepts HTTP
contexts; the CLI's `/context add-http` command accepts `--oauth-client-id`, `--oauth-resource`,
`--oauth-scope` and `--oauth-tokens`.

On the server, `@mokei/http-server` offers `serveHTTP` with `createBearerAuthGate`,
`createJWKSVerifier` or `createDIDVerifier`, and `protectedResourceMetadataResponse`. The gate
verifies requests before MCP dispatch; its returned `AuthInfo` is not yet passed to handlers.

---

## API Conventions

### Single Parameters Object
- Every public method takes exactly one parameters object -- no positional arguments
- Transport options are folded into that object: `signal` (abort) and `timeout` (reject with
  `RequestTimeoutError`), plus `maxPages` on the paginated `list*` methods
- Handler callbacks follow the same rule: client `elicit`/`createMessage` receive
  `{ params, signal }`, `listRoots` receives `{ signal }`, a `createTool` handler and a local
  tool's `execute` both receive `{ input, signal }` (the handler also gets `client` and
  `progress`), and `ToolApprovalFn` receives `{ toolCall, iteration, history, tool, signal }`
- **A call carries `arguments`; a handler receives `input`.** `arguments` is MCP's wire field
  (`tools/call`, `prompts/get`) and stays that way on every *call* — `callTool({ name,
  arguments })`. What a *handler* is given is named `input`, because that is what its
  `inputSchema` describes, and because `arguments` is a reserved binding name in strict mode:
  `({ arguments }) => ...` is a SyntaxError in an ES module, so the field could never be
  destructured. `ContextServer` converts at the dispatch seam.
- Local tools run in-process, so `callLocalTool` takes `signal` but no `timeout`
- `ContextRPC.request(method, params, options)` and `.notify(method, params)` stay positional:
  they are the wire boundary, and `splitRequestOptions` separates wire params from local
  transport options before reaching them

---

## Feature Map

| Feature | Package | Entry point |
|---------|---------|-------------|
| Stdio server and spawned contexts | `@mokei/context-server-node`, `@mokei/host-node`, `@mokei/session-node` | `serveProcess`, `NodeContextHost.addLocalContext`, `NodeSession.addContext` |
| Streamable HTTP | `@mokei/http-client`, `@mokei/http-server`, `@mokei/host` | `HTTPTransport`, `serveHTTP`, `ContextHost.addHTTPContext` |
| OAuth 2.1 | `@mokei/http-client`, `@mokei/host-node`, `@mokei/http-server` | `createOAuthMiddleware`, `createNodeOAuthMiddleware`, `createBearerAuthGate` |
| Revisions and negotiation | `@mokei/context-protocol`, `@mokei/context-client` | `PROTOCOLS`, `ContextClient` `protocolVersion: 'auto'` |
| MRTR | `@mokei/context-client`, `@mokei/context-server` | `runInputRequiredFlow`, `inputRequired` |
| Subscriptions | `@mokei/context-client`, `@mokei/context-server`, `@mokei/http-server` | `SubscriptionDriver`, `createSubscriptionHub`, `runSubscriptionExchange` |
| Tool namespacing and per-context tool switches | `@mokei/host` | `ContextHost.callNamespacedTool`, `enableContextTools`, `disableContextTools` |
| Local tools | `@mokei/host` | `ContextHost.callLocalTool`, `packages/host/src/local-tools.ts` |
| Chat and agent loop | `@mokei/session`, `@mokei/session-node` | Portable `Session` and `AgentSession`; Node stdio `NodeSession.addContext` |
| Provider abstraction and adapters | `@mokei/model-provider`, `@mokei/{openai,anthropic,ollama,llama}-provider` | `ModelProvider`, each provider package's `src/index.ts` |
| System One classification | `@mokei/system-one-client`, `@mokei/mcp-system-one` | `HTTPSystemOneBackend`, `createSystemOneTools` |
| CLI | `mokei` | `packages/cli/src/program.ts` |
| Monitor | `@mokei/host-monitor`, `monitor` | `packages/host-monitor/src/index.ts`, `monitor/src/main.tsx` |

`@mokei/session` uses `ContextHost` and is React Native / Metro-safe. `@mokei/session-node`
extends it with `NodeSession` and `NodeContextHost` for stdio contexts.

---

## Package Structure

```
packages/
+-- context-protocol/     # MCP protocol definitions and types
+-- context-rpc/          # JSON-RPC implementation
+-- context-server/       # MCP server implementation (RN/Metro-safe)
+-- context-server-node/  # Node stdio entry for context-server (serveProcess)
+-- context-client/       # MCP client implementation
+-- host/                 # Multi-context orchestrator (RN/Metro-safe)
+-- host-node/            # Node stdio + daemon entry for host
+-- host-protocol/        # Host <-> monitor protocol types
+-- host-monitor/         # Monitor UI for host contexts
+-- http-client/          # Streamable HTTP, OAuth 2.1 client middleware, x-mcp-header encoding
+-- http-server/          # serveHTTP, bearer/JWKS/DID gate, stateless + subscription exchanges
+-- session/              # Portable high-level chat + MCP abstraction
+-- session-node/         # Node stdio session entry
+-- model-provider/       # Provider interface definitions
+-- openai-provider/      # OpenAI integration
+-- anthropic-provider/   # Anthropic Claude integration
+-- ollama-provider/      # Ollama integration
+-- llama-provider/       # Local GGUF inference via node-llama-cpp
+-- system-one-client/    # System One HTTP backend for laya-serve or hosted classification
+-- logger/               # Shared logger utility
+-- cli/                  # mokei CLI (chat, inspect, monitor, proxy commands)
```

`@mokei/host`, `@mokei/context-server` and `@mokei/session` are Node-free so they bundle under React Native /
Metro. Node-only entry points live in the `-node` packages: `serveProcess` is in
`@mokei/context-server-node`, and `addLocalContext` (now a method on `NodeContextHost`),
`spawnHostedContext`, `createClient`, `runDaemon` and `ProxyHost` are in `@mokei/host-node`.
`NodeSession.addContext` and its Node-typed `contextHost` are in `@mokei/session-node`.
File names use kebab-case throughout, except React component files (PascalCase, `ChatApp.tsx`) and React hook files (camelCase, `useSession.ts`).
`HTTPSystemOneBackend` speaks to a `laya-serve` sidecar or the hosted TypeSafe API (see
`docs/reference/system-one-sidecar.md`). The bundled System One MCP server exposes `predict`,
`guard`, `moderate`, `route` and `triage` tools.

Other workspaces:

```
mcp-servers/fetch/        # published MCP server: HTTP fetch
mcp-servers/sqlite/       # published MCP server: SQLite access
mcp-servers/system-one/   # published MCP server: System One classification
integration-tests/        # cross-package + official SDK interop suites (private)
monitor/                  # monitor UI frontend (private)
website/                  # documentation site (private)
```

---

## Where to Find Things

| Looking for... | Location |
|----------------|----------|
| Protocol types | `packages/context-protocol/src/` |
| Protocol revisions | `packages/context-protocol/src/versions/` |
| Server creation | `packages/context-server/src/` |
| Client implementation | `packages/context-client/src/` |
| Host orchestration | `packages/host/src/` |
| HTTP transports and OAuth | `packages/http-client/src/oauth/`, `packages/http-server/src/auth/`, `packages/host-node/src/oauth/` |
| MRTR and subscriptions | `packages/context-client/src/{mrtr,subscriptions}.ts`, `packages/context-server/src/{mrtr,subscriptions}.ts` |
| Session/Agent | `packages/session/src/`, `packages/session-node/src/` |
| System One | `packages/system-one-client/src/`, `mcp-servers/system-one/`; see `docs/reference/system-one-sidecar.md` |
| Bundled MCP servers | `mcp-servers/*/`, development config `mcp-servers/config.json` |
| Provider interface | `packages/model-provider/src/` |
| CLI commands | `packages/cli/src/commands/` |
| Package tests, where present | `packages/*/test/` (not every package has tests) |
| Integration tests | `integration-tests/` |
| SDK interop harness | `integration-tests/support/interop/` |

---

## CLI Commands

```bash
mokei monitor                      # Monitor MCP server contexts
mokei inspect <command> [args...]  # Inspect available tools and prompts
mokei proxy <command> [args...]    # Proxy an MCP server through the daemon
mokei chat --provider ollama       # Interactive chat (ollama, openai, anthropic, llama)
mokei chat                         # Interactive chat, pick a provider interactively
```

---

## Integration with External Providers

Mokei supports multiple LLM providers through a unified provider interface:

- **OpenAI** (`packages/openai-provider/`) -- Integration with OpenAI models
- **Anthropic** (`packages/anthropic-provider/`) -- Integration with Anthropic Claude models
- **Ollama** (`packages/ollama-provider/`) -- Integration with locally-running Ollama models
- **Llama** (`packages/llama-provider/`) -- Local GGUF inference via node-llama-cpp

Each provider implements the `ModelProvider` interface defined in `packages/model-provider/`, enabling consistent usage across different LLM backends.
