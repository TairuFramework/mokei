# Flow monitor design

**Date:** 2026-10-03
**Milestone:** [flow daemon](../../agents/plans/milestones/2026-10-01-flow-daemon-milestone.md), sub-project 5
**Branch:** `feat/flow-monitor`

## Goal

Make the monitor the main human surface for flows: list and inspect runs (trace and logs), answer inbox inputs and
approvals, and start and cancel runs. Treat the monitor as an inbox surface next to the native desktop: a visible
monitor suppresses desktop notifications, a hidden monitor tab shows browser notifications, and prompts route to the
monitor first. Native notifications and dialogs remain the fallback when no monitor is open.

## Decisions

- **Scope: act and observe.** Runs list, run detail (span waterfall and logs), inbox (answer, approve, deny,
  decline, cancel), flows (check results, start a run). The existing events page stays.
- **The browser reuses `FlowControl`.** The monitor wraps its existing Enkaku client in `createRemoteFlowControl`
  from `@mokei/flow-client`, so the CLI, MCP and the monitor share one adapter and one subscribe-then-read rule.
- **Inbox surfaces.** The daemon routes notifications and prompts through an ordered list of surfaces,
  `[monitor, native]`. A surface reports `attended` (the user is looking at it), `reachable` (it can deliver) or
  `unavailable`.
- **Presence over a channel.** Each monitor tab holds a `monitor.presence` channel. Its lifetime is the tab's
  presence, so there is no heartbeat or TTL; the daemon pings a tab before relying on it.
- **Monitor registration over a stream.** The `mokei monitor` server holds a `monitor.attach` stream carrying its URL.
  The stream's lifetime is the registration.
- **No catch-up.** An item that arrived while the monitor was attended gets no notification later, when the monitor
  becomes hidden or closes.
- **Prompts route monitor first.** Visible tab: the form opens in the page. Hidden tab: a browser notification leads
  to the form. No tab: the native dialog, as today.
- **Visibility means the Page Visibility API.** A foreground tab in a window behind another application still counts
  as visible. Focus is not required, so a monitor on a second screen counts.

## Protocol (`@mokei/host-protocol`)

Two procedures join the flow procedures. Both are served by the daemon and reach it through the monitor's existing
pass-through bridge (`@enkaku/http-serve` supports streams and channels, and ends a session's calls when the browser
disconnects).

### `monitor.attach` (stream)

- Param: `{ url: string }`, the monitor's base URL (`http://127.0.0.1:<port>/`).
- Called by `startMonitor` in `@mokei/host-monitor` once its server listens; kept open until the monitor disposes.
- The daemon sends no stream messages except an initial `{ type: 'attached' }` acknowledgement.
- The registration ends when the stream ends for any reason.

### `monitor.presence` (channel)

Opened by each monitor tab when it loads, kept open while the page lives. Param: `{}`.

| Direction | Message | When |
|---|---|---|
| tab → daemon | `{ type: 'state', visible: boolean, canNotify: boolean }` | first message, then on `visibilitychange` and on notification permission change |
| tab → daemon | `{ type: 'pong', nonce: string }` | reply to `ping` |
| tab → daemon | `{ type: 'notified', itemID: string, shown: boolean }` | reply to `notify` |
| tab → daemon | `{ type: 'prompted', itemID: string, shown: boolean }` | reply to `prompt` |
| daemon → tab | `{ type: 'ping', nonce: string }` | before notifying or prompting a hidden tab |
| daemon → tab | `{ type: 'notify', itemID: string, title: string, message: string }` | new item, monitor reachable |
| daemon → tab | `{ type: 'prompt', itemID: string }` | `inbox.prompt` routed to the monitor |

A tab closes its own browser notifications when it observes `inbox:settled` on the events stream; the daemon never
withdraws them.

## Daemon side (`@mokei/flow-host-node`)

### `InboxSurface`

```ts
type SurfaceStatus = 'attended' | 'reachable' | 'unavailable'
type SurfaceDelivery = { closed: Promise<void> }
type InboxSurface = {
  name: string
  status(): SurfaceStatus
  /** Resolves null when the surface could not deliver; the next surface is tried. */
  notify(item: InboxItem, options: { signal: AbortSignal }): Promise<SurfaceDelivery | null>
  /** Resolves null when the surface could not show the prompt; the next surface is tried. */
  prompt?(item: InboxItem, options: { signal: AbortSignal }): Promise<PromptOutcome | null>
}
```

