# Flow Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monitor pages for runs, run detail, inbox and flows, plus the monitor as an inbox surface (presence,
browser notifications, monitor-first prompts, notification clicks opening the monitor).

**Architecture:** The daemon gains `monitor.attach` (stream) and `monitor.presence` (channel). A `MonitorPresence`
module in `@mokei/flow-host-node` tracks attachments and tabs; the desktop controller routes notifications and prompts
through `InboxSurface`s `[monitor, native]`. `@mokei/host-monitor` fixes its bridge transport and attaches. The React
monitor reuses `FlowControl` from `@mokei/flow-client`.

**Tech Stack:** TypeScript, Enkaku (`@enkaku/server`, `@enkaku/client`, `@enkaku/http-serve`, `@enkaku/http-fetch`),
`@tejika/server`, React 19, Vite, TanStack Router, Mantine 9, vitest, jsdom, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-03-flow-monitor-design.md`

## Global Constraints

- Patch changesets only (0.14.x band). One changeset file for the whole branch (Task 14).
- Committed docs never reference local paths (`../sozai`, `/Users/`, worktrees, scratchpad).
- kebab-case file names, except React components (PascalCase) and hooks (camelCase `useX.ts`).
- `pnpm` only. Run scripts as `rtk proxy pnpm run <script>`; per package `pnpm --filter <name> run <script>`.
- Workspace tests resolve dependencies from built `lib/`: rebuild a changed dependency before testing its dependents
  (`pnpm --filter <dep> run build`).
- ID casing: `itemID`, `runID`, `attachmentID`, `attemptID`, `tabID` (never `Id`).
- `_meta`-style keys, if any, use `dev.mokei/`.
- Timeouts: `PRESENCE_REPLY_TIMEOUT_MS = 5_000` (pong and ack). Trace polling 2 s; post-terminal polling until two
  matching reads or 10 s.
- Monitor URL accepted by the daemon: exactly `http://127.0.0.1:<port>/`, port 1–65535, no credentials, query, fragment
  or other path.
- No new package. New code lives in existing packages and `monitor/`.

## Rulings on the spec

- **Attachment ID reaches the tab through the bridge, not the page.** `@tejika/server`'s `serveStaticSPA` injects only
  the token. Instead of a page-config channel, `@mokei/host-monitor`'s bridge-to-socket pipe stamps
  `param.attachmentID` with its current attachment ID on every `monitor.presence` open (overwriting what the browser
  sent). The browser opens the channel with `{ attachmentID: '' }`. After a re-attach, reopened channels get the new
  ID automatically. Cost if wrong: a page-config endpoint later; protocol unchanged.
- **Native `closed` needs no notifier API change.** The native delivery's `closed` resolves when `close()` is called or
  the item settles; only the monitor surface needs target-loss observation. `@mokei/host-desktop`'s `notify` keeps
  returning `Promise<void>`.
- **403 handling:** any HTTP 403 from `/api` shows the full-page "monitor restarted, reload" state (no config re-fetch).
- **The service owns surface assembly.** `createFlowService` builds `[monitorSurface, nativeSurface]` from new params
  `monitor?: MonitorPresence` and `openURL?: (url: string) => Promise<void>`, since the controller is created inside
  the service.

## Review Focus

- A frozen tab (channel open, no pongs) must never suppress or swallow a notification: it falls back to native within
  `PRESENCE_REPLY_TIMEOUT_MS`. Pinned by Task 3 and Task 6 tests.
- A tab closed after acknowledging a prompt must not leave an MCP `prompt_input` caller waiting forever: the prompt
  falls back to the native dialog. Pinned by Task 6 and Task 9 tests.
- A daemon restart while `mokei monitor` runs must leave open tabs working after reconnect, not silently stale. Pinned
  by Task 8 and Task 9 tests.
- An item settled elsewhere while its monitor page or form is open must show its outcome and never double-settle.
  Pinned by Task 12 tests.
- A stale list snapshot must not resurrect a settled inbox item or roll back a run state. Pinned by Task 10 tests.

---

### Task 1: Monitor procedures in host-protocol

**Files:**
- Create: `packages/host-protocol/src/monitor-schemas.ts`
- Modify: `packages/host-protocol/src/index.ts` (protocol entries, exports, `MonitorProcedure`, `FlowProcedure`)
- Test: `packages/host-protocol/test/monitor-schemas.test.ts`

