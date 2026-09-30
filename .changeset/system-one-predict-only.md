---
'@mokei/mcp-system-one': patch
'@mokei/system-one-client': patch
---

The System One MCP server now exposes only the `predict` tool. The `route`, `guard`, `moderate` and `triage` preset tools are removed, together with the `routerQuestions`, `guardQuestions`, `moderationQuestions` and `triageQuestions` exports of `@mokei/system-one-client`. Pass the question map to `predict` instead.