`status()` is synchronous and cheap; a surface that must check liveness (the monitor pinging a tab) does so inside
`notify` and `prompt` and returns `null` on failure.

### `MonitorPresence`

A portable module holding:

- attached monitors (URL, attach order); `currentURL()` returns the most recently attached one;
- open tab channels, each with `visible`, `canNotify` and the time it was last visible.

Behaviour:

- `attach(url)` returns a detach function. When the last monitor detaches, every tab channel is closed.
- `status()`: `attended` when a monitor is attached and any tab is visible; `reachable` when a monitor is attached and
  any tab has `canNotify`; otherwise `unavailable`.
- Target tab for `notify`: among tabs with `canNotify`, the one visible most recently. The surface sends `ping` and
  waits up to 2 s for the matching `pong`; no `pong` closes that channel and the surface returns `null` (no retry on a
  second tab in this cut). Then it sends `notify` and waits up to 2 s for `notified`; `shown: false` or no reply
  returns `null`.
- `notify` returns `{ closed }`, resolving when the item settles or the tab channel closes.
- `prompt`: target tab is a visible tab if any (no ping needed), else the most recently visible tab after a ping. The
  surface sends `prompt` and waits up to 2 s for `prompted`; failure returns `null`. Once shown, it waits for the item
  to settle and maps the outcome: `answered` → `accept`, `declined` → `decline`, `cancelled` → `cancel`. If every tab
  channel closes before the item settles, the surface falls back by returning `null` so the controller tries the
  native surface. If the item is withdrawn, it rejects with `InboxItemNotFoundError`, as the native path does.

### Native surface

Wraps the existing `FlowDesktopAdapter` (`@mokei/host-desktop`), which stays native-only.

- `status()`: `reachable` when an adapter exists and notifications are enabled, else `unavailable`. Never `attended`.
- `notify`: today's notification, with today's grouping and removal on settle. Click: if `currentURL()` is set, open
  `<url>inbox/<itemID>` (summary notification: `<url>inbox`) with the platform opener (`open` on macOS, `xdg-open` on
  Linux) through the host-desktop runner; otherwise prompt the item as today (summary: no action).
- `prompt`: today's desktop dialog path, unchanged.

### Desktop controller routing

`createFlowDesktopController` takes `surfaces: Array<InboxSurface>` instead of using the adapter directly; the CLI
daemon entry builds `[monitorSurface, nativeSurface]`.

- `added(item)`: if any surface is `attended`, send nothing. Otherwise try each `reachable` surface's `notify` in order
  until one returns a delivery.
- `restored(items)`: unchanged policy (none, one item, or one summary), sent through the native surface, since no tab
  can be connected yet after a daemon restart.
- `settled(item)`: close every live delivery for the item, as today.
- `prompt(id, signal)`: keep today's ownership rule (`InboxPromptInProgressError`). Try each surface with `prompt` in
  order (monitor first) until one returns an outcome. If none can, throw `DesktopPromptUnavailableError`.
- `notifications: false` in `flows.json` disables native notifications only. The monitor surface still suppresses
  and notifies, because the user opted into it by opening the monitor and granting browser permission.

### Wiring

- `@mokei/host-node` serves `monitor.attach` and `monitor.presence` through an injected handler set, like the flow
  handlers; it contains no presence logic.
- `@mokei/cli`'s daemon entry creates one `MonitorPresence`, passes its handlers to the daemon and its surface to the
  controller.
- `@mokei/host-monitor`'s `startMonitor` opens `monitor.attach` with its URL after listening and closes it on dispose.

## Monitor app (`monitor/`)

### Data layer (`monitor/src/flow/`)

- `FlowProvider` in `__root.tsx` creates `createRemoteFlowControl(client)` and one shared `subscribe()`, fanning out
  events to hooks. On reconnect it bumps an epoch; hooks re-read on a new epoch.
- Hooks: `useFlows()`, `useRuns(filter)`, `useRun(runID)`, `useRunTrace(runID)`, `useInbox()`, `useInboxItem(itemID)`.
  Event application is pure functions (`applyRunEvent`, `applyInboxEvent`) so it is unit tested without React.
- `useRunTrace` re-fetches `runs.trace` on that run's events and polls every 2 s while the run is not terminal.
- Plain React state and context; jotai stays for the events page.
- The build must not bundle `@mokei/flow-client`'s MCP server. If tree-shaking keeps it, add a `./control` subpath
  export to `@mokei/flow-client` without `server.ts`, and import from it.

