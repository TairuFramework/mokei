# Flow monitor follow-ons

**Origin:** [flow monitor](../completed/2026-10-04-flow-monitor.complete.md), flow daemon milestone sub-project 5

## Monitor UI

Manual QA passed on behaviour, but the monitor UI needs a design and usability pass across the Runs, Inbox and Flows
pages. Collect the specific issues from the user before planning.

## Flow service startup errors lose their cause

When flow registration fails at startup, the daemon logs only `Flow service error`. The service status reports only
`Failed to register and recover flows`. The underlying error, such as an invalid flow definition, is not shown
anywhere. Log the cause (with flow file and validation issues where available) and surface a safe summary in the
status, without leaking configuration secrets.
