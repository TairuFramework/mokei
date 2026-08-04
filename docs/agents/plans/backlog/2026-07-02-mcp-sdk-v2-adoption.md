# MCP SDK v2 — selective adoption

**Status:** backlog
**Origin:** SDK v2 evaluation, 2026-07-02. The official TypeScript SDK
([modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk),
v2, evaluated at `2.0.0-beta.2` and stable at `2.0.0` since) was evaluated for adopt / wrap /
keep-custom against mokei's MCP packages. Spec-migration implications recorded in
`milestones/2026-06-08-mcp-draft-migration.md` (status-update section).

## Decision: keep the custom MCP core

Keep `context-protocol` / `context-rpc` / `context-client` / `context-server` /
`http-client` / `http-server` as-is. Rationale:

- **No à-la-carte adoption possible.** SDK v2's protocol engine, Transport interface,
  wire codecs, and validators live in `@modelcontextprotocol/core-internal` —
  `private: true`, unpublished, "never import directly", bundled into server + client.
  The public `@modelcontextprotocol/core` exports only Zod schema constants. Options are
  wholesale client/server adoption or nothing.
- **Zod stays a hard runtime dependency** (`zod ^4.2`) of server/client/core. v2's
  "JSON Schema instead of Zod" applies to *user* tool schemas (Standard Schema v1 +
  `fromJsonSchema`), not the dependency tree. Conflicts with the stack rule
  (`@sozai/schema` over Zod) for no user-facing gain — mokei is already
  JSON-Schema-native end to end.
- **Bespoke value would be lost:** `FromSchema`-derived typing through
  `createTool`/`ExtractServerTypes`/`ContextTypes` typed clients (SDK has no equivalent),
  the `PendingExchange`/continuation MRTR seam, server-side extension seams richer than
  SDK's (SDK middleware is client-side fetch-only).
- **Enkaku transports never at risk either way:** SDK `Transport` ↔ `@enkaku/transport`
  is a ~50-line adapter in both directions (parsed `JSONRPCMessage` objects cross the
  interface, no framing). Keeping custom forecloses nothing.
- Mokei is already `2025-11-25`-conformant with the hardening sunk (origin validation,
  replay, sessions); swapping the HTTP transports would be regression risk, not payoff.

## Adopt / follow-up items

1. **Interop tests (cheap, high value).** **SHIPPED (2026-07-27, `feat/mcp-sdk-v2-interop`)**
   for the `2025-11-25` era: `integration-tests/support/interop/` defines one fixture
   surface twice (mokei `createTool`/`createPrompt` + SDK `registerTool`/`registerPrompt`
   over `fromJsonSchema` + the Ajv validator, so no Zod in the tests), served over stdio
   (`node` runs the `.ts` entries directly via native type stripping) and Streamable HTTP
   (`serveHTTP` on the mokei side, `NodeStreamableHTTPServerTransport` stateless on the SDK
   side). `suites/interop-sdk-server.test.ts` + `suites/interop-sdk-client.test.ts` run all
   four combinations against shared expectations: negotiated protocol version, `serverInfo`,
   `tools/list` (incl. `outputSchema`), `tools/call` text + `structuredContent`,
   `prompts/list` + `prompts/get`, `resources/list` + `resources/read`.
   SDK pinned as devDependencies of the private `mokei-integration-tests` package, now at
   `2.0.0`. The `2026-07-28` half of the matrix shipped 2026-08-04 (all four quadrants, both
   revisions — `completed/2026-08-04-interop-peer-matrix.complete.md`).
   **Follow-up still open:** multi-page cursor-walk interop, which needs a paginating fixture.
2. **Client OAuth + JWT** — promoted to a dedicated backlog item:
   `2026-07-02-http-auth-oauth.md` (client OAuth via SDK `withOAuth` fetch-middleware
   wrap vs native `@kokuin/token` port, server-side bearer verification for
   `@mokei/http-server`, JWT machine auth).
3. **Standard Schema bridge (consider).** `@sozai/schema` supports Standard Schema; a
   small shim exposing mokei tool definitions as `StandardSchemaWithJSON`
   (`~standard.validate` + `~standard.jsonSchema`) would make mokei-defined tools usable
   in SDK-based servers and vice versa. Ecosystem interop, small effort.
4. **Sampling deprecation watch (session layer).** SEP-2577 deprecates roots / sampling /
   logging (annotation-only, ≥12-month window). Mokei's session/agent layer leans on
   sampling; in the `2026-07-28` era the replacement is MRTR input sub-exchanges (B7).
   Needs a roadmap item when D1–D3 land — no action before the B-wiring.
5. **Conformance oracle.** Use SDK v2's test suites + `docs/migration/upgrade-to-v2.md` +
   `docs/migration/support-2026-07-28.md` as reference material for mokei's conformance
   fixture harness (`context-protocol/test/conformance/`).

## Reference — SDK v2 shape (verified 2026-07-02)

- Packages (evaluated at `2.0.0-beta.2`, released as `2.0.0`): `@modelcontextprotocol/server`, `/client`, `/core`
  (public Zod schemas only), `/core-internal` (private engine), `/node`, `/express`
  (incl. Resource-Server auth), `/hono`, `/fastify`, `/server-legacy` (frozen v1 SSE +
  AS-side OAuth), `/codemod`.
- Validation: Standard Schema v1 (`~standard.validate` + `~standard.jsonSchema`);
  `fromJsonSchema(doc, validator)` for raw JSON Schema with pluggable
  `jsonSchemaValidator` (AJV on Node, `@cfworker/json-schema` on workers).
- Two protocol eras: legacy (≤`2025-11-25`, default, `initialize`) and modern
  (`2026-07-28`, `server/discover`, opt-in via `versionNegotiation`).
- Timeline: v2 shipped stable alongside the `2026-07-28` spec release; v1.x supported
  ≥6 months from that point.
- Docs: https://ts.sdk.modelcontextprotocol.io/v2/
