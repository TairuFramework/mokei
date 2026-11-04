---
"@mokei/context-protocol": minor
"@mokei/context-server": minor
"@mokei/http-server": minor
"@mokei/http-client": patch
---

OAuth scope follow-ons and SEP-2243 header validation. Prompts (`createPrompt({ scopes })`) and resources (`ResourceDefinitions.scopes`, a list or a synchronous function of the URI) can require scopes, enforced on `prompts/get` and `resources/read` exactly like tool scopes, including the HTTP `403 insufficient_scope` and client step-up. `ContextServer.requiredScopes` covers all three. `tools/list` and `prompts/list` now advertise scopes under `_meta['dev.mokei/scopes']` (`SCOPES_META_KEY`). They are not filtered by the caller's scopes. **Breaking:** on `2026-07-28` the HTTP server now validates the SEP-2243 standard request headers against the body. A request must carry `MCP-Protocol-Version` and `Mcp-Method`, plus `Mcp-Name` on `tools/call`, `prompts/get`, `resources/read` and `tasks/get|update|cancel`, and every header must agree with the body. A missing or disagreeing header is rejected with `400` and JSON-RPC `-32020` (`data.mismatch: { header, body }`), which also replaces the old plain-text `400` for a version mismatch. `@mokei/http-client` already sends these headers. Hand-built requests must add them. `validateStandardHeaders` and `decodeHeaderValue` are exported from `@mokei/http-server`, and `MCP_NAME_HEADER_SOURCE` from `@mokei/context-protocol`, which `@mokei/http-client` now reads too.
