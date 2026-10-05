---
'@mokei/flow-host': patch
'@mokei/flow-host-node': patch
'@mokei/flow-client': patch
'@mokei/context-protocol': patch
'@mokei/host-desktop': patch
'@mokei/host-protocol': patch
'mokei': patch
---

Error constructors in flow-host, flow-host-node and the CLI now take a single `<ClassName>Params` object instead of positional arguments, with exported parameter types. Flow-host uses shared flow-client types and exports `describeFlowHostError`. Flow-client exports `isTerminalRunState`, `FLOW_CONTROL_ERROR_CODES`, `FlowControlErrorCode`, `nestSpans` and `SpanTreeNode`. Flow-host-node centralises SQLite transactions with `withTransaction` and fixes migration version checks. Context-protocol exports the shared elicitation form parser `elicitFormFields` and `ElicitFormResult`. Desktop, CLI and monitor forms use stricter schemas, with multi-select fields in the CLI and monitor. Host-protocol makes monitor presence `attachmentID` optional because the proxy injects it. Abort and timeout handling now uses `@sozai/async`.