**Interfaces:**
- Produces schemas and types: `monitorAttachParamSchema` (`{ url: string }`), `monitorAttachReceiveSchema`
  (`{ type: 'attached', attachmentID: string }`), `monitorPresenceParamSchema` (`{ attachmentID: string }`),
  `monitorPresenceSendSchema` (tab → daemon union: `state`, `pong`, `ack`), `monitorPresenceReceiveSchema`
  (daemon → tab union: `ping`, `notify`, `prompt`, `withdraw`), with exact fields from the spec's message table
  (`notify` and `prompt` carry `attemptID`, `deadline: number`, `itemID`; `notify` also `title`, `message`;
  `state.activeItemID` optional). Types `MonitorPresenceSend`, `MonitorPresenceReceive` via `FromSchema`.
- `protocol['monitor.attach'] = { type: 'stream', param, receive }`,
  `protocol['monitor.presence'] = { type: 'channel', param, send, receive }`.
- `export type MonitorProcedure = 'monitor.attach' | 'monitor.presence'`;
  `FlowProcedure = Exclude<keyof Protocol, keyof BaseProtocol | MonitorProcedure>`.

- [ ] **Step 1: Write failing tests** — validate (with the repo's existing schema validator used in other
  host-protocol tests) one valid example per message variant, and reject: `notify` without `deadline`, `state` without
  `canNotify`, unknown `type`, extra properties. Type test: `'monitor.attach'` is not assignable to `FlowProcedure`
  (`expectTypeOf`).
- [ ] **Step 2: Run** `pnpm --filter @mokei/host-protocol run test` — FAIL (module missing).
- [ ] **Step 3: Implement** the schemas (`as const satisfies Schema`, `additionalProperties: false`) and protocol
  entries.
- [ ] **Step 4: Run** tests and `pnpm --filter @mokei/host-protocol run build` — PASS.
- [ ] **Step 5: Commit** `feat(host-protocol): add monitor attach and presence procedures`.

### Task 2: Monitor handler slot in host-node

**Files:**
- Modify: `packages/host-node/src/daemon-server.ts`
- Test: `packages/host-node/test/daemon-server.test.ts` (or the existing handler composition test file)

**Interfaces:**
- Consumes: `MonitorProcedure` (Task 1).
- Produces: `MONITOR_PROCEDURES = ['monitor.attach', 'monitor.presence'] as const satisfies Array<MonitorProcedure>`.
  When `params.handlers` lacks one, `serveHostDaemon` installs a handler throwing
  `HandlerError({ code: 'MONITOR_UNAVAILABLE', message: 'Monitor presence is unavailable in this daemon entry.' })`.

- [ ] **Step 1: Failing test** — a daemon served without monitor handlers answers `monitor.attach` with error code
  `MONITOR_UNAVAILABLE`; with a provided `monitor.attach` handler, the provided one is called (composition has no
  duplicate error).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** mirroring the `FLOW_PROCEDURES` unavailable loop.
- [ ] **Step 4: Run** tests, build — PASS.
- [ ] **Step 5: Commit** `feat(host-node): reserve monitor procedure handlers`.

### Task 3: `MonitorPresence` core and handlers

