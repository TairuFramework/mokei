# Mokei Roadmap

**Last updated:** 2026-06-19

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

- **Monitor + daemon security** (`completed/2026-06-16-monitor-daemon-security.complete.md`) —
  items 1–5: monitor localhost bind, `/api` Host-allowlist + bearer-token gate,
  socket `0600`, daemon connect-before-remove + signal shutdown + child reaping,
  socket-poll startup. Closed the unauthenticated RCE.
- **Hang/crash core** (`completed/2026-06-15-hang-crash-core.partial.md`) — items 1–5,
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

## Milestones (milestones/)

- **MCP draft spec migration** (`milestones/2026-06-08-mcp-draft-migration.md`) —
  in progress. Phase 0 groundwork (G1–G4, G6, G7) shipped on `2025-11-25`
  (PR #23, `feat/mcp-spec-update`). Breaking hard-cut (B1–B7) deferred until the
  draft finalizes + upstream U1 lands. See backlog entries below.

## Near-term (backlog/)

- **Llama provider integration tests** — exercise real GGUF models end-to-end
  (promptWithMeta shape, function calling, streaming).
- **MCP draft — deferred groundwork** (`backlog/2026-06-09-mcp-draft-deferred-groundwork.md`) —
  G8 + G5 outbound shipped on `feat/mcp-draft-groundwork-g5-g8`. Remaining: G5 baggage (needs
  upstream `getActiveBaggage`), G5 inbound extraction, G7 follow-ups (part 5 retry, deeper
  schema walk).
- **MCP draft — breaking cut** (`backlog/2026-06-09-mcp-draft-breaking-cut.md`) —
  B1–B7 hard-cut; blocked on draft release + U1 transport/RPC-core decision.

## Planned — P2

- **Framework middleware** — `@mokei/express`, `@mokei/hono`, `@mokei/fastify`
  adapters wrapping `@mokei/http-server`.
- **Tree-shakeable provider exports** — `@mokei/openai-provider/chat`,
  `/embed`, etc.
- **Enhanced error handling** — retry strategies, circuit breaker for
  failing tools, provider failover.

## Planned — P3

- OAuth / auth helpers for remote MCP servers.
- Tool-result caching (deterministic tools).
- Context persistence (save/load host config).
- Google (Gemini) provider.
- Metrics / telemetry hooks.

## Design decisions (unchanged)

- UI-agnostic core — React/Vue adapters left to consumers (CLI Ink work is
  CLI-local, not a core dependency).
- `@enkaku/schema` for JSON Schema validation over Zod.
- Provider pattern: `client.ts` + `provider.ts` + `config.ts` + `types.ts`.
- Streaming via `TransformStream` → `MessagePart<>`.
