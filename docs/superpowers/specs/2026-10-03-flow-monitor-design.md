# Flow monitor design

**Date:** 2026-10-03
**Milestone:** [flow daemon](../../agents/plans/milestones/2026-10-01-flow-daemon-milestone.md), sub-project 5
**Branch:** `feat/flow-monitor`

## Goal

Make the monitor the main human surface for flows: list and inspect runs (trace and logs), answer inbox inputs and
approvals, and start and cancel runs. Treat the monitor as an inbox surface next to the native desktop: an attended
monitor suppresses desktop notifications, a hidden monitor tab shows browser notifications, and prompts route to the
monitor first. Native notifications and dialogs remain the fallback when no monitor tab can deliver.

The milestone row asked for the pages and for revisiting notification clicks. Presence-based routing goes further, by
explicit decision during brainstorming: the monitor is treated as one more desktop notification channel.

## Decisions

- **Scope: act and observe.** Runs list, run detail (trace and logs), inbox (approve, deny, accept, decline, cancel),
  flows (check results, start a run). The existing events page stays.
- **The browser reuses `FlowControl`.** The monitor wraps its existing Enkaku client in `createRemoteFlowControl`
  from `@mokei/flow-client`, so the CLI, MCP and the monitor share one adapter.
- **Inbox surfaces.** The daemon routes notifications and prompts through an ordered list of surfaces,
  `[monitor, native]`.
- **Presence over a channel, liveness by ping.** Each monitor tab holds a `monitor.presence` channel. A tab's claims
  (visible, can notify) are trusted only after a fresh `pong`: the daemon pings before suppressing, notifying or
  prompting. There is no periodic heartbeat.
- **Monitor registration over a stream.** The `mokei monitor` server holds a `monitor.attach` stream. The stream's
  lifetime is the registration, and tabs are bound to the attachment that served them.
- **No catch-up.** An item that arrived while the monitor was attended gets no notification later.
- **Prompts route monitor first.** Attended tab: the form opens in the page. Hidden tab with notification permission:
  a browser notification leads to the form. Otherwise: the native dialog, as today.
- **Visibility means the Page Visibility API.** Window focus is not required, so a monitor on a second screen counts.
- **Recovery notifications stay native.** After a daemon restart, the startup summary (none, one item or a count) goes
  through the native surface only, as today, even if a monitor attaches before recovery finishes. This is deliberate:
  recovery runs once, and a tab that reconnects shows the pending items itself.
- **The browser never calls `inbox.prompt`.** The browser client serialises its sends, so one long request would block
  the tab's channel replies; the monitor settles items with `inbox.answer`, `inbox.decline` and `inbox.cancel`.

## Monitor transport fixes (`@mokei/host-monitor`)

Prerequisites, verified against the installed `@enkaku/http-serve` and `@enkaku/http-fetch`:

- **Allowed origin.** `startMonitor` creates the bridge without `allowedOrigin`, and the bridge rejects any request
  carrying an `Origin` header (403), which browsers send on every POST. Create the bridge after the server listens, with
  `allowedOrigin` set to the monitor's own origin (`http://127.0.0.1:<port>`). Covered by a test that sends a browser
  `Origin` header.
- **Abort forwarding.** On SSE disconnect the bridge drops its bookkeeping and calls `onRequestAborted`, but sends
  nothing to the daemon, so daemon-side streams and channels outlive the tab. `startMonitor` passes
  `onRequestAborted` and writes an Enkaku `abort` message for each abandoned request ID to the daemon socket (the
  bridge-to-socket pipe becomes a merge of the bridge stream and these aborts). Covered by a test that disconnects a
  browser session abruptly and checks the daemon handler's signal aborts.
- **Reserved procedures.** The bridge-to-socket pipe rejects `monitor.attach` from browser sessions with an error reply;
  only the monitor process attaches.
