# Mokei Roadmap

**Last updated:** 2026-06-18

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
- **HTTP transport resilience** (`backlog/2026-06-12-http-transport-resilience.md`) —
  audit: client error recovery, SSE serialization deadlock, reconnect, server leaks,
  body limits.
- **Anthropic test — KNOWN_MODELS** (`backlog/2026-06-18-anthropic-test-known-models.md`) —
  pre-existing red suite: test imports a non-exported `KNOWN_MODELS`; 2 listModels tests
  hit the live API (401). Surfaced (not caused) by the provider-robustness work.
- **Host + session lifecycle** (`backlog/2026-06-12-host-session-lifecycle.md`) —
  audit: child reaping, abort races, notification buffering, state races.
- **CLI UX polish** (`backlog/2026-06-12-cli-ux-polish.md`) — audit: API-key
  fail-fast, inspect stderr, empty states.
- **Docs + packaging sweep** (`backlog/2026-06-12-docs-packaging-sweep.md`) — audit:
  broken examples, devDeps→deps for d.ts imports, missing READMEs.

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
