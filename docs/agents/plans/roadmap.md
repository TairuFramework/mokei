# Mokei Roadmap

**Last updated:** 2026-09-03

## Vision

Complete MCP orchestration toolkit: multi-context host, typed server/client
runtime, provider abstraction across cloud + local models, and monitoring UI.

## Current state

19 packages under `packages/`, plus two published MCP servers under `mcp-servers/`.
`@mokei/host` and `@mokei/context-server` are React Native / Metro-bundle-safe (no Node
built-ins); their Node stdio/daemon entries live in `@mokei/host-node` and
`@mokei/context-server-node`.
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

- **HTTP transport auth — OAuth + JWT** (`next/2026-07-02-http-auth-oauth.md`) — active priority
  (promoted from backlog 2026-09-03). Client OAuth 2.1 + PKCE for remote MCP servers (wrap SDK v2
  `withOAuth` fetch middleware first, native `@kokuin/token` port later), server-side bearer
  verification + protected-resource metadata for `@mokei/http-server` (hono middleware, not SDK's
  Express-only helpers), JWT machine auth (SEP-991 grants / `@kokuin/token` DID tokens). The first
  concrete feature since the spec migration closed.

The **MCP `2026-07-28` spec migration is complete** (see Recently shipped / Design decisions) — both
revisions at capability parity, nothing open.

## Recently shipped (completed/)

- **MRTR follow-ups** (2026-09-02, PR TBD) — the four non-blocking items left after MRTR shipped:
  typed `allowInputRequired` overloads on `callTool`/`getPrompt`/`readResource` (removing the
  `as unknown` casts), `minProperties: 1` on the `2026-07-28` `inputRequests` schema so an empty map
  is rejected at the wire instead of burning the round cap, a hoisted exported `defaultMintRequestState`,
  and an end-to-end custom-`mint`→echo→`verify` test. See
  `completed/2026-09-02-mcp-mrtr-followups.complete.md`.