- **Daemon reconnection.** When the daemon socket closes (daemon restart), `startMonitor` keeps its HTTP server and
  token, reconnects to the socket with backoff, creates a new bridge and re-opens `monitor.attach`. Browser sessions on
  the old bridge fail ("Invalid session ID"); the monitor app treats that as a lost connection and reconnects (below).
- **URL.** `startMonitor` returns `url` normalised with a trailing slash.

## Protocol (`@mokei/host-protocol`)

Two procedures, typed as a separate `MonitorProcedure` group so `FlowProcedure` keeps meaning flow procedures only.

### `monitor.attach` (stream)

- Param: `{ url: string }`.
- The daemon validates `url`: it must parse as `http://127.0.0.1:<port>/` exactly (no credentials, query, fragment or
  other path, port 1 to 65535); otherwise the call fails with `INVALID_PARAMS`.
- First stream message: `{ type: 'attached', attachmentID: string }`. No further messages.
- The registration ends when the stream ends for any reason.
- Trust boundary: the daemon socket is the user's own, as for every other procedure. Browser sessions cannot attach
  (reserved at the bridge).

### `monitor.presence` (channel)

- Param: `{ attachmentID: string }`. `startMonitor` injects its current `attachmentID` into the SPA next to the token.
  An unknown or detached `attachmentID` fails the call; the tab reloads its attachment ID by reloading the page config
  (see reconnection).
- Every delivery message carries an `attemptID` so late or stale replies are ignored.

| Direction | Message | When |
|---|---|---|
| tab → daemon | `{ type: 'state', visible: boolean, canNotify: boolean, activeItemID?: string }` | first message, then on `visibilitychange`, permission change, or when the tab opens or leaves an item form |
| tab → daemon | `{ type: 'pong', nonce: string }` | reply to `ping` |
| tab → daemon | `{ type: 'ack', attemptID: string, shown: boolean }` | reply to `notify` or `prompt` |
| daemon → tab | `{ type: 'ping', nonce: string }` | before relying on the tab |
| daemon → tab | `{ type: 'notify', attemptID: string, itemID: string, title: string, message: string }` | new item |
| daemon → tab | `{ type: 'prompt', attemptID: string, itemID: string }` | `inbox.prompt` routed to the monitor |
| daemon → tab | `{ type: 'withdraw', attemptID: string }` | the delivery is no longer wanted (settled, timed out, caller aborted, disposal) |

Timeouts: `pong` and `ack` within 5 s (sends from a tab queue behind its in-flight requests, which are short).

## Daemon side (`@mokei/flow-host-node`)

### Contracts

```ts
type PromptOutcome = { action: 'accept' | 'decline' | 'cancel' }
type SurfaceStatus = 'attended' | 'reachable' | 'unavailable'
type SurfaceDelivery = {
  /** Withdraws the notification (or prompt) if still shown. Idempotent. */
  close(): void
  /** Resolves when the delivery is gone: closed, settled, or its target lost. */
  closed: Promise<void>
}
type InboxSurface = {
  name: string
  /** Cheap, synchronous hint; delivery methods verify liveness themselves. */
  status(): SurfaceStatus
  /** Verified attention: resolves true only when an attended target answered a fresh ping. */
  isAttended(signal: AbortSignal): Promise<boolean>
  /** Resolves null when the surface could not deliver; the next surface is tried. */
  notify(item: InboxItem, options: { signal: AbortSignal }): Promise<SurfaceDelivery | null>
  /**
   * Resolves null when the surface could not show the prompt (the next surface is tried), or a delivery whose
   * settlement the controller observes.
   */
  prompt?(item: InboxItem, options: { signal: AbortSignal }): Promise<SurfaceDelivery | null>
}
```

### Settlement ownership

The flow host stays the only settler. The service calls `controller.settled(item, outcome)` with the inbox outcome
(`answered`, `declined`, `cancelled`, `withdrawn`); today the outcome is discarded, so this widens the call.