**Files:**
- Create: `packages/flow-host-node/src/monitor-presence.ts`, `packages/flow-host-node/src/monitor-handlers.ts`
- Modify: `packages/flow-host-node/src/index.ts` (exports)
- Test: `packages/flow-host-node/test/monitor-presence.test.ts`, `packages/flow-host-node/test/monitor-handlers.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  ```ts
  export const PRESENCE_REPLY_TIMEOUT_MS = 5_000
  export function parseMonitorURL(url: string): URL // throws MonitorURLError (name 'MonitorURLError')
  export type MonitorTab = { send(message: MonitorPresenceReceive): void; close(): void }
  export type MonitorPresence = {
    attach(url: string): { attachmentID: string; detach(): void }
    /** Registers a tab channel; returns the handler for its messages and a disconnect function. */
    connect(attachmentID: string, tab: MonitorTab): { receive(message: MonitorPresenceSend): void; disconnect(): void }
    currentURL(): URL | undefined
    status(): 'attended' | 'reachable' | 'unavailable'
    isAttended(signal: AbortSignal): Promise<boolean>
    /** Low-level helpers used by the surface (Task 4). */
    ping(tabKey: string, signal: AbortSignal): Promise<boolean>
    tabs(): Array<MonitorTabState>
    request(tabKey: string, message: Extract<MonitorPresenceReceive, { type: 'notify' | 'prompt' }>, signal: AbortSignal): Promise<boolean> // resolves ack.shown; false on timeout
    withdraw(tabKey: string, attemptID: string): void
    onTabClosed(tabKey: string, listener: () => void): () => void
    dispose(): void
  }
  export type MonitorTabState = { key: string; attachmentID: string; visible: boolean; canNotify: boolean; activeItemID?: string; lastVisibleAt: number }
  export function createMonitorPresence(params?: { now?: () => number; randomID?: () => string }): MonitorPresence
  export type MonitorHandlers = Pick<ProcedureHandlers<Protocol>, MonitorProcedure>
  export function createMonitorHandlers(presence: MonitorPresence): MonitorHandlers
  ```
- Behaviour per spec "MonitorPresence": `connect` with unknown attachment throws `MonitorAttachmentNotFoundError`;
  `detach` closes only that attachment's tabs; `currentURL` = most recent live attachment; `isAttended` pings every
  `visible` tab concurrently, true on first pong, false after `PRESENCE_REPLY_TIMEOUT_MS`; a tab missing a ping is
  marked not visible until its next `state`; late `pong`/`ack` with unknown nonce or attempt ignored.
- Handlers: `monitor.attach` validates via `parseMonitorURL` (error code `INVALID_PARAMS`), writes `attached`, holds
  until `signal` aborts, then detaches. `monitor.presence` connects with `param.attachmentID`, pipes `readable` into
  `receive`, writes daemon messages to `writable`, disconnects when `readable` ends or `signal` aborts.

- [ ] **Step 1: Failing tests (fake timers)** — `parseMonitorURL` accepts `http://127.0.0.1:4000/`, rejects
  `https://127.0.0.1:4000/`, `http://localhost:4000/`, `http://127.0.0.1:4000/x`, `http://u:p@127.0.0.1:4000/`,
  `?q`, `#f`, port 0; attach twice → `currentURL` is the second, detach second → first; detach closes only its tabs
  (`tab.close` called); `status` transitions; `isAttended` true with a ponging visible tab, false for a frozen visible
  tab after 5 s and that tab then counts as not visible; late pong ignored; `request` resolves `true` on
  `ack{shown:true}`, `false` on `shown:false` and on timeout; late ack after timeout ignored; handlers: attach with
  bad URL rejects `INVALID_PARAMS`; attach stream emits `attached` then detaches on abort; presence channel with
  unknown attachment errors.
- [ ] **Step 2: Run** `pnpm --filter @mokei/flow-host-node run test` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS. Build.
- [ ] **Step 5: Commit** `feat(flow-host-node): track monitor attachments and tab presence`.

### Task 4: Monitor inbox surface

**Files:**
- Create: `packages/flow-host-node/src/surfaces.ts` (contract), `packages/flow-host-node/src/monitor-surface.ts`
- Test: `packages/flow-host-node/test/monitor-surface.test.ts`

**Interfaces:**
- Produces the spec's `PromptOutcome`, `SurfaceStatus`, `SurfaceDelivery`, `InboxSurface` (in `surfaces.ts`, exported).
- `createMonitorSurface(presence: MonitorPresence, params?: { randomID?: () => string; now?: () => number }): InboxSurface`
  - `notify(item)`: target = `canNotify` tab with greatest `lastVisibleAt`; `ping` then `request({type:'notify', attemptID, deadline: now()+PRESENCE_REPLY_TIMEOUT_MS, itemID, title: 'mokei', message})`
    (message: `Flow needs your approval` / `Flow needs your input`, as the native path). Failure → `withdraw` → `null`.
    Delivery `close()` sends `withdraw`; `closed` resolves on `close()` or target tab close.
  - `prompt(item)`: target = a visible tab answering a ping, else most recently visible `canNotify` tab answering a ping;
    none → `null`. `request({type:'prompt', ...})`; failure → `withdraw` → `null`. `closed` resolves when the target
    tab closes (target loss) or on `close()`.
