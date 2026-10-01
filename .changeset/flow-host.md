---
'@mokei/flow-host': patch
'@mokei/context-server': patch
'@mokei/decision-flow-server': patch
'@mokei/host': patch
'@mokei/host-desktop': patch
---

Add `@mokei/flow-host`, a portable flow runtime with run snapshots, queued approval, an input inbox, memory stores, recovery and tracing. Move the flow rig onto the runtime and one desktop input surface. Queued starts return a run ID immediately, denied runs report `denied`, and flow errors report `failed`.

Expose `DecisionFlowWiring.authorize` for approval outside `AgentSession`. Suspend task work on disposal without cancelling sibling tasks, and preserve request trace context during recovery. Export the portable elicitation content validator from `@mokei/host` and `createDesktopInputSurface` from `@mokei/host-desktop`.
