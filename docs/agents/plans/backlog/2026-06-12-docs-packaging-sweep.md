# Docs + packaging sweep

**Status:** backlog
**Origin:** 2026-06-12 full audit (security, stability, usability, MCP-spec).

## Gap

Headline doc examples don't compile or throw at runtime, published type declarations
import packages consumers don't get, and several published packages have no README.
Cheap fixes, high consumer value.

## Scope

1. **devDeps → deps for type-imported packages** — published `lib/*.d.ts` files import
   packages listed only as devDependencies, breaking consumer typechecking (or
   degrading core types to `any` under `skipLibCheck`):
   - `packages/session/package.json:42` — d.ts imports `@mokei/context-protocol`,
     `@mokei/context-rpc`, `@mokei/model-provider`.
   - All four provider packages (e.g. `packages/anthropic-provider/package.json:50-53`)
     — `@mokei/model-provider`, `@mokei/context-protocol`.
   - `packages/host` — `lib/host.d.ts:4` imports `@mokei/context-rpc`.
   Move to `dependencies` (type-only, zero runtime cost).
2. **Broken examples** (each one a copy-paste failure):
   - `docs/guides/agent.md:43-47,62-66,88-93,101-106,114-119,134-138` — every
     `AgentSession` example uses nonexistent `host` param; real shape is
     `{session, provider, model}` (`packages/session/src/agent-types.ts:52-56`).
   - `docs/guides/quick-start.md:61-67` — same, plus `session.host` (getter is
     `contextHost`).
   - `packages/anthropic-provider/README.md:34-44` — "Basic Chat" calls
     `stream.getReader()` on `MessagePart` chunks; TypeError on first iteration.
   - `docs/guides/session.md:155-157` — Ollama config key is `baseURL` not `apiUrl`
     (schema is `additionalProperties: false`, throws), and the URL needs the `/api`
     suffix.
   - `docs/guides/agent.md:284` — `agent.run('…', controller.signal)`; real signature
     is `run(prompt, { signal })` — signal silently ignored.
3. **`'ask'` tool-approval contradiction** — implementation immediately denies without
   a handler (`packages/session/src/agent-session.ts:558-565`); `agent-types.ts:11-12`
   says "waits for external approval"; `docs/guides/agent.md:111` says "auto-approves
   after emitting". Fix both docs to match the implementation (denies unless a
   `ToolApprovalFn` is supplied), or remove `'ask'` in favor of requiring a function.
4. **Missing READMEs + doc-index gaps** — `packages/http-client`, `packages/http-server`,
   `packages/llama-provider` have no README (render empty on npm); most others are
   3-line stubs vs anthropic-provider's full guide. `docs/index.md:14-26` omits
   llama-provider, http-client, http-server, host-monitor, host-protocol, logger;
   `docs/guides/providers.md:7` omits the Llama provider entirely.
5. **Root README stale CLI syntax** — `README.md:70-72` documents removed
   `mokei context monitor` / `mokei chat openai`; actual surface is flat
   (`mokei monitor`, `mokei chat -p openai`). Line 71 claims inspect lists tools; it
   prints only the initialize result. Sync with `docs/guides/cli.md` (accurate).
6. **cli `repository` field** — `packages/cli/package.json` is the only package missing
   `repository` (+ `directory`). Add it.

## Notes

- Verified accurate (don't touch): `docs/guides/cli.md`, `client.md`, `server.md`,
  `providers.md` (except the llama omission), `session.md` apart from line 155.