- `isAttended` delegates to presence; `status` delegates.

- [ ] **Step 1: Failing tests** — target selection by `lastVisibleAt`; no `canNotify` tab → `null` without messages;
  ping timeout → `null` and no `notify` sent; ack `shown:false` → `withdraw` sent, `null`; delivery `close()` sends
  `withdraw` with the same `attemptID`; prompt prefers a visible tab over a more recently visible hidden one; prompt
  `closed` resolves when the target tab disconnects; `deadline` equals `now + 5000`.
- [ ] **Step 2–4:** run FAIL, implement, run PASS.
- [ ] **Step 5: Commit** `feat(flow-host-node): add the monitor inbox surface`.

### Task 5: URL opener in host-desktop

**Files:**
- Create: `packages/host-desktop/src/open-url.ts`
- Modify: `packages/host-desktop/src/index.ts`, `packages/host-desktop/README.md`
- Test: `packages/host-desktop/test/open-url.test.ts`

**Interfaces:**
- `export function openURL(url: string, options?: { runner?: Runner; platform?: NodeJS.Platform; signal?: AbortSignal }): Promise<void>`
  — `darwin`: `runner.run('open', [url], { timeoutMs: 10_000, signal })`; `linux`: `xdg-open`; other platforms throw
  `Error('Opening URLs is not supported on <platform>')`; non-zero exit throws via `unexpectedExit`.

- [ ] **Step 1: Failing tests** with a fake runner — darwin calls `open` with exactly `[url]`; linux `xdg-open`; win32
  rejects; exit code 1 rejects.
- [ ] **Step 2–4:** FAIL, implement, PASS; build.
- [ ] **Step 5: Commit** `feat(host-desktop): add openURL`.

### Task 6: Desktop controller on surfaces

**Files:**
- Create: `packages/flow-host-node/src/native-surface.ts`
- Modify: `packages/flow-host-node/src/desktop.ts`, `packages/flow-host-node/src/service.ts`,
  `packages/flow-host-node/src/index.ts`
- Test: `packages/flow-host-node/test/desktop.test.ts` (rewrite affected cases), `packages/flow-host-node/test/native-surface.test.ts`, `packages/flow-host-node/test/service.test.ts` (settled outcome passing)

**Interfaces:**
- Consumes: Tasks 3–5.
- `createNativeSurface(params: { adapter?: FlowDesktopAdapter; notifications: boolean; host(): FlowHost; monitorURL(): URL | undefined; openURL?(url: string): Promise<void>; onError(error: unknown): void }): InboxSurface & { notifySummary(count: number): void }`
  - `notify`: today's item notification (`group: mokei-inbox-<id>`); click → if `monitorURL()` →
    `openURL(new URL('inbox/' + encodeURIComponent(item.id), url).href)`, else run today's dialog prompt-and-settle.
  - `prompt`: today's dialog path; converts the `ElicitResult` to `host.inbox.answer/decline/cancel` exactly as
    `desktop.ts` does now (approval boolean rules included); returns a delivery whose `close()` aborts the dialog.
  - `notifySummary(count)`: today's `N pending prompts` notification; click opens `new URL('inbox', url)` when a
    monitor URL exists, else nothing.
- `createFlowDesktopController(params: { surfaces: Array<InboxSurface>; native: ReturnType<typeof createNativeSurface>; host(): FlowHost; onError(error: unknown): void }): FlowDesktopController`
  - `FlowDesktopController.settled(item: InboxItem, outcome: InboxOutcome): void` (widened).
  - `prompt(id, signal)` resolves from `settled(item, outcome)` for every surface (mapping per spec); registers the
    waiter before delivering; re-checks pending before fallback; target loss (`closed` before settlement) falls back to
    the next surface; caller abort closes the delivery and releases ownership; keeps `InboxPromptInProgressError`,
    `DesktopPromptUnavailableError`, `InboxItemNotFoundError` semantics.
  - `added`: `isAttended` of any surface true → nothing; else first `reachable` surface whose `notify` delivers;
    stop if settled meanwhile. `restored`: native only (one item → `native.notify`, many → `notifySummary`).
  - `dispose`: closes every delivery, disposes native adapter as today.
