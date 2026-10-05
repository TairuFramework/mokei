---
'@mokei/flow-host': patch
'@mokei/flow-host-node': patch
'@mokei/flow-client': patch
'@mokei/context-protocol': patch
'@mokei/host-desktop': patch
'@mokei/host-protocol': patch
'mokei': patch
---

Error constructors in flow-host, flow-host-node and the CLI now take a single `<ClassName>Params` object instead of positional arguments, with exported parameter types. Flow-host exports `describeFlowHostError` and no longer exports `TERMINAL_STATES`: use `isTerminalRunState` or `TERMINAL_RUN_STATES` from flow-client. `FlowRunSnapshot`, `InboxItem`, `StoredSpan` and `StoredLog` are now the shared flow-client and host-protocol types, so `result.output` is `unknown` and `requestedSchema` is `Record<string, unknown>`. Flow-client exports `isTerminalRunState`, `FLOW_CONTROL_ERROR_CODES`, `FlowControlErrorCode`, `nestSpans` and `SpanTreeNode`. Flow-host-node fixes migration version checks and rejects a newer database before changing it. Context-protocol exports the shared elicitation form parser `elicitFormFields` and `ElicitFormResult`. Desktop, CLI and monitor forms use stricter schemas, with multi-select fields in the CLI and monitor. The flow-host-node native surface skips the desktop prompt for an input schema that is invalid on the wire, leaving the item in the inbox. Host-protocol makes monitor presence `attachmentID` optional because the proxy injects it. Abort and timeout handling now uses `@sozai/async`.
