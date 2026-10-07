# mokei MCP HTTP on teikyo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run mokei's MCP HTTP server on `@sozai/http-server` as a `'mokei:mcp'` plugin, move OAuth to `@teikyo/oauth`, and end subscriptions gracefully on shutdown.

**Architecture:** `createHTTPHandler` gains a graceful `shutdown()`; a new `mcpPlugin` mounts the handler as a route, optionally behind `@teikyo/oauth`'s `requireBearer()`, and maps `onShutdown`/`onClose` to `handler.shutdown()`/`handler.dispose()`. `serveHTTP` becomes an async wrapper over `createServer`.

**Tech Stack:** TypeScript, `@sozai/http-server` ^0.1.0, `@teikyo/oauth` ^0.1.0, hono, vitest.

**Spec:** `/Users/paul/dev/yulsi/kigu/docs/agents/plans/2026-10-07-teikyo-repo.md`, section *Downstream acceptance consumers → mokei*.

## Global Constraints

- Prerequisite: `@sozai/http-server` 0.1.0 and `@teikyo/oauth` 0.1.0 are published.
- Branch `feat/teikyo-http` in mokei (already created).
- Plugin name `'mokei:mcp'`; default path `/mcp`; default `hostname` for `serveHTTP` stays `127.0.0.1`.
- MCP routes set `ctx.limits(path, { bodyBytes: false, timeoutMs: false })` -- the handler enforces `maxBodyBytes` itself and streams are long-lived.
- Behaviour change, deliberate: an operational verifier failure now returns 503 (teikyo) instead of 500.
- SSE stays on mokei's `SSEWriter`: it carries the replay buffer and event IDs that MCP stream resumption needs, which `hono/streaming` `streamSSE` lacks. Record this in the package README; no migration task.
- Conventions (`kigu:conventions`); no plan references in code or test names; British prose.

## Review Focus

- **A `subscriptions/listen` POST arriving after shutdown began** -- rejected with 503 rather than registering a subscription that `endAllGracefully` already passed. Owned by Task 1.
- **Session servers owning their own subscription hub** -- `shutdown()` must reach them; their `_beforeTransportClose` ends subscriptions gracefully. Owned by Task 1.
- **`serveHTTP` callers relying on the synchronous return** -- every integration-test call site awaits it. Owned by Task 3.
- **Auth configured but no scopes required** -- `requireBearer()` with no scopes still rejects a missing bearer with 401. Owned by Task 2.
- **Metadata route reachable without a token** -- served unauthenticated. Owned by Task 2.

---

### Task 1: Graceful `HTTPHandler.shutdown()`

**Files:**
- Modify: `packages/http-server/src/handler.ts` (`HTTPHandler` type at :127, `createHTTPHandler` at :227, `dispose` at :797)
- Test: `packages/http-server/test/handler-shutdown.test.ts`