- `FlowServiceParams` gains `monitor?: MonitorPresence` and `openURL?: (url: string) => Promise<void>`; service builds
  `[createMonitorSurface(monitor), native]` when `monitor` is set, else `[native]`, and calls
  `desktop?.settled(data.item, data.outcome)`.

- [ ] **Step 1: Failing tests** — attended monitor suppresses native notify; frozen visible tab → native notify after
  5 s (fake timers); monitor `notify` success → native not called; monitor `null` → native; settle closes both kinds
  of delivery; prompt via monitor resolves `accept` on `settled(item,'answered')`, `decline`, `cancel`, rejects
  `InboxItemNotFoundError` on `withdrawn`; monitor target loss before settle → native dialog shown; caller abort →
  `withdraw` sent, ownership released, item still pending; second concurrent prompt for the same item →
  `InboxPromptInProgressError`; native click with monitor URL calls `openURL('http://127.0.0.1:4000/inbox/a%2Fb')`
  for item id `a/b`; without monitor URL opens the dialog; restored with monitor attended still notifies natively;
  `notifications: false` disables native but monitor notify still runs. Existing desktop tests keep passing after
  adapting to the new params.
- [ ] **Step 2–4:** FAIL, implement, PASS; build `@mokei/flow-host-node`.
- [ ] **Step 5: Commit** `feat(flow-host-node): route inbox notifications and prompts through surfaces`.

### Task 7: host-monitor transport fixes

**Files:**
- Modify: `packages/host-monitor/src/index.ts`, `packages/host-monitor/src/pipes.ts`
- Test: `packages/host-monitor/test/pipes.test.ts`, `packages/host-monitor/test/monitor.test.ts` (new)

**Interfaces:**
- `createServerBridge<Protocol>({ allowedOrigin: new URL(url).origin, onRequestAborted })`, created after
  `createLocalServer` resolves.
- `wireMonitorStreams` gains `params.filter(message): { forward: unknown } | { reply: unknown }` applied to
  bridge → socket messages, and `params.injected: ReadableStream<unknown>` merged into the socket writable (abort
  messages `{ header: {}, payload: { typ: 'abort', rid, rsn: 'ClientDisconnected' } }`, matching the Enkaku client abort
  message shape used by `@enkaku/client`; verify the exact shape from `@enkaku/protocol` types).
- Filter rules: `monitor.attach` from the bridge → error reply for that `rid` (code `FORBIDDEN`); `monitor.presence`
  opens get `param.attachmentID` stamped with the current attachment ID (Task 8 supplies it; until then a getter
  returning `''`).
- `Monitor.url` ends with `/`.

- [ ] **Step 1: Failing tests** — with a fake daemon socket stream: a POST to `/api` with header
  `Origin: <monitor origin>` and bearer token succeeds; aborting a browser SSE request makes the fake daemon receive an
  `abort` for its `rid`; a browser `monitor.attach` gets an error reply and never reaches the socket; a browser
  `monitor.presence` open reaches the socket with the stamped `attachmentID`; `url` ends with `/`.
- [ ] **Step 2–4:** FAIL, implement, PASS; build.
- [ ] **Step 5: Commit** `fix(host-monitor): accept browser origin and forward aborted calls`.

### Task 8: Monitor attach, reconnection and daemon wiring

**Files:**
- Modify: `packages/host-monitor/src/index.ts`, `packages/cli/src/daemon-entry.ts`
- Test: `packages/host-monitor/test/monitor.test.ts`, `integration-tests/suites/flow-monitor.test.ts` (new)

**Interfaces:**
- `startMonitor` opens `monitor.attach({ url })` on its daemon client after listening; stores `attachmentID` from the
  first message for the stamping filter. On socket close: closes every wrapped SSE response body (the `/api` handler
  wraps `text/event-stream` bodies in a closable `ReadableStream` tracked in a set), reconnects with backoff
  (250 ms doubling to 5 s; `@sozai/async` `sleep`), creates a new bridge and pipes, re-attaches. Dispose stops
  reconnection and closes the attach stream.
- `startMokeiDaemon` creates `createMonitorPresence()`, passes
  `handlers: composeHandlers(createFlowHandlers(service), createMonitorHandlers(presence))` and
  `createFlowService({ ..., monitor: presence, openURL: (url) => openURL(url) })`; disposes presence on shutdown.
  `startMokeiDaemon` params gain `openURL?` for tests.
