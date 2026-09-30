---
'@mokei/decision-flow-server': patch
'@mokei/decision-flow': patch
'@mokei/session': patch
'@mokei/mcp-system-one': patch
'@mokei/context-server': patch
'@mokei/context-client': patch
---

Add MCP task-backed decision flows with sibling tool calls, System One prediction, input elicitation, recovery, and per-run approval grants. Widen the decision-flow predictor interface, forward session approval metadata to the approved call, and return structured System One predictions. The System One predict handler now throws on errors while preserving its wire result. Reject `TaskManager.update` responses for keys that are not outstanding with -32602 'Task is not awaiting input for <key>'. A multi-key update containing one stale key is rejected in full, including otherwise valid answers. The context client continues waiting when a late answer targets a withdrawn key.
