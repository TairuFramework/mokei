# Flow client follow-ons

**Origin:** [flow daemon milestone](../completed/2026-10-01-flow-daemon-milestone.complete.md), sub-project 4 (flow CLI and MCP)

The published declaration dependency fixes that used to be tracked separately are folded into sub-project 4,
and `pnpm test:packed` now guards them in CI. The remaining items below are follow-ons.

## Task-capable `start_flow`

`start_flow` returns a run ID and the agent polls with `flow_status` or `wait_flow`. A task-capable variant would
expose the run as an MCP task so a client can track and cancel it natively.

Claude Code does not support MCP tasks today. Revisit when it does. Tasks would bypass the inbox: task input would
reach the MCP client directly instead of the run's inbox item, so the approval and notification path needs a design
before adoption.

## Upstream dependency gaps worked around by `packageExtensions`

The packed-consumer check installs published tarballs in isolation. It uses `packageExtensions` to cover gaps in
upstream manifests (each requested upstream):

- `@enkaku/client` imports `@enkaku/protocol` without declaring it.
- `@enkaku/protocol` lists `@enkaku/transport` only in `devDependencies`.
- `@inkjs/ui` imports `react` without declaring a peer dependency.

Drop each extension once the upstream package fixes its manifest, and confirm `pnpm test:packed` still passes.

## Verification gaps

The production-entry daemon end-to-end test was verified on macOS only. Run it on Linux before claiming support
there.