- E2E support: a helper `connectTab(monitor, { visible, canNotify })` in `integration-tests/support/` that opens
  `monitor.presence` over HTTP with the monitor's `Origin` and token and answers pings and acks as configured.

- [ ] **Step 1: Failing tests** — unit: `startMonitor` against a fake daemon attaches with its URL; fake daemon
  socket closes → open SSE bodies end, a new connection re-attaches. E2E (real daemon via `startMokeiDaemon` with a
  fake desktop adapter and fake `openURL`): visible tab suppresses the fake notifier; hidden `canNotify` tab receives
  `notify`; frozen tab → fake notifier called; `inbox.prompt` from a socket client routes to the tab and resolves
  `accept` after the tab-side client calls `inbox.answer`; closing the tab's session → fake dialog shown; native click
  (fake adapter invokes `onClick`) → `openURL` called with `<monitor url>inbox/<itemID>`; daemon restart with the
  monitor running → monitor re-attaches (`currentURL` set again) and a new tab connects.
- [ ] **Step 2–4:** FAIL, implement, PASS (`pnpm --filter mokei-integration-tests run test -- flow-monitor`).
- [ ] **Step 5: Commit** `feat: attach the monitor to the daemon as an inbox surface`.

### Task 9: Monitor foundation — harness, connection, data layer, navigation

**Files:**
- Modify: `monitor/package.json` (scripts `test`, `test:unit`; devDeps `vitest`, `jsdom`, `@testing-library/react`,
  `@testing-library/user-event`; deps `@mokei/flow-client`, `@mantine/notifications`), `pnpm-workspace.yaml` catalog
  entries for new packages, `monitor/vite.config.ts` (vitest `environment: 'jsdom'`), `monitor/src/routes/__root.tsx`
- Create: `monitor/src/flow/FlowProvider.tsx`, `monitor/src/flow/reconcile.ts`, `monitor/src/flow/useRuns.ts`,
  `useRun.ts`, `useRunTrace.ts`, `useInbox.ts`, `useInboxItem.ts`, `useFlows.ts`, `monitor/src/flow/connection.ts`,
  `monitor/src/components/AppHeader.tsx`, `monitor/src/components/ConnectionBanner.tsx`
- Test: `monitor/test/reconcile.test.ts`, `monitor/test/FlowProvider.test.tsx`
- Possibly modify: `packages/flow-client/package.json` + `src/control.ts` (`./control` subpath) — see Step 6.

**Interfaces:**
- `reconcile.ts` (pure): `applyRunEvent(runs: Map<string, FlowRunSnapshot>, event)`, `applyInboxEvent(state: InboxState, event)`,
  `type InboxState = { items: Map<string, InboxItem>; settled: Map<string, InboxOutcome> }`,
  `mergeInboxSnapshot(state, items)` ignores items in `settled` (tombstones); `createGenerationGuard()` returning
  `{ next(): number; isCurrent(n): boolean }`.
- `FlowProvider` context: `{ control: FlowControl; epoch: number; status: FlowServiceStatus | undefined; connected: boolean; restarted: boolean; on(listener: (event: FlowEvent) => void): () => void }`.
  Owns the client (wrapping `fetch` to flag 403 → `restarted`), one `control.subscribe()`, raw `events` stream for
  `service:status` opened before `info`, recreation with backoff on transport failure (epoch bump).
- Hooks follow the spec's reconciliation rule (buffer → generation-tagged read → snapshot → re-read affected IDs from
  buffered events → live events).
- Header: links Events (`/`), Runs, Inbox (badge = pending count), Flows; `Notifications` provider from
  `@mantine/notifications` mounted in `__root.tsx`.

- [ ] **Step 1: Failing tests** — `applyRunEvent` replaces by `runID`; `mergeInboxSnapshot` does not resurrect a
  tombstoned item; generation guard discards an old read; `FlowProvider` with a mocked transport: 403 sets
  `restarted`; transport failure bumps `epoch` and resubscribes; a `service:status` event arriving after `info` was
  issued wins.