- A native prompt keeps settling the item itself from the dialog result, as today.
- A monitor prompt never settles: the tab settles through `inbox.answer`, `inbox.decline` or `inbox.cancel`, and the
  controller resolves the pending `prompt(id)` from `settled(item, outcome)`: `answered` → `accept`, `declined` →
  `decline`, `cancelled` → `cancel`, `withdrawn` → reject with `InboxItemNotFoundError`.
- The controller registers its settlement waiter before delivering a prompt, and re-checks that the item is still
  pending before any fallback.
- Ownership stays per item (`InboxPromptInProgressError`); a caller abort releases ownership and closes the delivery
  without settling.

### `MonitorPresence`

A portable module holding attachments (ID, URL, attach order) and tab channels (attachment, `visible`, `canNotify`,
`activeItemID`, last-visible time, pending pings and attempts).

- `attach(url)` returns `{ attachmentID, detach }`. `detach` closes only that attachment's tab channels.
- `currentURL()`: the URL of the most recently attached attachment.
- `status()`: `attended` if any tab claims `visible`; `reachable` if any tab has `canNotify`; else `unavailable`.
- `isAttended(signal)`: pings every tab that claims `visible` and resolves true on the first `pong`; false when none
  answer within 5 s. A tab that misses a ping is marked not visible until its next `state`.
- `notify(item)`: target = the `canNotify` tab visible most recently. Ping, then `notify`, then wait for `ack`. Missing
  `pong` or `ack`, or `shown: false`, sends `withdraw` and resolves `null`. One target per attempt; no second tab.
- `prompt(item)`: target = an attended tab (verified by ping), else the most recently visible `canNotify` tab (pinged).
  No eligible tab resolves `null`. Then `prompt`, wait for `ack`; failure sends `withdraw` and resolves `null`. The
  delivery's `closed` resolves when the target tab's channel closes. If it closes before the item settles, the
  controller falls back to the next surface for that prompt.
- A tab that already shows a form for another item (`activeItemID` set) does not navigate away on `prompt`: it shows a
  toast and, when hidden, a browser notification linking to the new item, and acks `shown: true`.
- Late `pong` or `ack` messages for unknown nonces or attempt IDs are ignored.

### Native surface

Wraps the existing `FlowDesktopAdapter` (`@mokei/host-desktop`), which stays native-only.

- `status()`: `reachable` when an adapter exists and native notifications are enabled. `isAttended`: always false.
- `notify`: today's notification, grouping and removal. `close()` aborts the notification's signal (which removes an
  alerter notification); the adapter's `notify` returns the backend's delivery so `closed` is observable.
- Click (alerter backend only; osascript, zenity and notify-send report no clicks): if `currentURL()` is set, open
  `new URL('inbox/' + encodeURIComponent(itemID), url)` (summary: `new URL('inbox', url)`) with the platform opener
  (`open` on macOS, `xdg-open` on Linux) through the host-desktop runner, passing the URL as a single argument;
  otherwise prompt the item as today (summary: no action).
- `prompt`: today's desktop dialog, unchanged; it settles the item itself.

### Desktop controller routing

`createFlowDesktopController` takes `surfaces: Array<InboxSurface>`; the CLI daemon entry builds
`[monitorSurface, nativeSurface]`.

- `added(item)`: if any surface's `isAttended` resolves true, send nothing. Otherwise try each `reachable` surface's
  `notify` in order until one returns a delivery. If the item settles meanwhile, stop.
- `restored(items)`: unchanged policy, native surface only (see Decisions).
- `settled(item, outcome)`: `close()` every live delivery for the item; resolve or reject a pending monitor prompt.
- `prompt(id, signal)`: try each surface's `prompt` in order; if none delivers, throw
  `DesktopPromptUnavailableError`. A monitor delivery whose target is lost before settlement falls back to the next
  surface.
