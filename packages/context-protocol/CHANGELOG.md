# @mokei/context-protocol

## 0.16.2

## 0.16.1

### Patch Changes

- Adopt upstream fixes: runtime schema validators come from `@sozai/schema`'s `createValidatorCache` (decision flow graphs now share a bounded cache by default), the monitor ends SSE sessions with the enkaku bridge's `dispose()` on daemon reconnect, `serveHTTP` reads the MCP handler with `HTTPServer.use`, and `MOKEI_VERSION` reports 0.16.0. Requires `@enkaku/*` 0.23.2 and `@sozai/http-server` 0.2.2.

## 0.16.0

### Minor Changes

- OAuth scope follow-ons and SEP-2243 header validation. Prompts (`createPrompt({ scopes })`) and resources (`ResourceDefinitions.scopes`, a list or a synchronous function of the URI) can require scopes, enforced on `prompts/get` and `resources/read` exactly like tool scopes, including the HTTP `403 insufficient_scope` and client step-up. `ContextServer.requiredScopes` covers all three. `tools/list` and `prompts/list` now advertise scopes under `_meta['dev.mokei/scopes']` (`SCOPES_META_KEY`). They are not filtered by the caller's scopes. **Breaking:** on `2026-07-28` the HTTP server now validates the SEP-2243 standard request headers against the body. A request must carry `MCP-Protocol-Version` and `Mcp-Method`, plus `Mcp-Name` on `tools/call`, `prompts/get`, `resources/read` and `tasks/get|update|cancel`, and every header must agree with the body. A missing or disagreeing header is rejected with `400` and JSON-RPC `-32020` (`data.mismatch: { header, body }`), which also replaces the old plain-text `400` for a version mismatch. `@mokei/http-client` already sends these headers. Hand-built requests must add them. `validateStandardHeaders` and `decodeHeaderValue` are exported from `@mokei/http-server`, and `MCP_NAME_HEADER_SOURCE` from `@mokei/context-protocol`, which `@mokei/http-client` now reads too.

- SEP-2243 `Mcp-Param-*` validation on the server. On a `2026-07-28` `tools/call`, the HTTP server checks each `Mcp-Param-{Name}` header against the arguments the tool's `x-mcp-header` annotations name. An absent or `null` argument needs no header, numbers compare numerically, and tools with invalid annotations are skipped. A missing, badly encoded or different header is rejected with `400` and `-32020`, and `data.mismatch.header` names the `Mcp-Param-*` header. This runs before the scope check. New: `validateParamHeaders` (`@mokei/http-server`) and `ContextServer.toolInputSchema(name)`. `collectHeaderAnnotations`, `isValidHeaderParamName` and their types move to `@mokei/context-protocol`, and `@mokei/http-client` still re-exports them. Fix: the client's stale-schema refresh now reads a `tools/list` answer sent over SSE. Before, it only accepted JSON, so the refresh-and-retry never worked against a stateless mokei server.

### Patch Changes

- `MOKEI_VERSION` (exported from `@mokei/context-protocol` and `@mokei/context-server`) replaces stale hard-coded versions: the default MCP `clientInfo`, the decision-flow, fetch, sqlite and system-one `serverInfo`, and the `mokei` tracer and meter scopes now report the package version.

## 0.15.0

### Minor Changes

- Add the MCP Tasks extension for 2026-07-28: durable server tasks, task input and cancellation, authorised subscriptions, automatic client waiting, HTTP routing. Task input history persists in `TaskRecord.inputs`; withdrawn requests reject with `InputRequestWithdrawnError` and identical `requestInput` replays settle outcomes. `TaskManager.update` rejects non-outstanding keys with -32602. Add MRTR (SEP-2322) fixes: typed `allowInputRequired`, empty `inputRequests` rejected, exported `defaultMintRequestState`.

- Breaking: error classes and positional constructors take a single params object (`new TokenVerificationError({ code, message })`, `ProxyHost({ client })`) with read-only getters and exported `<ClassName>Params` types. `ContextHost` drops `_contexts`, `_localTools`, `_events`, `_dispose`; use `contexts`, `localTools`, `events` and `ContextHostParams.dispose`. `initializeTimeout` → `setupTimeout`. Flow-host drops `TERMINAL_STATES`; use `isTerminalRunState` from flow-client.
