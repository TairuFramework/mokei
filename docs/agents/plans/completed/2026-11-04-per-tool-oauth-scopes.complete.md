# Per-tool OAuth scopes and step-up

**Status:** complete
**Date:** 2026-11-04
**Origin:** `backlog/2026-09-04-oauth-hardening-followups.md` (first item). Builds on
`completed/2026-11-04-oauth-identity-and-token-coordination.complete.md`.

## Goal

Let a tool require OAuth scopes beyond the server-wide `requiredScopes`. A call made with a token
that lacks them gets HTTP `403` with an `insufficient_scope` challenge on both protocol revisions,
and the client OAuth middleware steps up: it re-authorises for the wider scope set and retries the
call once.

## Open design questions and resolutions

### 1. How does `2025-11-25` get a 403 without the `Mcp-Method` header?

The backlog assumed the gate would sit in front of the MCP handler, where only `2026-07-28` could
name the tool from the `Mcp-Method` and `Mcp-Name` headers (SEP-2243) without reading the body.
That premise does not hold. `createHTTPHandler` already reads and parses the JSON-RPC body of every
POST on both revisions, because it needs the body to route the request (stateless `_meta`,
`initialize`, session dispatch). So the scope check runs **inside the handler, after parsing and
before dispatch**, and reads `method` and `params.name` from the body:

- `2025-11-25` session path: checked before the request is queued on the session bridge, so the
  check happens before the `200` SSE response opens.
- `2026-07-28` stateless path: checked before `runStatelessExchange` queues the message on its
  per-POST server. Nothing has been written yet, so the exchange can still answer `403`.

**The headers are never used for authorisation.** The mokei HTTP server does not check that the
`Mcp-*` headers match the body. A gate keyed on `Mcp-Name` would let a client send
`Mcp-Name: harmless` with a body that calls the privileged tool. Reading headers before the body
would also save nothing: the body has to be parsed anyway. A header-based gate in front of the
handler would only make sense if the handler also rejected header/body mismatches. That is
deferred.

### 2. How does the transport learn a tool's scopes?

`createTool({ scopes })` (and `GenericToolDefinition.scopes`) declares them on the tool, and
`ContextServer.requiredScopes(request)` returns them for a `tools/call` request (`[]` for anything
else or an unknown tool). The handler asks the server that will serve the request: the session's
server on `2025-11-25`, and the per-POST server on `2026-07-28`, through a new `authorize` hook on
`runStatelessExchange` that runs after the server is built and before the message is queued. This
means scopes are not configured twice, and a `createServer` that builds different tools per
caller still gets the right answer.

### 3. Does `ContextServer` enforce scopes itself?

Yes, as a second layer: when a request carries auth and a tool's scopes are not all in
`auth.scopes`, `tools/call` fails with a JSON-RPC `INVALID_REQUEST` error whose `data` is
`{ error: 'insufficient_scope', scopes }`. This covers transports that supply auth but have no HTTP
gate. With no auth at all (stdio, or an HTTP server without OAuth), scopes are not enforced.
`auth` is the only identity a server has, and a stdio server reusing the same tool definitions
would otherwise reject every call.

### 4. What goes in the challenge `scope`?

The MCP authorisation spec says the challenge should list the scopes "needed to satisfy the
current request". So it lists the server-wide `requiredScopes` plus the tool's scopes. The
token's other scopes are left out: the client already knows them, and merges them in itself
(question 5). The challenge also carries `error="insufficient_scope"`, `resource_metadata` (when
the handler knows the metadata URL: `mcpPlugin` passes `OAUTH_RESOURCE.metadataURL`) and an
`error_description`. The body is a JSON-RPC error, which the client transport already surfaces
to the caller, so a client that cannot step up still sees a readable error, not just `HTTP 403`.

### 5. Where does a stepped-up token live on the client?

It stays under the **same** `tokenStoreKey` (configured scopes). Keeping one token per scope set
would force the middleware to choose a token for each request. `StoredTokens` gains
`requestedScopes`: the scopes sent in the authorisation request. Step-up asks for the union of the
configured scopes, the stored `requestedScopes`, the scopes the token was granted and the
challenge scopes, so the set only grows and earlier consent is not lost. Refreshes send
`requestedScopes` rather than `config.scopes`, so a refresh does not narrow a stepped-up token. A
401 re-authorisation keeps the elevated set too, and adds any `scope` the 401 challenge names.

Step-up is interactive: under RFC 6749 §6 a refresh cannot widen scope. Loop guards:

- one step-up per request;
- no step-up when the challenge names no scope or its scopes are already requested (the
  authorisation server refused them, or the server's policy is wrong). The `403` is passed
  through to the caller;
- step-ups join the shared single flight for the key, so concurrent `403`s prompt once. A joiner
  accepts the new token only if it covers the scopes that joiner needs.

`OAuthClientConfig.stepUp: false` turns step-up off: every `403` is passed through.

### 6. Out of scope (deferred)

- Advertising tool scopes in `tools/list`, or filtering the list by the caller's scopes.
- Scopes on prompts and resources.
- A pre-body gate keyed on the `Mcp-*` headers (needs header/body mismatch rejection first).

## Tasks

All done. Tests: `context-server/test/tool-scopes.test.ts`,
`http-server/test/serve-auth-scopes.test.ts` (both revisions, plus the header-mismatch bypass
case), `http-client/test/oauth-step-up.test.ts` and the step-up case in
`http-server/test/oauth-e2e.test.ts`.

1. `@mokei/context-server`: `scopes` on `GenericToolDefinition` / `createTool`, kept out of
   `tools/list`. `ContextServer.requiredScopes()`. `tools/call` enforcement when auth is present.
   `missingScopes` helper.
2. `@mokei/http-server`: `HTTPHandlerParams.oauth` (`resourceMetadataURL`, `requiredScopes`), the
   scope check on the session and stateless paths, an `authorize` hook on
   `runStatelessExchange`, and `mcpPlugin` and `serveHTTP` passing the metadata URL and the
   server-wide scopes.
3. `@mokei/http-client`: `parseBearerChallenge`, `StoredTokens.requestedScopes`, 403 step-up,
   refresh with the requested scopes, 401 challenge scopes, and `stepUp` opt-out.
4. Tests: context-server unit tests, handler 403 tests on both revisions, middleware step-up unit
   tests, and an end-to-end step-up test against a real server.
5. Docs: architecture "HTTP Authorisation", http-client README, a changeset, and a backlog update.
