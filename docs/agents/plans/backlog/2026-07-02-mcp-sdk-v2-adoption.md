# MCP SDK v2 — selective adoption

**Status:** backlog
**Origin:** SDK v2 evaluation, 2026-07-02. The official TypeScript SDK
([modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk),
`main` = v2, `2.0.0-beta.2`) was evaluated for adopt / wrap / keep-custom against mokei's
MCP packages. Spec-migration implications recorded in
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

1. **Interop tests (cheap, high value).** Add SDK v2 to `integration-tests/`: mokei
   client ↔ SDK v2 server and SDK v2 client ↔ mokei server, over stdio + Streamable
   HTTP. Doubles as the "live draft peer" for `2026-07-28` wiring validation and the
   G7 part 5 HeaderMismatch story (see `2026-06-20-mcp-draft-remaining.md`).
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

- Packages (all `2.0.0-beta.2`): `@modelcontextprotocol/server`, `/client`, `/core`
  (public Zod schemas only), `/core-internal` (private engine), `/node`, `/express`
  (incl. Resource-Server auth), `/hono`, `/fastify`, `/server-legacy` (frozen v1 SSE +
  AS-side OAuth), `/codemod`.
- Validation: Standard Schema v1 (`~standard.validate` + `~standard.jsonSchema`);
  `fromJsonSchema(doc, validator)` for raw JSON Schema with pluggable
  `jsonSchemaValidator` (AJV on Node, `@cfworker/json-schema` on workers).
- Two protocol eras: legacy (≤`2025-11-25`, default, `initialize`) and modern
  (`2026-07-28`, `server/discover`, opt-in via `versionNegotiation`).
- Timeline: stable expected alongside the `2026-07-28` spec release; v1.x supported
  ≥6 months after v2 ships.
- Docs: https://ts.sdk.modelcontextprotocol.io/v2/
