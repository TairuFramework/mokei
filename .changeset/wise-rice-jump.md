---
"@mokei/decision-flow-server": patch
"@mokei/flow-host": patch
"@mokei/flow-host-node": patch
"mokei": patch
---

Flow service startup failures keep their cause. `@mokei/decision-flow-server` throws `RegisteredFlowError` (flow ID and checker issues) for rejected registered flows, re-exported from `@mokei/flow-host`. `@mokei/flow-host-node` throws `FlowFileError` for unreadable or malformed flow files, logs the failing startup stage, flow file and full error, and reports `FlowFileError` and `FlowDefinitionError` statuses with the file path and sanitized issue codes. `mokei daemon start` and the monitor banner show the failing file and issues.
