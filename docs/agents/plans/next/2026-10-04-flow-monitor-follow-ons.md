# Flow monitor follow-ons

**Origin:** flow monitor, sub-project 5 of the [flow daemon milestone](../completed/2026-10-05-flow-daemon-milestone.complete.md)

## Monitor UI

The Runs part of the monitor design and usability pass is covered by the unified Traces page. The Inbox and Flows
pages still need a design and usability pass. Collect the specific issues from the user before planning.

## Flow service startup errors lose their cause

When flow registration fails at startup, the daemon logs only `Flow service error`. The service status reports only
`Failed to register and recover flows`. The underlying error, such as an invalid flow definition, is not shown
anywhere. Log the cause (with flow file and validation issues where available) and surface a safe summary in the
status, without leaking configuration secrets.
