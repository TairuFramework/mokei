---
'@mokei/anthropic-provider': patch
'@mokei/context-client': patch
'@mokei/context-protocol': patch
'@mokei/context-rpc': patch
'@mokei/context-server': patch
'@mokei/context-server-node': patch
'@mokei/decision-flow': patch
'@mokei/decision-flow-server': patch
'@mokei/flow-client': patch
'@mokei/flow-host': patch
'@mokei/flow-host-node': patch
'@mokei/host': patch
'@mokei/host-desktop': patch
'@mokei/host-node': patch
'@mokei/host-monitor': patch
'@mokei/host-protocol': patch
'@mokei/http-client': patch
'@mokei/http-server': patch
'@mokei/llama-provider': patch
'@mokei/logger': patch
'@mokei/mcp-fetch': patch
'@mokei/mcp-sqlite': patch
'@mokei/mcp-system-one': patch
'@mokei/model-provider': patch
'@mokei/ollama-provider': patch
'@mokei/openai-provider': patch
'@mokei/session': patch
'@mokei/session-node': patch
'@mokei/system-one-client': patch
'mokei': patch
---

Add the flow CLI and MCP surface. The new `@mokei/flow-client` package provides the `FlowControl`
interface, a daemon adapter, wait helpers and the flow MCP server; `@mokei/flow-host` adds
`createLocalFlowControl`. The CLI gains `mokei daemon`, `mokei flows` (including `flows mcp`),
`mokei runs` and `mokei inbox` commands. The repository flow rig is removed.

Also correct dependency declarations in `@mokei/context-server`, `@mokei/context-client`,
`@mokei/context-rpc`, `@mokei/context-protocol` and `@mokei/model-provider`, guarded by a
packed-consumer check in CI.