### Presence (`monitor/src/presence/`)

- `PresenceProvider` opens `monitor.presence`, sends `state` on open, on `visibilitychange` and on permission change,
  answers `ping`, and handles `notify` (a browser `Notification`; click calls `window.focus()` and navigates to
  `/inbox/<itemID>`) and `prompt` (navigate to `/inbox/<itemID>`; if hidden, also a browser notification leading
  there). It closes its notifications on `inbox:settled`.
- If the channel ends while the page is open, it reopens with backoff.
- Header: a button to request notification permission (browsers require a user gesture), a pending-count badge on the
  Inbox link, and an in-page toast (`@mantine/notifications`) for new items while visible.

### Pages (TanStack file routes)

The header links Events, Runs, Inbox and Flows.

| Route | Content | Actions |
|---|---|---|
| `/` | Existing events page, unchanged | — |
| `/runs` | Table: label, flow, state badge, started, updated; state filter | open, cancel |
| `/runs/$runID` | Snapshot (`DataList`), result or error, pending items, trace waterfall, logs | cancel; answer pending items inline |
| `/inbox` | Pending items, newest first: kind, run, message or plan tools | open |
| `/inbox/$itemID` | Approval: plan tools. Input: `SchemaForm` from `requestedSchema` | approve or deny; accept, decline or cancel. A settled item shows its outcome |
| `/flows` | Flows with outputs and outcomes; `flows.check` issues | start a run (form from the input schema, optional label), then open the run |

### Components

- `TraceWaterfall`: Mantine `Tree` (with `useTree`) for the span hierarchy; `renderNode` draws the name, duration and
  a positioned bar (`left` and `width` relative to the root span; open-ended for running spans; colour by status), with
  a time ruler above. Inside a `Splitter`: the detail pane shows the selected span's attributes and events in a
  `DataList`. Selecting a span filters the log list to its records. Virtualize with `@tanstack/react-virtual` only if
  needed.
- Log list: level and text filters, span filter from the waterfall.
- `SchemaForm`: the MCP elicitation subset (flat object; string with formats, number, integer, boolean, enum and titled
  enum; required; defaults). Daemon validation errors render on the form.
- Flow input schemas outside the subset use `JsonInput`; the daemon validates.
- `EmptyState` for empty lists and not-found.

### Errors and connection

- Flow service unavailable or daemon unreachable: a banner from `service:status`; actions disabled.
- Stale token after `mokei monitor` restarts (calls fail with 401): a full-page "monitor restarted, reload" state.
- Missing run or item: not-found state with a link to the list.
- Acting on an item settled elsewhere: an "already settled" notice.

## Testing

- **Unit (existing packages):** protocol schemas; `MonitorPresence` with fake timers (attach and detach, latest wins,
  clear on last detach, attended across tabs, ping timeout, `notified` false, prompt outcome mapping, prompt fallback
  when tabs close); controller routing (attended suppresses, monitor before native, fallback, prompt routing, native
  click opens the URL or the dialog, settle closes deliveries); host-node handler set lifetimes; `startMonitor`
  attaches and detaches.
- **Monitor (new vitest, jsdom and React Testing Library harness):** pure event application, span tree layout, schema
  to form fields; `SchemaForm`; `PresenceProvider` against a mocked channel.
- **End-to-end (integration suite):** daemon plus `startMonitor`, a Node Enkaku client acting as a tab over the bridge:
  visible tab suppresses a fake native notifier; hidden tab receives `notify`; a ping timeout falls back to native;
  `inbox.prompt` routes to the tab and resolves after `inbox.answer`; a native click opens the monitor URL through a
  fake runner.
- **Bundle check:** the monitor build succeeds and does not contain the MCP server.
- **Manual QA:** all pages against an isolated daemon; browser notifications in Chrome and Safari; click and focus;
  Claude Code `prompt_input` with the monitor visible, hidden and closed; daemon and monitor restarts with open tabs.

## Release

Patch changeset (0.14.x band) for `@mokei/host-protocol`, `@mokei/host-node`, `@mokei/flow-host-node`,
`@mokei/host-monitor`, `mokei`, and `@mokei/flow-client` if it gains a subpath. The monitor app is private.

## Out of scope

- Focus-based attention (window focus, idle detection).
- Catch-up notifications for items suppressed while attended.
- Durable event replay; the monitor reconciles by re-reading on reconnect.
- Daemon-hosted or auto-launched monitor.
