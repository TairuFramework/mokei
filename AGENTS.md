# mokei

> Conventions: the `kigu:conventions` skill (canonical -- do not restate).
> Build, test and release workflow: the `kigu:development` skill.
> Stack map / sibling docs: the `kigu:stack-map` skill.
> Architecture and package layout: `docs/agents/architecture.md`.

## What this repo is

Mokei is a TypeScript toolkit for the Model Context Protocol (MCP). It provides LLM provider
abstraction, tool orchestration, and multi-provider support (OpenAI, Anthropic, Ollama, Llama)
through a unified session and agent architecture built on typed MCP server/client communication.

## Key Concepts

- **MCP Server/Client Architecture** -- Servers expose tools and prompts; clients connect and discover them. The `ContextHost` orchestrates multiple server connections simultaneously.
- **Protocol Revisions** -- Two MCP revisions are served and spoken side by side, `2025-11-25` and `2026-07-28`, selected per context. See `docs/agents/architecture.md`.
- **Tool Namespacing** -- Tools are namespaced as `contextKey:toolName` (or `local:toolName` for local tools), enabling multiple contexts to coexist without name collisions.
- **Context Management** -- `ContextHost` manages MCP server lifecycles, including spawning processes, setting up connections, and handling enable/disable states.
- **Provider Abstraction** -- A unified `ModelProvider` interface wraps OpenAI, Anthropic, Ollama, and Llama (local GGUF via node-llama-cpp), allowing the `Session` and `AgentSession` layers to work with any backend interchangeably.
- **Session and Agent Layers** -- `Session` provides high-level chat + MCP abstraction; `AgentSession` adds an automatic agent loop with tool execution.

## Quick Commands

| Command | Purpose |
|---------|---------|
| `pnpm build` | Full build (types + JS) |
| `pnpm test` | Run all tests |
| `pnpm lint` | Lint and format |
| `pnpm change` | Record a release intent in `.changeset/` (pnpm native versioning) |
| `pnpm change status` | Preview the release plan the pending intents produce |
| `pnpm version -r` | Apply the plan: bump versions, propagate `workspace:` ranges |

Published packages release in lockstep -- `versioning.fixed` in `pnpm-workspace.yaml` holds
every public package, so one intent moves them all to the same version.

## Guardrails

See the `kigu:conventions` skill. Repo-specific only:

- Never create a new package without checking with the user -- keep functionality in existing packages.
- `pnpm` / `pnpx` only, never `npm` / `npx`.

## Additional Context

Load these based on your current task:

| Task | Files to read |
|------|---------------|
| Planning | `docs/agents/architecture.md`, the `kigu:stack-packages` skill |
| Implementation | the `kigu:conventions`, `kigu:development` and `kigu:stack-packages` skills |
| Review | the `kigu:conventions` and `kigu:development` skills, `docs/agents/architecture.md` |
