# Flow daemon native desktop QA

**Origin:** [flow daemon](../completed/2026-10-02-flow-daemon.complete.md)
**Priority:** next desktop acceptance pass

## Scope

The user deferred native desktop QA while completing daemon implementation.
Injected adapter tests cover desktop policy, but cannot verify native notifications, dialog appearance or process cancellation.
Record the operating system, backend, observed behaviour and mismatches when this QA runs.

## Setup

1. Build with `pnpm build`.
2. Create an isolated short temporary directory for socket, pid, configuration and database paths.
3. Write the flow definitions from `integration-tests/support/flow-daemon/flows.ts` into its flow directory.
4. Configure `integration-tests/support/flow-daemon/sibling.mjs` as the Node sibling, passing an isolated record-file path.
5. Set `desktop.notifications` to `true`.
6. Launch `packages/cli/lib/daemon-entry.js` with explicit `--socket-path`, `--pid-path`, `--config-path` and `--database-path` overrides.
7. Connect through `createClient` from host-node and wait for `info.flowService.state` to become `ready`.

These entry overrides are internal QA options. The production entry uses the native adapter.
Requests pass procedure arguments through `{ param: ... }`.
Restart after configuration changes, retaining the same isolated database.

## Acceptance checks

- Start input and approval flows. New pending items notify once without content previews or automatic dialogs.
- Restart with zero, one and three pending items. Expect no notification, one item notification, or one `3 pending prompts` notification.
- List, subscribe and reconnect repeatedly. Expect no additional notifications.
- With `alerter` installed, click an item notification. Expect its dialog, as with `inbox.prompt`; clicking the `3 pending prompts` message opens nothing. Settle an item elsewhere and check its notification disappears.
- Call `inbox.prompt` explicitly. Check readable labels, requested input fields, planned tools and explicit approval.
- Accept, decline and cancel fresh dialogs. Check validated runtime settlement and resulting run states.
- Settle an item from another client while its dialog is open. Check cancellation and rejection of late answers.
- Disconnect the prompting caller. Check the dialog closes, the item remains pending and another caller can prompt it.
- Disable notifications and restart. Check notifications stop while explicit supported prompts still work.
- Prompt an unsupported schema. Check the item remains available for a direct answer.
- Restart with pending work. Check run and inbox identities, answer the recovered input and verify completion and stored trace capture.

Stop the isolated daemon gracefully and dispose clients after testing.
Confirm native acceptance or preserve any discovered defects as follow-on work.
