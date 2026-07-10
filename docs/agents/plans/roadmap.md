# Mokei Roadmap

**Last updated:** 2026-07-02

## Vision

Complete MCP orchestration toolkit: multi-context host, typed server/client
runtime, provider abstraction across cloud + local models, and monitoring UI.

## Current state

17 packages. Providers: OpenAI, Anthropic, Ollama, Llama (local GGUF).
Streamable HTTP transport shipped as standalone `@mokei/http-client` +
`@mokei/http-server`. Host monitor UI in `host-monitor`. CLI (`mokei`) with a
flat command surface (`chat` / `inspect` / `monitor` / `proxy`): Ink chat UI on
`@mokei/session` (multi-turn, inline tool-approval, per-tool timeout + cancel),
commander routing. Replaced oclif + enquirer + ora.

Stack: migrated to the post-split toolchain (PR #35) — `@kigu/dev` build/test
tooling, the enkaku split (general utilities → `@sozai/*`, RPC/transport core
stays `@enkaku/*`), and `@tejika/*` CLI/server/UI. ISOLATED pnpm linker.

## Competitive position

| Capability            | Mokei | Vercel AI | TanStack AI | MCP SDK |
|-----------------------|-------|-----------|-------------|---------|
| MCP server creation   | Yes   | No        | No          | Yes     |
| MCP client            | Yes   | No        | No          | Yes     |
| Multi-context host    | Yes   | No        | No          | No      |
| Monitoring UI         | Yes   | No        | No          | No      |
| Agent loop            | Yes   | Yes       | Yes         | No      |
| Structured output     | Yes   | Yes       | Yes         | No      |
| OpenAI / Anthropic    | Yes   | Yes       | Yes         | No      |
| Ollama                | Yes   | No        | Yes         | No      |
| Llama (local GGUF)    | Yes   | No        | No          | No      |
| HTTP transport        | Yes   | N/A       | N/A         | Yes     |
| Local tools           | Yes   | Yes       | Yes         | No      |
| CLI                   | Yes   | No        | No          | No      |

## Now (next/)

_Empty — all 2026-06-12 audit `next/` items shipped (see `completed/`)._

Shipped from this audit (see `completed/`):

- **MCP 2025-11-25 feature gaps** (`completed/2026-07-09-mcp-feature-gaps.complete.md`)
  — shipped on `feat/mcp-feature-gaps`: client-side cursor walk in all four list
  methods (fixes silent first-page truncation of `ContextHost`'s tool set), tool
  `outputSchema` + validated `structuredContent` on both sides, `SentRequest`
  replaced by `AbortSignal` injection across the request path, and the
  `UnsubscribeRequest` alias typo. **BREAKING:** `SentRequest`/`requestValue` removed
  and every request method takes an optional `signal`; `createTool`/`createPrompt`
  take a parameters object. `resources/subscribe` (gap 3) deferred into B4.
- **Monitor + daemon security** (`completed/2026-06-16-monitor-daemon-security.complete.md`) —
  items 1–5: monitor localhost bind, `/api` Host-allowlist + bearer-token gate,
  socket `0600`, daemon connect-before-remove + signal shutdown + child reaping,
  socket-poll startup. Closed the unauthenticated RCE.
- **Hang/crash core** (`completed/2026-06-15-hang-crash-core.complete.md`) — items 1–5,
  7–9 (spawn rethrow, RPC read-loop/timeouts/`#sentRequests` leak, client initialize
  hardening, CLI crash paths) merged via PR #25.
- **Stdio framing limits** (`completed/`) — hang/crash item 6, merged via PR #26
  (bounded stdio framing, reap on framing fault).
- **MCP 2025-11-25 conformance** (`completed/2026-06-18-mcp-2025-11-25-conformance.complete.md`)
  — shipped on `fix/mcp-spec-conformance` (PR #28): protocolVersion validation
  (client + HTTP header, items 6/12), client/server capability declarations + gating
  (item 12), sampling/elicitation/tool-result schemas (items 3–5, SEP-1577), tool
  errors as results (SEP-1303, item 11), tool progress notifications, HTTP transport
  MUSTs — negotiated `MCP-Protocol-Version` header, `SessionExpiredError` on 404
  (item 7), secure-by-default Origin validation (item 8), and cross-stream replay
  for GET resumption (SEP-1699, item 9).
- **Provider robustness + sampling params** (`completed/2026-06-18-provider-robustness.complete.md`)
  — shipped on `fix/provider-robustness`: stream-killing parse guards (openai SSE,
  anthropic tool JSON), anthropic input-token accounting fix, ollama `generate()` abort,
  llama failed-load cache + stream-cancel + listener-leak fixes, zero-arg `OpenAIProvider`,
  and per-request sampling params (`temperature`/`maxTokens`/`topP` + raw `providerOptions`)
  across all four providers. **BREAKING: anthropic default request timeout 60s → 30s.**
- **HTTP transport resilience** (`completed/2026-06-19-http-transport-resilience.complete.md`)
  — shipped on `fix/http-transport-resilience`: all 6 audit items. Client — sink never
  throws (failed POST → correlated JSON-RPC error frame, transport stays usable; **contract
  change: `transport.write()` no longer rejects on HTTP error**; session-expiry now a coded
  `SESSION_EXPIRED_CODE`/`isSessionExpiredCode` signal), SSE consumed in background (no
  cancellation deadlock) with connect-only timeout, GET stream reconnect with capped
  backoff + `Last-Event-ID` resume, bounded dispose DELETE. Server — `SessionManager.onDelete`
  closes the transport bridge on idle-timeout/DELETE/dispose (fixes bridge leak), and a
  4 MiB-default `maxBodyBytes` cap returns 413 before buffering (DoS).
- **Host + session lifecycle robustness** (`completed/2026-06-19-host-session-lifecycle.complete.md`)
  — shipped on `fix/session-lifecycle`: all 11 live audit items — SIGTERM→SIGKILL child
  reaping with awaited exit, daemon child-exit cleanup + guarded event writes, setup/remove
  race guard, local-tool AbortSignal plumbing (incl. MCP-converted tools), monitor
  abort-driven pipe teardown, addContext abort orphan (event-race) + `#activeChatRequest`
  clobber guard, bounded+drop-when-no-reader notifications, `anySignal` via `AbortSignal.any`,
  abandoned agent generator closing the provider stream, and `Object.hasOwn` tool/prompt
  lookup hardening. Item 12 (floating cancel notify) was already fixed by the rpc work.
- **Anthropic test — red suite fix** (`completed/2026-06-19-anthropic-test-known-models.complete.md`)
  — commit `eb0f5b6`: deleted the stale `KNOWN_MODELS` import/block, mocked the
  transport for the two `listModels` tests (no live 401). Suite green.
- **CLI UX polish** (`completed/2026-06-19-cli-ux-polish.complete.md`) — commit `1654f8e`:
  API-key fail-fast (before daemon spawn) + env-var/leak help, `inspect` inherits server
  stderr, empty model-list state names the provider.
- **Docs + packaging sweep** (`completed/2026-06-19-docs-packaging-sweep.complete.md`) —
  all 6 items: type-imported `@mokei/*` devDeps→deps (session/providers/host), corrected
  AgentSession/Session/Ollama/anthropic-stream doc examples, `'ask'` doc+code truth-up,
  new READMEs (http-client/http-server/llama-provider), doc-index + root README CLI sync,
  cli `repository` field.
- **CLI `chat --provider llama` wiring + llama integration tests**
  (`completed/2026-06-20-cli-chat-llama-wiring.complete.md`) — shipped via PR #34 (commit
  `c3fa691`). `mokei chat --provider llama` end-to-end: `-m` carries the GGUF path with a
  fail-fast guard + interactive `LlamaPathCard` fallback, basename-derived model identity so
  `listModels`/`/model` work unchanged. Gated, out-of-CI `integration-tests/` (real GGUF):
  provider-level (listModels/streaming/tool-call) + PTY-driven CLI e2e. Closed both paired
  backlog items (`cli-chat-llama-wiring`, `llama-provider-follow-ups`).
- **Stack migration** (`completed/2026-06-22-mokei-stack-migration.complete.md`) — shipped
  via PR #35 (commit `0a0ea88`). Post-split toolchain: `@kigu/dev`, enkaku split
  (`@sozai/*` utilities + `@enkaku/*` RPC core), `@tejika/*`. User-facing: CLI socket flag
  `-s, --path` → `-s, --socket-path`; daemon socket default → `getSocketPath('mokei')`;
  monitor `--host` dropped (loopback-only); frontend token global `__APP_TOKEN__`.

## Milestones (milestones/)

- **MCP draft spec migration** (`milestones/2026-06-08-mcp-draft-migration.md`) —
  in progress. Phase 0 groundwork (G1–G4, G6, G7) shipped on `2025-11-25`
  (PR #23, `feat/mcp-spec-update`). Draft wiring (B1–B7, opt-in coexistence) waits on
  finalization — now dated: the draft is the **`2026-07-28` revision at RC stage**,
  spec release expected July 28, 2026 (SDK v2 stable alongside). U1 resolved + shipped.
  See backlog entries below.

## Near-term (backlog/)

- **MCP draft — remaining work** (`backlog/2026-06-20-mcp-draft-remaining.md`) —
  consolidated tracker. Groundwork done: G1–G8 + G5 outbound/baggage/inbound + G7 walk depth
  (G5 inbound via `@sozai/otel`, enkaku #42). Remaining: G7 part 5 retry (deferred);
  additive draft wiring B1–B7 as opt-in coexistence, blocked on draft finalization only —
  now dated (`2026-07-28` RC; shapes pinnable against SDK v2's wire codecs early).
  No enkaku blockers left.
- **MCP SDK v2 — selective adoption** (`backlog/2026-07-02-mcp-sdk-v2-adoption.md`) —
  outcome of the 2026-07-02 SDK v2 evaluation. Decision: keep the custom MCP core
  (SDK's engine is private/unimportable; Zod hard dep; bespoke typed-client value).
  Follow-ups: SDK v2 interop tests in `integration-tests/` (doubles as the live draft
  peer), Standard Schema bridge (consider), sampling-deprecation watch (SEP-2577).
  OAuth/JWT split out below.
- **HTTP transport auth — OAuth + JWT** (`backlog/2026-07-02-http-auth-oauth.md`) —
  client OAuth 2.1 + PKCE for remote MCP servers (wrap SDK v2 `withOAuth` fetch
  middleware first, native `@kokuin/token` port later), server-side bearer verification +
  protected-resource metadata for `@mokei/http-server` (hono middleware, not SDK's
  Express-only helpers), JWT machine auth (SEP-991 grants / `@kokuin/token` DID tokens).
  Replaces the former P3 "OAuth / auth helpers" line.
- **Stack migration follow-ups** (`backlog/2026-06-22-stack-migration-follow-ups.md`) —
  two non-blocking tooling gaps: node-pty `spawn-helper` `+x` postinstall (PTY suites fail
  `posix_spawnp failed` otherwise), and gate the live OpenAI `session.test.ts` on a key.
- **MCP draft — U1 correlation refactor** — **SHIPPED** (PR #32,
  `completed/2026-06-20-pendingexchange-refactor.complete.md`): `context-rpc`'s `#sentRequests`
  generalized into the `PendingExchange` (resolve-once | streaming) abstraction +
  continuation-token store, behavior-preserving on `2025-11-25`. The seam the draft B7/B4
  wiring plugs into. Decision recorded in `milestones/2026-06-08-mcp-draft-migration.md`.

## Planned — P2

- **Framework middleware** — `@mokei/express`, `@mokei/hono`, `@mokei/fastify`
  adapters wrapping `@mokei/http-server`. Prior art: SDK v2 ships exactly this trio
  (`@modelcontextprotocol/express`/`hono`/`fastify`) as "intentionally thin adapters —
  no new MCP functionality"; same design principle applies. `@mokei/http-server` is
  already hono-based, so `@mokei/hono` is nearly free.
- **Tree-shakeable provider exports** — `@mokei/openai-provider/chat`,
  `/embed`, etc.
- **Enhanced error handling** — retry strategies, circuit breaker for
  failing tools, provider failover.

## Planned — P3

- Tool-result caching (deterministic tools) — mokei already emits SEP-2549 cache hints
  server-side (G1); the client-side consumption half can follow SDK v2's response-cache
  design (`InMemoryResponseCacheStore` + pluggable store).
- Context persistence (save/load host config).
- Google (Gemini) provider.
- Metrics / telemetry hooks.

## Design decisions (unchanged)

- UI-agnostic core — React/Vue adapters left to consumers (CLI Ink work is
  CLI-local, not a core dependency).
- `@sozai/schema` for JSON Schema validation over Zod.
- Custom MCP core over official SDK v2 (2026-07-02 evaluation) — SDK's protocol engine
  is unimportable (`core-internal` private), Zod is a hard dep, and mokei's typed-client
  generics + Enkaku transports have no SDK equivalent. Adopt narrowly instead
  (`backlog/2026-07-02-mcp-sdk-v2-adoption.md`).
- Provider pattern: `client.ts` + `provider.ts` + `config.ts` + `types.ts`.
- Streaming via `TransformStream` → `MessagePart<>`.
