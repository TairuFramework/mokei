# Development

Shared build, test, and release workflow lives in the kigu `development` skill,
auto-loaded via the kigu plugin. See it for the pnpm / Turbo / SWC / Biome / Vitest
workflow and the `docs/agents/plans/` lifecycle.

## Repo-specific

MCP toolkit (clients, servers, model providers, host monitoring). Integration tests in
`integration-tests/`; uses Enkaku for streaming/transport. Releases run on pnpm's native
versioning: `pnpm change` to record an intent, `pnpm version -r` to apply the plan.