- [ ] **Step 2–4:** FAIL, implement, PASS (`pnpm --filter monitor run test`).
- [ ] **Step 5: Run** `pnpm --filter monitor run build`.
- [ ] **Step 6: Bundle check** — `grep -l "createFlowControlServer" monitor/dist/assets/*.js` must find nothing. If it
  finds a match, add `packages/flow-client/src/control.ts` re-exporting everything except `server.js`, a `./control`
  export in `packages/flow-client/package.json`, import from `@mokei/flow-client/control`, rebuild, re-check. Add the
  grep as a `test:bundle` script in `monitor/package.json`.
- [ ] **Step 7: Commit** `feat(monitor): flow data layer, connection handling and navigation`.

### Task 10: Presence provider

**Files:**
- Create: `monitor/src/presence/PresenceProvider.tsx`, `monitor/src/presence/browser-notifications.ts`,
  `monitor/src/components/NotificationPermissionButton.tsx`
- Modify: `monitor/src/routes/__root.tsx`
- Test: `monitor/test/PresenceProvider.test.tsx`

**Interfaces:**
- `PresenceProvider` opens `client.createChannel('monitor.presence', { param: { attachmentID: '' } })`, sends `state`
  on open, `visibilitychange`, permission change and `setActiveItem(itemID | undefined)` (context function used by the
  item page); answers `ping` with `pong`; on `notify`/`prompt` drops messages past `deadline`, acts per spec, acks
  every attempt; `withdraw` closes that attempt's `Notification` and toast; closes notifications on `inbox:settled`
  and, after reconnect, those whose item is no longer pending; reopens the channel with backoff.
- Context: `{ activeItemID?: string; setActiveItem(id?: string): void; canNotify: boolean; requestPermission(): Promise<void> }`.
- Toast for new items while visible: `notifications.show` from `@mantine/notifications`, linking to the item.

- [ ] **Step 1: Failing tests** (mocked channel, stubbed `Notification` and `document.visibilityState`) — first send is
  `state` with current visibility; `visibilitychange` sends `state`; `ping` → `pong` with the nonce; `notify` while
  hidden creates a `Notification` and acks `shown: true`; `notify` without permission acks `shown: false`; expired
  `deadline` is dropped without ack; `prompt` with no active item navigates to `/inbox/<itemID>`; `prompt` with another
  active item shows a toast and does not navigate; `withdraw` closes the notification.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit** `feat(monitor): report presence and show browser notifications`.

### Task 11: Runs pages and trace waterfall

**Files:**
- Create: `monitor/src/routes/runs.index.tsx`, `monitor/src/routes/runs.$runID.tsx`,
  `monitor/src/components/RunStateBadge.tsx`, `monitor/src/components/TraceWaterfall.tsx`,
  `monitor/src/components/LogList.tsx`, `monitor/src/flow/span-tree.ts`
- Test: `monitor/test/span-tree.test.ts`, `monitor/test/TraceWaterfall.test.tsx`

**Interfaces:**
- `buildSpanTree(spans: Array<StoredSpan>, run: FlowRunSnapshot): { root: SpanNode; start: number; end: number }` —
  `SpanNode = { id: string; name: string; start: number; end?: number; status: 'ok' | 'error' | 'unset'; attributes: Record<string, unknown>; children: Array<SpanNode> }`;
  a synthetic root from the run snapshot (open `end` while the run is active) holds spans whose parent is not stored.
  `barPosition(node, start, end): { left: number; width: number }` as fractions 0–1.
- `TraceWaterfall` = Mantine `Tree` + `useTree`, `renderNode` bar, ruler, inside `Splitter` with `DataList` detail;
  `onSelectSpan(spanID?)` filters `LogList` (`level`, text, span filters).
- `/runs`: table, state filter (`SegmentedControl` or `Select`), cancel action. `/runs/$runID`: `DataList` snapshot,
  result or error, pending items (links), refresh button, cancel.

- [ ] **Step 1: Failing tests** — orphan spans hang under the synthetic root; nesting by parent ID; `barPosition` for
  a span starting halfway with quarter duration → `{ left: 0.5, width: 0.25 }`; running root has open end;
  `TraceWaterfall` renders span names and selecting one calls `onSelectSpan`.