- `dispose()`: close every delivery.
- `desktop.notifications: false` in `flows.json` disables native notifications only. The monitor surface still
  suppresses and notifies, since the user opted in by opening the monitor and granting browser permission.

### Wiring

- `@mokei/host-node` serves `monitor.attach` and `monitor.presence` through an injected handler set; no presence logic.
- `@mokei/cli`'s daemon entry creates one `MonitorPresence`, passes its handlers to the daemon and its surface to the
  controller, and passes `settled(item, outcome)` from the flow service.

## Monitor app (`monitor/`)

### Connection

- The SPA reads its token and `attachmentID` from the injected page config.
- `FlowProvider` owns the Enkaku client. On a transport failure ("Invalid session ID", network error) it recreates the
  client with backoff and bumps an epoch. On 403 it re-fetches the page config; if the token changed (monitor
  restarted) it shows a full-page "monitor restarted, reload" state. The provider wraps `fetch` to observe HTTP status,
  since `createRemoteFlowControl` normalises transport failures to `INTERNAL_ERROR`.
- Service status: the provider calls `info` on each epoch and consumes `service:status` from the raw `events` stream
  (`FlowControl.subscribe()` filters it out). Connectivity comes from the subscription state. Actions are disabled
  while disconnected or while the flow service is not ready, with a banner.

### Data layer (`monitor/src/flow/`)

- `FlowProvider` creates `createRemoteFlowControl(client)` and one shared `subscribe()`, fanning out events.
- Hooks: `useFlows()`, `useRuns(filter)`, `useRun(runID)`, `useRunTrace(runID)`, `useInbox()`, `useInboxItem(itemID)`.
- Reconciliation rule for every list and detail hook:
  1. start buffering events for the query before issuing its read;
  2. issue the read tagged with the current generation (epoch and filter);
  3. discard the response if the generation changed;
  4. apply the snapshot, then the buffered events, then live events.
  Inbox state keeps tombstones for items settled during the page session so a stale snapshot cannot resurrect them.
- Event application is pure (`applyRunEvent`, `applyInboxEvent`) and unit tested.
- `useRunTrace`: the store holds only ended spans, so a running trace is partial and the root `flow.run` span appears
  only when the run ends. The hook re-fetches on the run's events, polls every 2 s while the run is active, and after a
  terminal state keeps polling until two consecutive reads match or 10 s pass. The page also has a refresh button.
- The build must not bundle `@mokei/flow-client`'s MCP server. If tree-shaking keeps it, add a `./control` subpath
  export without `server.ts`.

### Presence (`monitor/src/presence/`)

- `PresenceProvider` opens `monitor.presence` with the `attachmentID`; sends `state` on open, `visibilitychange`,
  permission change and form open or close (`activeItemID`); answers `ping`; handles `notify` (browser `Notification`
  tagged with the item ID; click calls `window.focus()` and navigates to `/inbox/<itemID>`), `prompt` (navigate, or
  toast plus notification when a form is already open; a hidden tab also shows a browser notification) and `withdraw`
  (close what that attempt showed). It acks every attempt.
- It closes notifications on `inbox:settled`, and on reconnect closes any notification whose item is no longer pending.
- It reopens the channel with backoff when it ends while the page is open.
- Header: a notification permission button (browsers require a user gesture), a pending-count badge on Inbox, and an
  in-page toast (`@mantine/notifications`) for new items while visible.

### Pages (TanStack file routes)

The header links Events, Runs, Inbox and Flows.

| Route | Content | Actions |
|---|---|---|
| `/` | Existing events page, unchanged | — |
| `/runs` | Table: label, flow, state badge, started, updated; state filter | open, cancel |
| `/runs/$runID` | Snapshot (`DataList`), result or error, pending items, trace waterfall, logs | cancel, refresh trace; answer pending items inline |
| `/inbox` | Pending items, newest first: kind, run, message or plan tools | open |
| `/inbox/$itemID` | Approval: plan tools. Input: `SchemaForm` from `requestedSchema` | approve or deny; accept, decline or cancel |
| `/flows` | Flows with outputs and outcomes; `flows.check` issues | start a run (form from the input schema, optional label), then open the run |

