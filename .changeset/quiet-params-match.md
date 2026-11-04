---
"@mokei/context-protocol": minor
"@mokei/context-server": minor
"@mokei/http-server": minor
"@mokei/http-client": patch
---

SEP-2243 `Mcp-Param-*` validation on the server. On a `2026-07-28` `tools/call`, the HTTP server checks each `Mcp-Param-{Name}` header against the arguments the tool's `x-mcp-header` annotations name. An absent or `null` argument needs no header, numbers compare numerically, and tools with invalid annotations are skipped. A missing, badly encoded or different header is rejected with `400` and `-32020`, and `data.mismatch.header` names the `Mcp-Param-*` header. This runs before the scope check. New: `validateParamHeaders` (`@mokei/http-server`) and `ContextServer.toolInputSchema(name)`. `collectHeaderAnnotations`, `isValidHeaderParamName` and their types move to `@mokei/context-protocol`, and `@mokei/http-client` still re-exports them. Fix: the client's stale-schema refresh now reads a `tools/list` answer sent over SSE. Before, it only accepted JSON, so the refresh-and-retry never worked against a stateless mokei server.
