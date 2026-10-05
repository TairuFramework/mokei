# Flow monitor

**Status:** complete
**Date:** 2026-10-04
**Milestone:** [flow daemon](../completed/2026-10-01-flow-daemon-milestone.complete.md), sub-project 5
**Branch:** `feat/flow-monitor`

## Outcome

The monitor is now the main human surface for flows. It lists runs, shows run detail with a trace waterfall and
filterable logs, answers inbox inputs and approvals (in the inbox and inline on the run page), checks pasted flow
definitions, and starts and cancels runs.

The monitor is also an inbox surface next to the native desktop. The daemon routes notifications and prompts through
an ordered list of surfaces, monitor first, then native. An attended monitor tab suppresses desktop notifications, a
hidden tab shows browser notifications, and prompts open the item form in the page. Native notifications and dialogs
remain the fallback, and clicking a native notification opens the item in the monitor when one is attached.

Changes by package:

- `@mokei/host-protocol`: `monitor.attach` (stream) and `monitor.presence` (channel), typed as a separate
  `MonitorProcedure` group.
- `@mokei/flow-host-node`: the `InboxSurface` contract, `MonitorPresence`, monitor and native surfaces, and
  surface routing in the desktop controller.
- `@mokei/host-node`: serves the monitor procedures through an injected handler set.
- `@mokei/host-desktop`: native notification deliveries are observable and closable; `openURL` opens monitor links.
- `@mokei/host-monitor`: transport fixes. It allows the monitor's own origin, forwards SSE aborts to the daemon,
  rejects browser `monitor.attach`, and reconnects and re-attaches after a daemon restart. It explains when the
  daemon is too old to support the monitor.
- `monitor` app: `FlowProvider` data layer, `PresenceProvider` and the Runs, Inbox and Flows pages.
- `@mokei/cli`: the daemon entry wires presence and surfaces; `mokei monitor` prints the URL as returned.
- The root `pnpm test` and CI now run the monitor app tests and its bundle check.

## Key decisions

- **Presence over a channel, liveness by ping.** Each tab holds a `monitor.presence` channel. A tab's claims (visible,
  can notify) are trusted only after a fresh `pong`. There is no heartbeat. Pings and acks time out after 5 s.
- **Registration over a stream.** `mokei monitor` holds a `monitor.attach` stream. The stream's lifetime is the
  registration, and tabs are bound to the attachment that served them. Only a `http://127.0.0.1:<port>/` root URL
  is accepted.
- **Visibility means the Page Visibility API.** Window focus is not required, so a monitor on a second screen counts.
- **No catch-up.** An item that arrived while the monitor was attended gets no notification later.
- **Recovery summaries stay native.** After a daemon restart the startup summary goes through the native surface
  only. Reconnecting tabs read the pending items themselves.
- **The flow host stays the only settler.** Every prompt resolves from the inbox settlement (answered → accept,
  declined → decline, cancelled → cancel, withdrawn → not found). This applies even when another client answers.
  The monitor settles with `inbox.answer`, `inbox.decline` and `inbox.cancel`, never `inbox.prompt`.
- **`desktop.notifications: false` disables native notifications only.** The monitor still suppresses and notifies,
  since the user opted in by opening it and granting browser permission.
- **The browser reuses `FlowControl`** through `createRemoteFlowControl`, so the CLI, MCP and the monitor share one
  adapter.
- **Flows page checks pasted definitions.** The daemon cannot return a registered flow's definition, so a per-flow
  check would need a new daemon procedure.
- **Reconciliation.** Every list and detail hook buffers events, reads by generation and re-reads affected IDs. Inbox
  state keeps tombstones so a stale snapshot cannot resurrect a settled item.
- **Trace polling.** The trace store holds only ended spans, so the run trace polls while active and briefly after
  the run ends.

## Verification and review

All 14 plan tasks passed task reviews. The whole-branch review found three Important issues and five Minor ones;
all were fixed except one Minor (shutdown order), declined. A scoped re-review was clean.
- The CLI printed a double-slash URL.
- The monitor tests were not in the root test run or CI.
- An older daemon made attach fail hard or loop.

Build, lint, the full test suite (monitor included), `pnpm test:packed` and the monitor bundle check passed.

Manual macOS QA passed on 2026-10-04 against an isolated daemon with native notifications on (alerter).
It covered the following, all passing:
- attach and loopback aliases, the Flows page, and inputs and approvals answered inline and from the inbox
- notification suppression while visible, browser notifications while hidden, and native fallback with permission
  blocked, with no tab, and with no monitor
- prompt routing (visible, hidden, no tab, tab closed mid-prompt), settlement from the CLI, daemon restart and
  back/forward cache restore

The older-daemon check was skipped.

Follow-ons are in the [flow monitor follow-ons](../next/2026-10-04-flow-monitor-follow-ons.md) and the
[flow monitor backlog](../backlog/2026-10-04-flow-monitor-backlog.md).
