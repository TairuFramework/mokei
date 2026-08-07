# Mokei Roadmap

**Last updated:** 2026-08-04

## Vision

Complete MCP orchestration toolkit: multi-context host, typed server/client
runtime, provider abstraction across cloud + local models, and monitoring UI.

## Current state

17 packages under `packages/`, plus two published MCP servers under `mcp-servers/`.
Two MCP revisions are served and spoken side by side — `2025-11-25` and `2026-07-28` —
selected per context, with `'auto'` probing the peer and negotiating the newest shared
revision. Providers: OpenAI, Anthropic, Ollama, Llama (local GGUF).
Streamable HTTP transport shipped as standalone `@mokei/http-client` +
`@mokei/http-server`. Host monitor UI in `host-monitor`. CLI (`mokei`) with a
flat command surface (`chat` / `inspect` / `monitor` / `proxy`): Ink chat UI on
`@mokei/session` (multi-turn, inline tool-approval, per-tool timeout + cancel),
commander routing. Replaced oclif + enquirer + ora.

Stack: migrated to the post-split toolchain (PR #35) — `@kigu/dev` build/test
tooling, the enkaku split (general utilities → `@sozai/*`, RPC/transport core
stays `@enkaku/*`), and `@tejika/*` CLI/server/UI. ISOLATED pnpm linker.
Releases run on pnpm's native versioning (`pnpm change` → `pnpm version -r`), with every
published package in one `versioning.fixed` lockstep group.

## Competitive position

| Capability            | Mokei | Vercel AI | TanStack AI | MCP SDK |
|-----------------------|-------|-----------|-------------|---------|
| MCP server creation   | Yes   | No        | No          | Yes     |
| MCP client            | Yes   | No        | No          | Yes     |
| Both MCP revisions    | Yes   | N/A       | N/A         | Yes     |
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

- **MRTR** (`next/2026-08-04-mcp-mrtr.md`) — `inputRequests` / `inputResponses` (SEP-2322).
  Restores `sampling`, `elicitation` and `roots` on `2026-07-28`, where they currently throw
  `MRTRNotSupportedError`. Largest remaining piece of the migration.

## Recently shipped (completed/)

- **Interop peer matrix** (2026-08-04, PR #42) — all four client/server × stdio/HTTP quadrants
  against SDK `2.0.0`, on both revisions, from shared expectations. Closed the structural gap
  where mokei's request-header encoder had only ever faced peers that ignore it.
- **`2026-07-28` defect wave** (2026-08-03, PR #41) — seven correctness defects across the MCP
  core. Two are peer-visible: bounded concurrent request dispatch replacing serialization, and
  non-vacuous result unions on both revisions.
- **`2026-07-28` stateless core** (2026-08-02, PR #40) — B5, B2, B3, B1 and the `logLevel` half
  of B6 on both transports, behind the per-context version selector.
- **Integration test environment** (2026-07-27, PR #39) — node-pty `spawn-helper` postinstall,
  model-backed suites skip instead of failing with no backend, llama.cpp added as a second chat
  backend. Exposed and fixed dropped reasoning deltas in `@mokei/openai-provider`.
- **SDK v2 interop harness** (2026-07-27, PR #37) — one fixture surface defined twice (mokei and
  SDK), served over stdio and Streamable HTTP; the live peer the matrix above built on.
- **`context-rpc` stream follow-ups** (2026-07-27, PR #38) — the five items left open when the
  U1 streaming arm landed, readying `_registerStreamExchange` for MRTR.
- **MCP `2025-11-25` feature gaps** (2026-07-11, PR #36) — client-side cursor walk in all four
  list methods (fixed silent first-page truncation of `ContextHost`'s tool set), tool
  `outputSchema` + validated `structuredContent`. **BREAKING:** `SentRequest`/`requestValue`
  removed, every request method takes an optional `signal`, `createTool`/`createPrompt` take a
  parameters object.

Earlier work — the 2026-06 hardening wave (hang/crash, monitor/daemon security, `2025-11-25`
conformance, provider robustness, HTTP transport resilience, host/session lifecycle), the CLI
llama wiring, the U1 `PendingExchange` refactor and the stack migration — is recorded in
`completed/`, with pre-2026-04 history in `archive/`.

## Milestones (milestones/)

- **MCP spec migration** (`milestones/2026-06-08-mcp-draft-migration.md`) —
  in progress. Phase 0 groundwork (G1–G4, G6, G7) shipped on `2025-11-25`
  (PR #23). The `2026-07-28` revision then shipped as opt-in coexistence: stateless core
  (PR #40), defect wave (PR #41), interop peer matrix against SDK `2.0.0` (PR #42).
  Remaining: B7 (MRTR) + the roots half of B6, B4 (`subscriptions/listen`), D1–D3, and
  G7 part 5's retry loop. See `next/` and the backlog entries below.

## Near-term (backlog/)

- **MCP `2026-07-28` — remaining work** (`backlog/2026-06-20-mcp-draft-remaining.md`) —
  consolidated tracker, decomposed into six independent pieces. A (interop matrix) shipped;
  B and C are promoted to `next/`; E (B4 `subscriptions/listen`, plus the `2025-11-25`
  `resources/subscribe` branch) and F (D1–D3 + tidy-ups) stay here. No enkaku blockers.
- **MCP SDK v2 — selective adoption** (`backlog/2026-07-02-mcp-sdk-v2-adoption.md`) —
  outcome of the 2026-07-02 SDK v2 evaluation. Decision: keep the custom MCP core
  (SDK's engine is private/unimportable; Zod hard dep; bespoke typed-client value).
  The interop harness it proposed shipped (see Recently shipped). Open follow-ups:
  multi-page cursor-walk interop, a Standard Schema bridge (consider), and the
  sampling-deprecation watch (SEP-2577). OAuth/JWT split out below.
- **HTTP transport auth — OAuth + JWT** (`backlog/2026-07-02-http-auth-oauth.md`) —
  client OAuth 2.1 + PKCE for remote MCP servers (wrap SDK v2 `withOAuth` fetch
  middleware first, native `@kokuin/token` port later), server-side bearer verification +
  protected-resource metadata for `@mokei/http-server` (hono middleware, not SDK's
  Express-only helpers), JWT machine auth (SEP-991 grants / `@kokuin/token` DID tokens).
  Replaces the former P3 "OAuth / auth helpers" line.
- **CLI reasoning coverage** (`backlog/2026-07-27-cli-reasoning-coverage.md`) — two coverage
  gaps, no defect: assert reasoning separation where the backend provides it, and verify the
  OpenAI-compatible `reasoning_content` / `reasoning` mapping against a server that actually
  splits reasoning. The mapping ships in 0.11.0 unit-tested only.
- **Website chat walkthrough** (`backlog/2026-08-04-website-chat-walkthrough.md`) — the
  website quick-start documents an inquirer-style menu and `mokei chat ollama`; the CLI is an
  Ink TUI driven by slash commands. Needs a real PTY run to capture accurate output.
- **Llama provider follow-ups** (`backlog/2026-06-20-llama-provider-follow-ups.md`) — optional
  local-inference tuning (`gpu` / `contextSize` flags) and a positive tool-call assertion in
  the gated GGUF suite. Nothing depends on either.

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
- Revision coexistence over a hard cut — mokei is a library, so `2025-11-25` and
  `2026-07-28` are both served and spoken, selected per context. Dropping the older revision
  later is a branch deletion, not a rewrite (ADR in
  `milestones/2026-06-08-mcp-draft-migration.md`).
- Provider pattern: `client.ts` + `provider.ts` + `config.ts` + `types.ts`.
- Streaming via `TransformStream` → `MessagePart<>`.
