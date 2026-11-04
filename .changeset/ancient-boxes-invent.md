---
"@mokei/context-protocol": patch
"@mokei/context-server": patch
"@mokei/context-client": patch
"@mokei/decision-flow": patch
"@mokei/decision-flow-server": patch
"@mokei/mcp-fetch": patch
"@mokei/mcp-sqlite": patch
"@mokei/mcp-system-one": patch
---

`MOKEI_VERSION` (exported from `@mokei/context-protocol` and `@mokei/context-server`) replaces stale hard-coded versions: the default MCP `clientInfo`, the decision-flow, fetch, sqlite and system-one `serverInfo`, and the `mokei` tracer and meter scopes now report the package version.
