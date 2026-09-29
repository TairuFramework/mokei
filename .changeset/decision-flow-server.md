---
'@mokei/decision-flow-server': patch
'@mokei/decision-flow': patch
'@mokei/session': patch
'@mokei/mcp-system-one': patch
'@mokei/context-server': patch
---

Add MCP task-backed decision flows with sibling tool calls, System One prediction, input elicitation, recovery, and per-run approval grants. Widen the decision-flow predictor interface, forward session approval metadata to the approved call, and return structured System One predictions. Reject `TaskManager.update` responses for keys that are not outstanding with -32602 'Task is not awaiting input for <key>'.
