---
'@mokei/decision-flow-server': patch
'@mokei/decision-flow': patch
---

Add flow references between registered flows, a `list_flows` tool and an input `decline` edge, and stop constraining tool result paths. Breaking: `checkFlow` and `createDecisionFlowServer` now return promises, so callers must await them. `createDecisionFlowServer` also accepts a `registry`, and runtime `run_flow` and `check_flow` definitions can reference registered flows.