An item that settles while its page is open shows the observed outcome. An item that is not pending on load shows
"no longer pending" (the daemon keeps no settlement history).

### Components

- `TraceWaterfall`: Mantine `Tree` (with `useTree`) for the span hierarchy. Spans whose parent is not stored hang under
  a synthetic root built from the run snapshot (open-ended while the run is active). `renderNode` draws the name,
  duration and a positioned bar (`left` and `width` relative to the run start; colour by status), with a time ruler
  above. Inside a `Splitter`, the detail pane shows the selected span's attributes and events in a `DataList`;
  selecting a span filters the log list. Virtualize with `@tanstack/react-virtual` only if needed.
- Log list: level and text filters, span filter from the waterfall.
- `SchemaForm`: the MCP elicitation subset (flat object; string with formats, number, integer, boolean, enum and titled
  enum; required; defaults). Daemon validation errors render on the form.
- Flow input schemas outside the subset use `JsonInput`; the daemon validates.
- `EmptyState` for empty lists and not-found.

## Testing

- **host-monitor:** a request with a browser `Origin` header succeeds; abrupt SSE disconnect aborts the daemon-side
  handler signal; browser `monitor.attach` is rejected; daemon socket loss reconnects and re-attaches; `url` has a
  trailing slash.
- **Protocol:** schemas, URL validation cases, `MonitorProcedure` typing.
- **`MonitorPresence` (fake timers):** attach, detach closing only its tabs, latest URL wins; `isAttended` with live,
  frozen (no pong) and multiple tabs; notify ping timeout, ack timeout, `shown: false`, late ack ignored, withdraw sent;
  prompt target selection, `activeItemID` behaviour, target loss.
- **Controller:** verified attention suppresses; monitor before native; fallback; prompt outcome mapping from
  `settled(item, outcome)`; withdrawn rejects; caller abort releases ownership; target loss falls back to native;
  settle and dispose close deliveries; native click opens the encoded URL or the dialog; restored stays native.
- **Monitor app (new vitest, jsdom and React Testing Library harness):** pure event application, reconciliation with
  buffered events, stale generations and tombstones; span tree layout with a synthetic root; schema to form fields;
  `SchemaForm`; `PresenceProvider` against a mocked channel.
- **End-to-end (integration suite):** daemon plus `startMonitor`, tabs simulated over HTTP with browser `Origin` and the
  real bridge: attended tab suppresses a fake native notifier; hidden tab receives `notify`; frozen tab falls back to
  native; `inbox.prompt` from another client routes to the tab and resolves after `inbox.answer`; closing the tab's
  session falls back to the native prompt; a native click opens the monitor URL through a fake runner; daemon restart
  with the monitor running re-attaches.
- **Bundle check:** the monitor build succeeds and does not contain the MCP server.
- **Manual QA:** all pages against an isolated daemon; browser notifications in Chrome and Safari; click and focus;
  Claude Code `prompt_input` with the monitor visible, hidden and closed; daemon and monitor restarts with open tabs.

## Release

Patch changeset (0.14.x band) for `@mokei/host-protocol`, `@mokei/host-node`, `@mokei/host-desktop`,
`@mokei/flow-host-node`, `@mokei/host-monitor`, `mokei`, and `@mokei/flow-client` if it gains a subpath. The monitor app
is private.

## Out of scope

- Focus-based attention (window focus, idle detection).
- Catch-up notifications for items suppressed while attended.
- Settlement history for inbox items.
- Live (unended) spans in traces.
- Durable event replay; the monitor reconciles by re-reading on reconnect.
- Daemon-hosted or auto-launched monitor.
