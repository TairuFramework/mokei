---
"@mokei/context-protocol": patch
"@mokei/decision-flow": patch
"@mokei/decision-flow-server": patch
"@mokei/host": patch
"@mokei/host-monitor": patch
"@mokei/http-server": patch
---

Adopt upstream fixes: runtime schema validators come from `@sozai/schema`'s `createValidatorCache` (decision flow graphs now share a bounded cache by default), the monitor ends SSE sessions with the enkaku bridge's `dispose()` on daemon reconnect, `serveHTTP` reads the MCP handler with `HTTPServer.use`, and `MOKEI_VERSION` reports 0.16.0. Requires `@enkaku/*` 0.23.2 and `@sozai/http-server` 0.2.2.
