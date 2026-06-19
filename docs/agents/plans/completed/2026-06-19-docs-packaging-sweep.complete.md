# Docs + packaging sweep

**Status:** complete
**Origin:** 2026-06-12 full audit (security, stability, usability, MCP-spec).
Shipped 2026-06-19.

## Gap

Headline doc examples didn't compile or threw at runtime, published `lib/*.d.ts` files
imported packages listed only as devDependencies (breaking consumer typechecking), and
several published packages had no README.

## Resolution

All 6 items shipped:

1. **devDeps → deps** — moved the type-imported `@mokei/*` workspace packages into
   `dependencies` for `session` (context-protocol, context-rpc, model-provider), all four
   providers (context-protocol, model-provider), and `host` (context-rpc; also dropped a
   duplicate context-protocol present in both blocks). Lockfile refreshed. Type-only, zero
   runtime cost — fixes consumer typechecking that previously degraded to `any` under
   `skipLibCheck`.
2. **Broken examples** — `docs/guides/agent.md` (every `AgentSession` example used a
   nonexistent `host` param → real shape `{ session, provider, model }`; `agent.run(p,
   signal)` → `agent.run(p, { signal })`), `quick-start.md` (same + `session.host` →
   `session.contextHost`), `anthropic-provider/README.md` (Basic Chat stream consumption +
   With-Tool-Calling `host` bug), `session.md` (Ollama `apiUrl` → `baseURL` with `/api`
   suffix, verified vs `ollama-provider/src/config.ts`).
3. **`'ask'` contradiction** — code (`agent-types.ts` comments) and docs (`agent.md`) now
   agree with the implementation: `'ask'` emits `tool-call-pending` then *denies* (no async
   approval bridge); supply a `ToolApprovalFn` to approve interactively.
4. **Missing READMEs + doc-index** — created `http-client`, `http-server`, `llama-provider`
   READMEs (all API shapes verified against `src` exports), and added the six missing
   entries to `docs/index.md`.
5. **Root README stale CLI** — flat command syntax (`mokei monitor`, `mokei chat -p
   openai`); corrected the inspect wording ("prints its initialize result").
6. **cli `repository` field** — added to `packages/cli/package.json`.

Plus: `docs/guides/providers.md` gained the omitted Llama provider section.

## Key decision

Kept the live `GET /v1/models` / per-provider live APIs in docs rather than inventing
offline fallbacks; doc examples were corrected to the real runtime shapes (verified
against source), not the other way around.

## Status

Done. Lint clean (293 files), session typecheck passes. Doc/README edits done via a
subagent; every new-README API shape spot-verified against source by the controller.