- [ ] **Step 2–4:** FAIL, implement, PASS; `pnpm --filter monitor run build` (route tree regenerates).
- [ ] **Step 5: Commit** `feat(monitor): runs list, run detail and trace waterfall`.

### Task 12: Inbox pages and schema form

**Files:**
- Create: `monitor/src/routes/inbox.index.tsx`, `monitor/src/routes/inbox.$itemID.tsx`,
  `monitor/src/components/SchemaForm.tsx`, `monitor/src/components/ApprovalCard.tsx`, `monitor/src/flow/schema-fields.ts`
- Test: `monitor/test/schema-fields.test.ts`, `monitor/test/SchemaForm.test.tsx`, `monitor/test/inbox-item.test.tsx`

**Interfaces:**
- `schemaToFields(schema: unknown): Array<FormField> | null` — `null` when outside the elicitation subset;
  `FormField = { name: string; kind: 'string' | 'number' | 'integer' | 'boolean' | 'enum'; title?: string; description?: string; required: boolean; default?: unknown; format?: string; options?: Array<{ value: string; label: string }> }`
  (`oneOf` of `const`/`title` and `enum` with `enumNames` both map to `options`).
- `SchemaForm({ schema, onSubmit(values), onDecline?, onCancel?, errors?: Array<string> })`.
- `/inbox/$itemID`: approval → `ApprovalCard` (plan tools; Approve = `inbox.answer` with no content, Deny =
  `inbox.decline`); input → `SchemaForm` (Accept = `inbox.answer(values)`, Decline, Cancel). Calls `setActiveItem`
  while mounted. Settled while open → observed outcome; not pending on load → "No longer pending";
  `InboxItemNotFoundError` on submit → "already settled" notice.

- [ ] **Step 1: Failing tests** — `schemaToFields` maps each primitive, required, defaults, titled enums; nested object
  → `null`; `SchemaForm` blocks submit with a missing required field and submits typed values; inbox item page shows
  the outcome when an `inbox:settled` event arrives, and "No longer pending" when `inbox.get` fails not-found.
- [ ] **Step 2–4:** FAIL, implement, PASS; build.
- [ ] **Step 5: Commit** `feat(monitor): inbox pages with approvals and input forms`.

### Task 13: Flows page

**Files:**
- Create: `monitor/src/routes/flows.tsx`, `monitor/src/components/StartRunForm.tsx`
- Test: `monitor/test/StartRunForm.test.tsx`

**Interfaces:**
- Flows table (name, id, version, outputs, outcomes). `StartRunForm({ flow, onStarted(runID) })`: `SchemaForm` when
  `schemaToFields(flow.input)` is non-null, else `JsonInput` (must parse to an object); optional label; calls
  `control.runs.start({ flow: flow.id, input, label })`, then navigates to `/runs/$runID`. Daemon errors render on the
  form. A "Check" action shows `flows.check` issues for the flow's definition when available.

- [ ] **Step 1: Failing tests** — flat input schema renders fields; non-flat renders `JsonInput`; invalid JSON blocks
  submit; submit calls `runs.start` with `{ flow, input, label }` and `onStarted` with the run ID.
- [ ] **Step 2–4:** FAIL, implement, PASS; build.
- [ ] **Step 5: Commit** `feat(monitor): flows page with run start`.

### Task 14: Docs and release

**Files:**
- Modify: `docs/agents/architecture.md` (monitor surface, presence procedures), `packages/host-monitor/README.md`,
  `packages/flow-host-node/README.md`, `packages/host-protocol/README.md`, `packages/host-desktop/README.md`,
  `docs/agents/plans/milestones/2026-10-01-flow-daemon-milestone.md` (row 5 in progress note)
- Create: `.changeset/flow-monitor.md` (patch: `@mokei/host-protocol`, `@mokei/host-node`, `@mokei/host-desktop`,
  `@mokei/flow-host-node`, `@mokei/host-monitor`, `mokei`, and `@mokei/flow-client` if Task 9 added `./control`)

- [ ] **Step 1:** Update docs; no local paths.
- [ ] **Step 2: Run** `rtk proxy pnpm run build`, `rtk proxy pnpm run lint`, `rtk proxy pnpm run test`,
  `rtk proxy pnpm run test:packed` — all PASS.
- [ ] **Step 3: Commit** `docs: monitor surface and release notes`.