**Interfaces:**
- Produces: `HTTPHandler.shutdown(): Promise<void>`. Order: set a `shuttingDown` flag (new `initialize` and `subscriptions/listen` requests then get 503); `await params.subscriptionHub?.endAllGracefully()`; `await sessions.dispose()` (each session server's `_beforeTransportClose` ends its own subscriptions gracefully). Idempotent. `dispose()` stays the abrupt backstop and is safe after `shutdown()`.

- [ ] **Step 1: Write failing tests:**
  - `shutdown ends hub subscriptions with terminal frames` (a `subscriptions/listen` exchange open against a durable hub; `shutdown()` → the client stream receives the terminal frame before closing);
  - `shutdown ends session-owned subscriptions` (session server created with its own hub and an active subscription; `shutdown()` → terminal frame received);
  - `rejects new sessions after shutdown begins` (`initialize` POST → `503`);
  - `rejects new listen requests after shutdown begins` (→ `503`);
  - `dispose after shutdown is safe` (resolves, no throw).
- [ ] **Step 2: Run** `pnpm exec vitest run test/handler-shutdown.test.ts` in `packages/http-server` -- expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full package suite -- expect PASS.
- [ ] **Step 5: Commit** -- `git commit -am "feat(http-server): add graceful handler shutdown"`

### Task 2: `'mokei:mcp'` plugin with teikyo OAuth

**Files:**
- Create: `packages/http-server/src/plugin.ts`
- Delete: `packages/http-server/src/auth/` and `test/auth-{verifier,jwks,did,metadata,require-bearer}.test.ts` (ported to `@teikyo/oauth`)
- Modify: `packages/http-server/package.json` (add `@sozai/http-server`, `@teikyo/oauth`; drop `@kokuin/token` if unused), `src/index.ts`
- Test: `packages/http-server/test/plugin.test.ts`

**Interfaces:**
- Consumes: `OAUTH_RESOURCE`, `getAuthInfo` (`@teikyo/oauth`); `HTTPHandler.shutdown` (Task 1).
- Produces:

```ts
export type MokeiMCP = { handler: HTTPHandler }
export const MOKEI_MCP: PluginName<'mokei:mcp', MokeiMCP>
export type MCPPluginParams = HTTPHandlerParams & { path?: string; auth?: { scopes?: Array<string> } }
export function mcpPlugin(params: MCPPluginParams): AnyHTTPPlugin
```

- Setup: `handler = createHTTPHandler(params)`; when `auth` is set, `dependsOn` includes `OAUTH_RESOURCE` and the route chain starts with `ctx.use(OAUTH_RESOURCE).requireBearer({ scopes: auth.scopes })`; final handler `c => handler.handleRequest(c.req.raw, { auth: auth ? getAuthInfo(c) : undefined })`; `ctx.route('all', path, ...)`; `ctx.limits` per Global Constraints; `onShutdown(() => handler.shutdown())`; `onClose(() => handler.dispose())`.
- `src/index.ts`: remove the auth exports; re-export `AuthInfo` type from `@teikyo/oauth` (used by `createServer` callbacks in `HTTPHandlerParams`).

- [ ] **Step 1: Write failing tests** (`createServer` with `mcpPlugin`, plus `oauthResourcePlugin` with a `createDIDVerifier()` when auth is on):
  - `serves MCP requests without auth`;
  - `rejects a missing bearer with 401 when auth is on` (no scopes configured);
  - `passes verified auth to the MCP server` (subject reaches the `createServer` callback);
  - `serves protected resource metadata without a token`;
  - `ends subscriptions during server shutdown` (`server.dispose()` → terminal frame received; `shutdownReport.forced === false`).
- [ ] **Step 2: Run** -- expect FAIL. **Step 3: Implement.** **Step 4: Run** -- expect PASS.
- [ ] **Step 5: Commit** -- `git commit -am "feat(http-server): add mokei:mcp plugin and move OAuth to teikyo"`

### Task 3: `serveHTTP` on `createServer`

**Files:**
- Modify: `packages/http-server/src/serve.ts`, `test/serve-auth*.test.ts`, `test/oauth-e2e.test.ts`
- Modify: `integration-tests/suites/http-transport.test.ts:42`, `integration-tests/support/interop/servers.ts:379,396,437,495,603,756`

**Interfaces:**
- Produces:

```ts
export type ServeHTTPParams = HTTPHandlerParams & {
  port?: number
  hostname?: string                                   // default '127.0.0.1'
  path?: string                                       // default '/mcp'
  auth?: { verifier: OAuthTokenVerifier; resource: string; authorizationServers: Array<string>; requiredScopes?: Array<string> }
}
export type ServeHTTPResult = { handler: HTTPHandler; server: HTTPServer; dispose: () => Promise<void> }
export function serveHTTP(params: ServeHTTPParams): Promise<ServeHTTPResult>   // listens before resolving
```

  `dispose` = `server.dispose()`.

- [ ] **Step 1:** Update the existing `serve-auth*.test.ts` and `oauth-e2e.test.ts` to `await serveHTTP(...)`, import verifiers from `@teikyo/oauth`, and change `500 when the JWKS cannot be fetched` to expect `503` (rename the test accordingly). Run -- expect FAIL.
- [ ] **Step 2: Implement** `serveHTTP` with `createServer({ port, hostname, plugins: [auth && oauthResourcePlugin(...), mcpPlugin({ ...handlerParams, path, auth: auth && { scopes: auth.requiredScopes } })] })` then `listen()`.
- [ ] **Step 3:** Update the seven integration-test call sites to `await serveHTTP(...)`.
- [ ] **Step 4: Run** `rtk proxy pnpm run test` at the repo root, including integration tests -- expect PASS.
- [ ] **Step 5: Commit** -- `git commit -am "feat(http-server): run serveHTTP on sozai http-server"`

### Task 4: Docs and versioning

- [ ] **Step 1:** Update `packages/http-server/README.md`: `mcpPlugin` usage with other teikyo plugins, `serveHTTP` now async, OAuth via `@teikyo/oauth`, 503 on key outages, why SSE stays on `SSEWriter`. Update `docs/agents/architecture.md` with the new dependency on sozai `http-server` and teikyo.
- [ ] **Step 2:** `pnpm change` -- minor intent for `@mokei/http-server` noting the breaking changes (auth exports removed, `serveHTTP` async, 503).
- [ ] **Step 3:** `rtk proxy pnpm run test` and `rtk proxy pnpm run lint` -- expect success.
- [ ] **Step 4: Commit** -- `git commit -am "docs: document mokei:mcp plugin"`