- **MCP SDK v2 — selective adoption closed** (2026-08-28) — the 2026-07-02 evaluation, now a
  decision record folded into the migration milestone. Decision (final): keep the custom MCP core
  (SDK's engine is private/unimportable; Zod hard dep; bespoke typed-client value). Its last open
  item — multi-page cursor-walk interop — shipped as a paginating SDK-v2 `tools/list` fixture that
  mokei walks whole on both revisions. The Standard Schema bridge was upstream work, not mokei's: it
  landed in `@sozai/schema` (sozai `ff25eb1`) as the `StandardJSONSchemaV1` converter, so a sozai
  schema drops into an SDK-based server with no mokei shim. Sampling-deprecation watch and
  conformance-oracle ideas discarded (see the record for why). OAuth/JWT split to its own backlog
  item. See the **SDK v2 — selective adoption** section of
  `completed/2026-08-28-mcp-2026-07-28-migration-milestone.complete.md`.
- **MCP `2026-07-28` cleanup deferrals** (2026-08-28, PR #48) — SSE reader-backpressure fix in
  `@mokei/http-server` (`createSSEStream` is now demand-aware, bounding a slow reader instead of
  only fast producers) and the per-revision `ServerRequest`/`ServerNotification` split in
  `@mokei/context-protocol` (the last unsplit `2025-11-25` seam). The other three deferrals were
  decided against, not rescheduled — no backlog item carried forward. See
  `completed/2026-08-28-mcp-2026-07-28-cleanup-deferrals.complete.md`.
- **MCP `2026-07-28` deprecations (D1–D3)** (2026-08-28, PR #47) — Roots/Sampling/Logging,
  the `2025-11-25` session GET/SSE stream, and `includeContext` marked deprecated on `2026-07-28`
  per SEP-2577; documentation-only, all surfaces stay fully supported on `2025-11-25`. See
  `completed/2026-08-28-mcp-2026-07-28-deprecations-cleanup.complete.md`.
- **MCP `2026-07-28` `subscriptions/listen` (B4)** (2026-08-27, PR #46) — SEP-2575, replaces the
  session GET stream + `resources/subscribe`; closed the migration's last capability gap. See
  `completed/2026-08-27-mcp-2026-07-28-subscriptions.complete.md`.
- **Host RN/Metro-safe `-node` split** (2026-08-25, PR #45) — `@mokei/host` and
  `@mokei/context-server` trimmed of Node built-ins so they bundle under React Native / Metro;
  Node stdio + daemon entries moved to new `@mokei/host-node` and `@mokei/context-server-node`.
  **BREAKING:** `addLocalContext` (now a method on `NodeContextHost`), `spawnHostedContext`,
  `createClient`, `runDaemon` and `ProxyHost` move to `@mokei/host-node`; `serveProcess` moves to
  `@mokei/context-server-node`. Unblocks the Sakui mobile app. See
  `completed/2026-08-25-host-rn-bundler-safe-entry.complete.md`.
- **MRTR** (2026-08-08, PR #44) — `inputRequests`/`inputResponses` (SEP-2322), a
  request-level retry loop replacing server-initiated requests: a suspended `tools/call` /
  `prompts/get` / `resources/read` answers terminally with `resultType: 'input_required'` and
  is retried with `inputResponses` + echoed `requestState`, no stream or continuation state
  involved. Restores `sampling`, `elicitation` and `roots` on `2026-07-28` — both revisions now
  at capability parity — and makes `-32021` `MissingRequiredClientCapabilityError` reachable.
  See `completed/2026-08-08-mcp-mrtr.complete.md`.
- **`x-mcp-header` story B/C** (2026-08-07, PR #43) — stale-schema retry on `-32020` (G7 part 5):
  the HTTP client refreshes annotations via `tools/list` and re-sends the `tools/call` once when
  the header set changed, driven against the SDK v2 peer; and `Mcp-Method` is now asserted
  directly on the outgoing request rather than inferred from the peer's inbound classifier.
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
  U1 streaming arm landed, readying `_registerStreamExchange` for draft wiring. MRTR (above)
  turned out not to need it — `subscriptions/listen` (B4) is the remaining candidate consumer.
- **MCP `2025-11-25` feature gaps** (2026-07-11, PR #36) — client-side cursor walk in all four
  list methods (fixed silent first-page truncation of `ContextHost`'s tool set), tool
  `outputSchema` + validated `structuredContent`. **BREAKING:** `SentRequest`/`requestValue`
  removed, every request method takes an optional `signal`, `createTool`/`createPrompt` take a
  parameters object.

Earlier work — the 2026-06 hardening wave (hang/crash, monitor/daemon security, `2025-11-25`
conformance, provider robustness, HTTP transport resilience, host/session lifecycle), the CLI
llama wiring, the U1 `PendingExchange` refactor and the stack migration — is recorded in
`completed/`, with pre-2026-04 history in `archive/`.

## Milestones

No active milestone. `milestones/` is empty — the one completed milestone was moved to `completed/`
once the migration closed.

- **MCP `2026-07-28` spec migration** (`completed/2026-08-28-mcp-2026-07-28-migration-milestone.complete.md`) —
  complete. Phase 0 groundwork (G1–G4, G6, G7) shipped on `2025-11-25`
  (PR #23). The `2026-07-28` revision then shipped as opt-in coexistence: stateless core
  (PR #40), defect wave (PR #41), interop peer matrix against SDK `2.0.0` (PR #42),
  G7 part 5's stale-schema retry (PR #43), MRTR (`feat/mcp-mrtr`), B4 `subscriptions/listen`
  (SEP-2575, PR #46), and D1–D3 (SEP-2577, documentation-only) — both revisions now at
  capability parity, and nothing in the Phase 1 table remains open. The roots half of B6 stays
  not applicable (`2026-07-28` has no `notifications/roots/list_changed` at all). The final hygiene
  items shipped in PR #48 (SSE backpressure + per-revision server unions); three further deferrals
  were decided against rather than scheduled. Nothing open.

## Near-term (backlog/)

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
  generics + Enkaku transports have no SDK equivalent. Adopt narrowly instead (decision record in
  the **SDK v2 — selective adoption** section of
  `completed/2026-08-28-mcp-2026-07-28-migration-milestone.complete.md`).
- Revision coexistence over a hard cut — mokei is a library, so `2025-11-25` and
  `2026-07-28` are both served and spoken, selected per context. Dropping the older revision
  later is a branch deletion, not a rewrite (ADR in
  `completed/2026-08-28-mcp-2026-07-28-migration-milestone.complete.md`).
- Provider pattern: `client.ts` + `provider.ts` + `config.ts` + `types.ts`.
- Streaming via `TransformStream` → `MessagePart<>`.
