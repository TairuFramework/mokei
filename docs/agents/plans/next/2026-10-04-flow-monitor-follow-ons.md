# Flow monitor follow-ons

**Origin:** flow monitor, sub-project 5 of the [flow daemon milestone](../completed/2026-10-05-flow-daemon-milestone.complete.md)

## Monitor UI

The Runs part of the monitor design and usability pass is covered by the unified Traces page. The Inbox and Flows
pages still need a design and usability pass. Collect the specific issues from the user before planning.

## Done: flow service startup errors keep their cause (2026-11-04)

- `@mokei/decision-flow-server` throws `RegisteredFlowError` (`flowID`, `issues`) for duplicate ids, flows needing
  elicitation and checker failures; `@mokei/flow-host` re-exports it.
- `loadFlowDirs` throws `FlowFileError` (`path`, `reason`) for unreadable directories or files and malformed JSON.
- The flow reporter (`getFlowReporter`) renders the error in the log message, since console sinks print only the
  message. Startup failures log `Flow service failed to <stage>`, with the flow file for rejected definitions.
- The status carries `FlowFileError` (path, fixed message) or `FlowDefinitionError` (flow file and issue codes with
  definition field paths, other segments as `*`). Flow ids and checker messages stay out of the status, matching the
  existing rule that flow-authored text is not published.
- `mokei daemon start` and the monitor's connection banner show the path and issues.
