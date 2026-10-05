# Architecture

## Project Overview

Mokei is a TypeScript toolkit for creating, interacting with, and monitoring clients and servers using the Model Context Protocol (MCP). It provides a comprehensive framework for building MCP-based applications with AI model integration.

**Repository**: https://github.com/TairuFramework/mokei
**Documentation**: `docs/guides/` for usage guides, `docs/reference/` for reference material,
`docs/agents/` for agent-facing docs

---

## Architecture

```
+-------------------------------------------------------------+
|                     AgentSession                             |
|  (Automatic agent loop with tool execution)                  |
+-------------------------------------------------------------+
|                        Session                               |
|  (High-level abstraction for chat + MCP)                    |
+-------------------------------------------------------------+
|                     ContextHost                              |
|  (Manages multiple MCP server connections)                   |
+----------------------------+---------------------------------+
|   ContextClient            |          Model Providers         |
|   (MCP client)             | (OpenAI, Anthropic, Ollama, Llama)|
+----------------------------+---------------------------------+
|   ContextServer            |                                  |
|   (MCP server)             |                                  |
+-------------------------------------------------------------+
```

### Communication Flow

1. `NodeContextHost` (`@mokei/host-node`) spawns MCP server processes over stdio.
   `ContextHost.addHTTPContext` connects over Streamable HTTP
2. Client resolves the protocol revision, then discovers tools and prompts -- through an
   `initialize` handshake on `2025-11-25`, or lazily on the first call on `2026-07-28`
3. Tools are namespaced as `contextKey:toolName` (or `local:toolName` for local tools)
4. Session routes tool calls to appropriate MCP servers
5. Results are aggregated and returned to model providers

### Protocol Revisions

Two MCP revisions are supported side by side rather than one superseding the other. Each is a
`ProtocolDefinition` in `packages/context-protocol/src/versions/`, and `PROTOCOLS` maps a
revision to its definition.

- `2025-11-25` is stateful. An `initialize` handshake opens every connection, and servers may
  send requests to clients, so `sampling`, `elicitation` and `roots` work here.
- `2026-07-28` is stateless. There is no handshake: a client reads capabilities from
  `server/discover` and sets itself up on its first call. The log level travels per request in
  `_meta`. Servers send no requests: `sampling`, `elicitation` and `roots` work here too, through
  multi round-trip requests (MRTR, SEP-2322) instead of server-initiated ones -- a `tools/call` /
  `prompts/get` / `resources/read` handler that needs client input suspends by returning a
  terminal `resultType: 'input_required'` result, and is re-invoked once the client answers with
  `inputResponses`. The client's `createMessage`/`elicit`/`listRoots` handlers are driven
  automatically by an auto-fulfilment loop, so callers see the same result type as on
  `2025-11-25` by default. Both revisions are now at capability parity. Resource and list-change
  notifications arrive through a long-lived `subscriptions/listen` request, not session
  `resources/subscribe`. The client uses `SubscriptionDriver`. Servers use
  `createSubscriptionHub` and `SubscriptionWriter`. Over HTTP, each listen is a streamed
  exchange handled by `runSubscriptionExchange`.

A client speaks one revision, fixed for the lifetime of its transport. `ContextClient` takes a
`protocolVersion`: a revision, or `'auto'` to probe the server and settle on the newest revision
both sides support. Host contexts and the CLI default to `'auto'`. A server takes
`protocolVersions`, the list it serves. Listing both serves both.

### Session Elicitation

`ContextHost` and `NodeContextHost` enable elicitation at construction with `elicit: true` or a
host handler. This choice fixes the capabilities of every client the host builds. A
`2025-11-25` client declares `elicitation` in `initialize`. A `2026-07-28` client declares it in
each request's `_meta` client capabilities. A context can opt out with `elicit: false`.
Caller-built clients registered through `registerHostedContext` keep their own capabilities.

The host binds each request to its context key. `handleElicitation` installs one temporary
override, owned by an `AgentSession` when one is attached. The override can answer directly or
call `fallback()` to use the base handler. With `elicit: true` and no base handler, fallback
declines, including before an agent attaches and after it is disposed. `Session` and
`NodeSession` pass `elicit` to hosts they construct. A supplied host owns its configuration.

On `2025-11-25`, a server sends a reverse `elicitation/create` RPC during its tool call. On
`2026-07-28`, it returns an MRTR `input_required` result. The client answers the embedded
`elicitation/create` request and retries the tool call with `inputResponses` and `requestState`.
Handler errors return a reverse RPC error on the older revision. On the newer revision, they
fail the MRTR call locally without sending an input response.

`AgentSession` emits `elicitation-request` followed by `elicitation-response` or
`elicitation-error`, paired by `requestID`. A matching in-flight context tool adds `toolCall`
attribution and sends those events through its run channel. The channel yields the request
before awaiting the application answer. A per-tool settlement barrier emits every elicitation
terminal event before the tool terminal event. Run, tool, stream-abandonment and disposal
cancellation abort pending answers. Unattributed requests reach `onEvent` only.

`@mokei/host`, `@mokei/session` and `@mokei/context-server` remain Node-free. Stdio support
lives in `@mokei/host-node` and `@mokei/session-node`. URL-mode requests reach the handler,
but `notifications/elicitation/complete` is not forwarded to the application yet.

`@mokei/host-desktop` provides a Node-only `HostElicitHandler`, `createDesktopElicitHandler`. In
`dialog` mode it answers each form with native dialogs (`alerter` or `osascript` on macOS, `zenity`
on Linux), one dialog at a time, within a 90-second budget that ends as `cancel`. In `inbox` mode
it adds the request to a `createInputInbox` inbox as a pending entry, sends a generic notification
and returns when the application answers, declines, cancels or prompts the entry through its own
registered answer surface. An aborted handler signal removes the entry. The inbox is in-process
and single-user. After a restart, waiting on the task again re-adds the entry.
`createDesktopTools` adds `notify` and `ask_user` local tools.

On `2026-07-28` the HTTP client encodes the `Mcp-Method`, `Mcp-Name` and `Mcp-Param-*` request
headers (SEP-2243). The `Mcp-Param-*` set comes from the `x-mcp-header` annotations the transport
caches per tool from `tools/list`, so a peer that changes a tool's schema afterwards leaves that
cache stale. The transport recovers on its own: a `tools/call` rejected with `-32020` naming an
`Mcp-Param-*` header triggers its own `tools/list` to refresh the annotations, and the call is
re-sent once if the header set changed. Callers see an ordinary successful call, at the cost of up
to two extra round trips. The HTTP server does not read any of these headers. Conformance of the
encoder, and the retry itself, are covered by SDK interop tests instead.

### MCP Tasks

The `io.modelcontextprotocol/tasks` extension is available on `2026-07-28` when a server receives
a `TaskManager`. The application owns that manager and its store. A memory store is the default.
Applications that need tasks to survive restarts provide a persistent `TaskStore`.

The manager owns task records, detached workers, cancellation signals and expiry. Its store uses
revision-based compare-and-swap (CAS): a write based on a stale revision conflicts, and the manager
re-reads and retries so concurrent status changes and partial input responses are preserved.
Terminal transitions are first-writer-wins.

Each task record keeps every input request it has made in `inputs`, ordered by increasing `id`.
An entry holds its requests, its responses and, once settled, an `outcome` of `answered` or
`withdrawn`. A request is open when the task status is `input_required` and the latest entry has
no outcome. Four transitions change it, each a single CAS write: ask appends an entry and sets
`input_required`. Answer adds a response and, with the last key, sets `answered` and `working`.
Withdraw sets `withdrawn` and `working`. A terminal status ends an open request. A settled entry
never changes, and keys are never reused. Waiters register a listener, then read the record, and
resolve only from committed records, so a late or reordered notification cannot change the
result. Expiry deletes the record and notifies the waiters, which fail.

Create the manager once for the lifetime of the application. For stdio, pass it to the process's
`ContextServer`. For stateless `2026-07-28` Streamable HTTP, pass it to `serveHTTP` and use the
`tasks` value supplied to each `createServer` callback. HTTP creates a short-lived server per
request, so the shared manager keeps task workers and state alive after a response ends. The
application disposes the manager.
After a restart with persistent storage, call `await tasks.recover(tools)` before accepting
requests, using the same tool definitions as the server.

Tool handlers start detached work with `req.task.run(work)`, which resolves to the task creation
result. The `work` callback receives the task handle, which exposes status updates, cancellation
and input requests. A task created with verified HTTP authorisation
is bound to the token's issuer, subject and scopes. Later requests must have the same issuer and
subject, with scopes that include the recorded scopes. Unauthenticated tasks are ownerless and
use their task ID as a bearer secret. Missing, expired, inaccessible and unrecovered tasks all
return `Task not found`.

On the client, `callTool` waits for a task automatically and returns its final tool result. Pass
`task: 'handle'` to receive the task creation result instead. Then use `client.tasks.wait(taskId)`
to wait explicitly or `client.tasks.get(taskId)` to inspect its current state. Waiting listens for
task notifications and falls back to polling when a listen is unavailable.
When a waited request is withdrawn, the signal passed to the input handler aborts with
`TaskInputWithdrawnError`. A subscribed wait still checks a finite task TTL and fails with
`TaskExpiredError` once the task is gone. Public task snapshots list only unanswered input keys.

### HTTP Authorisation

`@mokei/http-client` provides OAuth 2.1 client middleware through `createOAuthMiddleware` and
`TokenStore` (`createMemoryTokenStore`), including protected-resource metadata discovery, PKCE and
token refresh. `@mokei/host-node` adds `createNodeOAuthMiddleware`, `createFileTokenStore` and
`createLoopbackAuthorizationHandler` for Node consumers. `Session.addHTTPContext` accepts HTTP
contexts. The CLI's `/context add-http` command accepts `--oauth-client-id`, `--oauth-resource`,
`--oauth-scope` and `--oauth-tokens`.

On the server, `@mokei/http-server` offers `serveHTTP` with `createBearerAuthGate`,
`createJWKSVerifier` or `createDIDVerifier`, and `protectedResourceMetadataResponse`. The gate
verifies requests before MCP dispatch. Verified identity is available to task handlers for owner
binding.

---

## API Conventions

### Single Parameters Object
- Every public method takes exactly one parameters object -- no positional arguments
- Transport options are folded into that object: `signal` (abort) and `timeout` (reject with
  `RequestTimeoutError`), plus `maxPages` on the paginated `list*` methods
- Handler callbacks follow the same rule: client `elicit`/`createMessage` receive
  `{ params, signal }`, `listRoots` receives `{ signal }`, a `createTool` handler and a local
  tool's `execute` both receive `{ input, signal }` (the handler also gets `client` and
  `progress`), and `ToolApprovalFn` receives `{ toolCall, iteration, history, tool, signal }`
- **A call carries `arguments`. A handler receives `input`.** `arguments` is MCP's wire field
  (`tools/call`, `prompts/get`) and stays that way on every *call* -- `callTool({ name,
  arguments })`. What a *handler* is given is named `input`, because that is what its
  `inputSchema` describes, and because `arguments` is a reserved binding name in strict mode:
  `({ arguments }) => ...` is a SyntaxError in an ES module, so the field could never be
  destructured. `ContextServer` converts at the dispatch seam.
- Local tools run in-process, so `callLocalTool` takes `signal` but no `timeout`
- `ContextRPC.request(method, params, options)` and `.notify(method, params)` stay positional:
  they are the wire boundary, and `splitRequestOptions` separates wire params from local
  transport options before reaching them

---

## Feature Map

| Feature | Package | Entry point |
|---------|---------|-------------|
| Stdio server and spawned contexts | `@mokei/context-server-node`, `@mokei/host-node`, `@mokei/session-node` | `serveProcess`, `NodeContextHost.addLocalContext`, `NodeSession.addContext` |
| Streamable HTTP | `@mokei/http-client`, `@mokei/http-server`, `@mokei/host` | `HTTPTransport`, `serveHTTP`, `ContextHost.addHTTPContext` |
| OAuth 2.1 | `@mokei/http-client`, `@mokei/host-node`, `@mokei/http-server` | `createOAuthMiddleware`, `createNodeOAuthMiddleware`, `createBearerAuthGate` |
| Revisions and negotiation | `@mokei/context-protocol`, `@mokei/context-client` | `PROTOCOLS`, `ContextClient` `protocolVersion: 'auto'` |
| MRTR | `@mokei/context-client`, `@mokei/context-server` | `runInputRequiredFlow`, `inputRequired` |
| Subscriptions | `@mokei/context-client`, `@mokei/context-server`, `@mokei/http-server` | `SubscriptionDriver`, `createSubscriptionHub`, `runSubscriptionExchange` |
| MCP Tasks | `@mokei/context-client`, `@mokei/context-server`, `@mokei/http-server` | `createTaskManager`, `TaskStore`, `ContextClient.tasks` |
| Tool namespacing and per-context tool switches | `@mokei/host` | `ContextHost.callNamespacedTool`, `enableContextTools`, `disableContextTools` |
| Local tools | `@mokei/host` | `ContextHost.callLocalTool`, `packages/host/src/local-tools.ts` |
| Chat and agent loop | `@mokei/session`, `@mokei/session-node` | Portable `Session` and `AgentSession`. Node stdio `NodeSession.addContext` |
| Provider abstraction and adapters | `@mokei/model-provider`, `@mokei/{openai,anthropic,ollama,llama}-provider` | `ModelProvider`, each provider package's `src/index.ts` |
| System One classification | `@mokei/system-one-client`, `@mokei/mcp-system-one` | `HTTPSystemOneBackend`, `createSystemOneTools` |
| Desktop elicitation and input inbox | `@mokei/host-desktop` | `createDesktopElicitHandler`, `createInputInbox`, `createDesktopTools` |
| Decision flows as MCP tasks | `@mokei/decision-flow`, `@mokei/decision-flow-server` | `createDecisionFlowGraph`, `addDecisionFlow`, `createDecisionFlowServer` |
| Durable flow stores | `@mokei/flow-host-node` | `openFlowDatabase`, `createSQLiteRunStore`, `createSQLiteTaskStore`, `createSQLiteTraceStore` |
| Flow telemetry, configuration and retention | `@mokei/flow-host-node` | `setupFlowTelemetry`, `loadFlowConfig`, `loadFlowDirs`, `startRetention` |
| Shared daemon flow service | `@mokei/flow-host-node`, `@mokei/host-node`, `mokei` | `createFlowService`, `createFlowHandlers`, `serveHostDaemon`, CLI `daemon-entry.js` |
| Portable trace capture and pruning | `@mokei/flow-host` | `TraceStore`, `createMemoryTraceStore`, `createTraceStoreSpanExporter`, `createTraceStoreLogSink`, `pruneRuns` |
| Flow control contract, wait helpers and MCP facade | `@mokei/flow-client` | `FlowControl`, `createRemoteFlowControl`, `waitForRun`, `createFlowControlServer` |
| In-process flow control | `@mokei/flow-host` | `createLocalFlowControl` |
| CLI | `mokei` | `packages/cli/src/program.ts`, `packages/cli/src/commands/{daemon,flows,runs,inbox}.ts` |
| Monitor | `@mokei/host-monitor`, `monitor` | `packages/host-monitor/src/index.ts`, `monitor/src/main.tsx` |

`@mokei/session` uses `ContextHost` and is React Native / Metro-safe. `@mokei/session-node`
extends it with `NodeSession` and `NodeContextHost` for stdio contexts.

---

## Package Structure

```
packages/
+-- context-protocol/     # MCP protocol definitions and types
+-- context-rpc/          # JSON-RPC implementation
+-- context-server/       # MCP server implementation (RN/Metro-safe)
+-- context-server-node/  # Node stdio entry for context-server (serveProcess)
+-- context-client/       # MCP client implementation
+-- host/                 # Multi-context orchestrator (RN/Metro-safe)
+-- host-node/            # Node stdio + generic daemon composition for host
+-- host-desktop/         # Desktop dialogs, notifications and input inbox (Node-only)
+-- host-protocol/        # Portable host, flow, run and inbox wire schemas
+-- host-monitor/         # Monitor UI for host contexts
+-- http-client/          # Streamable HTTP, OAuth 2.1 client middleware, x-mcp-header encoding
+-- http-server/          # serveHTTP, bearer/JWKS/DID gate, stateless + subscription exchanges
+-- session/              # Portable high-level chat + MCP abstraction
+-- session-node/         # Node stdio session entry
+-- decision-flow/       # System One decide nodes for flow-graph
+-- decision-flow-server/ # MCP task server and Session wiring for decision flows
+-- flow-host/            # Portable flow run lifecycle, approval queue, inbox and recovery
+-- flow-host-node/       # Node-only shared flow service, handlers, stores and telemetry
+-- flow-client/          # Portable FlowControl contract, daemon adapter, wait helpers, flow MCP server
+-- model-provider/       # Provider interface definitions
+-- openai-provider/      # OpenAI integration
+-- anthropic-provider/   # Anthropic Claude integration
+-- ollama-provider/      # Ollama integration
+-- llama-provider/       # Local GGUF inference via node-llama-cpp
+-- system-one-client/    # System One HTTP backend for laya-serve or hosted classification
+-- logger/               # Shared logger utility
+-- cli/                  # mokei CLI commands + composed daemon application entry
```

`@mokei/host`, `@mokei/context-server`, `@mokei/session` and `@mokei/flow-host` are Node-free so they bundle under React Native /
Metro. Node-only entry points live in the `-node` packages: `serveProcess` is in
`@mokei/context-server-node`, and `addLocalContext` (now a method on `NodeContextHost`),
`spawnHostedContext`, `createClient`, `runDaemon` and `ProxyHost` are in `@mokei/host-node`.
`NodeSession.addContext` and its Node-typed `contextHost` are in `@mokei/session-node`.
`@mokei/host-desktop` is Node-only too: it spawns desktop dialog and notification commands through `execa` (no shell).
File names use kebab-case throughout, except React component files (PascalCase, `ChatApp.tsx`) and React hook files (camelCase, `useSession.ts`).
`HTTPSystemOneBackend` speaks to a `laya-serve` sidecar or the hosted TypeSafe API (see
`docs/reference/system-one-sidecar.md`). The bundled System One MCP server exposes a single `predict` tool.

Other workspaces:

```
mcp-servers/fetch/        # published MCP server: HTTP fetch
mcp-servers/sqlite/       # published MCP server: SQLite access
mcp-servers/system-one/   # published MCP server: System One classification
integration-tests/        # cross-package + official SDK interop suites (private)
monitor/                  # monitor UI frontend (private)
website/                  # documentation site (private)
```

---

## Where to Find Things

| Looking for... | Location |
|----------------|----------|
| Protocol types | `packages/context-protocol/src/` |
| Protocol revisions | `packages/context-protocol/src/versions/` |
| Server creation | `packages/context-server/src/` |
| Client implementation | `packages/context-client/src/` |
| Flow runtime | `packages/flow-host/src/` |
| Flow database and stores | `packages/flow-host-node/src/{database,sqlite-run-store,sqlite-task-store,sqlite-trace-store}.ts` |
| Flow telemetry, configuration and retention | `packages/flow-host-node/src/{telemetry,config,flow-dirs,retention}.ts` |
| Portable trace storage and pruning | `packages/flow-host/src/{trace-store,trace-store-span-exporter,trace-store-log-sink,prune-runs}.ts` |
| Flow control and MCP facade | `packages/flow-client/src/` |
| Flow CLI commands | `packages/cli/src/commands/{daemon,flows,runs,inbox}.ts`, `packages/cli/src/run-follow.tsx`, `packages/cli/src/prompts/` |
| Host orchestration | `packages/host/src/` |
| HTTP transports and OAuth | `packages/http-client/src/oauth/`, `packages/http-server/src/auth/`, `packages/host-node/src/oauth/` |
| MRTR and subscriptions | `packages/context-client/src/{mrtr,subscriptions}.ts`, `packages/context-server/src/{mrtr,subscriptions}.ts` |
| Session/Agent | `packages/session/src/`, `packages/session-node/src/` |
| System One | `packages/system-one-client/src/`, `mcp-servers/system-one/`. See `docs/reference/system-one-sidecar.md` |
| Bundled MCP servers | `mcp-servers/*/`, development config `mcp-servers/config.json` |
| Provider interface | `packages/model-provider/src/` |
| CLI commands | `packages/cli/src/commands/` |
| Package tests, where present | `packages/*/test/` (not every package has tests) |
| Integration tests | `integration-tests/` |
| SDK interop harness | `integration-tests/support/interop/` |

---

## Flow runtime

`@mokei/flow-host` exports `createFlowHost({ session, flows, predictor, approval, runStore, taskStore })`.
It registers decision flows on the session and requires elicitation support.
The runtime owns run IDs, approval plans, task watching, input reconciliation and tracing.
Memory run and task stores are the defaults. Injected stores allow recovery when a host is recreated.

`start` accepts a registered flow ID or an inline definition. Allowlisted tool plans launch immediately.
Other plans produce an `awaiting_approval` run and an approval inbox item. Approval re-authorises the plan before minting a single-use grant.
`get`, `list` and `cancel` expose run snapshots. States are `awaiting_approval`, `denied`, `working`, `input_required`, `completed`, `failed` and `cancelled`.

The inbox exposes `list`, `get`, `answer`, `decline` and `cancel` for approval and form input items.
Events are `run:state`, `inbox:added` and `inbox:settled`.
Successful runs expose outcome, output and MCP content. Failed runs expose a typed error with an optional code.
With an OpenTelemetry SDK, runs carry a `traceID` and a `flow.run` span.

`dispose` suspends watching and flow work for recovery. Callers cancel runs explicitly when shutdown should stop them.
Recovered tasks retain their request trace context. Input requested by sibling tools still uses the session's elicitation handler.

`@mokei/flow-host` defines portable JSON store contracts, including `TraceStore` and `createMemoryTraceStore`.
`createTraceStoreSpanExporter` and `createTraceStoreLogSink` capture spans and correlated logs without Node imports.
Each new run owns a trace. Recovery retains its stored trace context.

`@mokei/flow-host-node` supplies SQLite run, task and trace stores sharing one database owned by one process.
Its configuration loaders resolve paths and load flow definitions at startup. Configuration changes apply on restart.
Telemetry installs once per process and captures local spans and logs. Sibling-process telemetry is not ingested locally.
Shutdown awaits retention, host and session disposal, telemetry disposal, then database closure.
The [package lifecycle guide](../../packages/flow-host-node/README.md) describes setup, defaults and configuration.

### Composed flow daemon

The CLI owns `mokei/lib/daemon-entry.js`, selected by existing proxy and monitor commands when
ensuring a daemon exists. It composes `serveHostDaemon`, one `createFlowService` and native
desktop operations. Host-node accepts injected handlers, an event source, flow status and
shutdown hooks. It keeps shared proxy state and imports no flow or desktop implementation.
`composeHandlers` rejects duplicate procedure registrations. The generic standalone host
entry still works and reports flow services unavailable. `runDaemon({ entry, socketPath? })`
lets custom applications select an executable entry without changing the normal socket default.

`info.flowService` reports `starting`, `ready` or `failed`. Failures carry a public type and
message, with sanitised configuration path/issues when available. Proxy serving and monitor
status inspection remain available while flows start or after startup fails. Ready publication
follows initial task and inbox reconciliation for recovered runs, without waiting for their
completion or user answers. Recovery retains run, task, inbox and trace identities. Individual
recovery failures become failed runs. Fatal startup failures clean up partial resources.
Configuration changes and fatal-startup recovery require restart, with no hot reload or retry.
Direct sibling elicitation outside the durable task inbox uses the existing decline fallback.

The portable host protocol exposes `flows.list`, `flows.check`, `runs.start`, `runs.get`,
`runs.list`, `runs.cancel`, `runs.trace`, `inbox.list`, `inbox.get`, `inbox.answer`,
`inbox.decline`, `inbox.cancel` and `inbox.prompt`. Wire snapshots exclude private persistence
metadata and validation functions. Trace reads are run-scoped, can lag batched capture and do
not force flushing. A known run without a trace yields empty spans/logs. Public error codes
distinguish unavailable, missing, invalid, unsupported and competing-prompt requests. Unexpected
failures return `INTERNAL_ERROR` with a generic message. The
[procedure guide](../../packages/flow-host-node/README.md#procedures-and-live-events) lists exact codes.

Every connection shares the service and event source. `service:status`, `run:state`,
`inbox:added` and `inbox:settled` join existing context events with event IDs and timestamps.
Events provide live changes, without replay. Clients subscribe before querying status, runs
and inbox, buffer events during queries, then re-read affected identifiers to reconcile.
Reconnect repeats this sequence. Stream cancellation cleans up only that subscriber.

Desktop notifications default to `false` through `desktop.notifications` in `flows.json`.
After initial reconciliation, zero pending items send nothing, one sends an approval/input
notification and multiple send one count message, such as `3 pending prompts`. New items notify
individually without input previews. On macOS with `alerter`, clicking a single-item
notification opens that item's monitor inbox page when a monitor is attached, or its desktop
prompt otherwise. Clicking the count message opens `/inbox` when a monitor is attached, or only dismisses it otherwise.
Each item has its own notification group, and settling an item removes its
notification. Clicking an `osascript` notification does not open a prompt. Startup IDs are recorded before delivery so settling
items cannot receive duplicate live notifications. Polling and reconnects never notify.
Restart announces the current pending population again. Delivery failure leaves items pending.
Dialogs require explicit `inbox.prompt`, independently of notification opt-in. Runtime
validation and approval policy govern settlement. Caller cancellation or disconnect releases
prompt ownership while preserving the pending item. Settlement elsewhere rejects late answers.

### Monitor surface and presence

The monitor is an inbox surface beside the native desktop. The daemon tries monitor delivery
before native delivery. Each monitor server registers with `monitor.attach`. Each browser tab
opens `monitor.presence` for that attachment and reports Page Visibility API state, notification
permission and its active inbox item.

The daemon pings a tab before trusting its state. A verified visible tab suppresses native
notifications for new items. If no visible tab answers, a tab with browser notification
permission can receive a notification. Items suppressed while attended are not sent later.
Recovery summaries remain native-only, and the monitor reads pending state when it connects.

Prompts route to a verified visible tab first. A hidden tab can receive a browser notification
that links to the prompt. If the monitor cannot deliver, the daemon tries the native dialog.
The flow host remains the only inbox settler. The monitor uses inbox answer, decline and cancel
procedures. A lost monitor target falls back to the next surface. Ping and delivery
acknowledgements expire after five seconds. Stale replies are ignored, and withdrawals close
deliveries that are no longer needed.

The daemon validates monitor attachment URLs as root-path HTTP loopback URLs. Browser sessions
cannot create attachments. The monitor server reconnects after a daemon restart, closes existing
browser streams and attaches again. Open tabs then reconnect and reconcile current state.
Events remain live without replay. Disabling native notifications does not disable the monitor
surface.

Shutdown closes flow admission and aborts dialogs, waits for admitted operations, stops
retention, suspends stored runs, disconnects siblings, drains telemetry and closes SQLite.
It attempts every cleanup despite failures and prevents late initialisation from publishing
ready. The CLI, MCP and monitor drive the service.

Publication is gated on the
[upstream protocol fix and adoption](plans/next/2026-10-02-enkaku-protocol-schema-rebasing.md):
the checked-in workspace patch does not reach consumers of published Mokei packages.

Portable `pruneRuns` deletes old terminal runs and their traces and tasks. Active tasks protect their associated runs.
Its final sweep preserves traces referenced by every retained run and removes older orphan spans and logs.
`startRetention` schedules non-overlapping pruning passes and awaits pending pruning when stopped.

### Flow control, CLI and MCP

`@mokei/flow-client` (portable) defines the `FlowControl` interface (flows, runs and inbox operations), the wait
helpers (`runStatus`, `isActionable`, `hasChanged`, `waitForRun`) and `createFlowControlServer(control, options?)`,
an MCP `ServerConfig` with the tools `list_flows`, `check_flow`, `start_flow`, `flow_status`, `wait_flow`,
`list_runs`, `cancel_flow`, `answer_input`, `decline_input` and `prompt_input`.
Two adapters implement `FlowControl`: `createRemoteFlowControl(client)` over the daemon's Enkaku client, and
`createLocalFlowControl(host, extras?)` from `@mokei/flow-host` over an in-process `FlowHost`.

The CLI exposes the daemon and flows through `mokei daemon start|stop|status|restart|logs`,
`mokei flows list|check|mcp`, `mokei runs start|get|list|cancel|trace` (`runs start --wait` follows the run to a
terminal state, answering its inputs and approvals in a terminal) and `mokei inbox list|show|answer|decline|cancel|prompt`. `mokei flows mcp` serves the flow control
MCP server over stdio against the daemon. The repository `.mcp.json` `flow` entry runs it. Inbox dialogs and
notifications come from `@mokei/host-desktop` inside the daemon, so the MCP server and the CLI stay headless.

---

## CLI Commands

```bash
mokei monitor                      # Monitor MCP server contexts
mokei inspect <command> [args...]  # Inspect available tools and prompts
mokei proxy <command> [args...]    # Proxy an MCP server through the daemon
mokei chat --provider ollama       # Interactive chat (ollama, openai, anthropic, llama)
mokei chat                         # Interactive chat, pick a provider interactively
```

---

## Integration with External Providers

Mokei supports multiple LLM providers through a unified provider interface:

- **OpenAI** (`packages/openai-provider/`) -- Integration with OpenAI models
- **Anthropic** (`packages/anthropic-provider/`) -- Integration with Anthropic Claude models
- **Ollama** (`packages/ollama-provider/`) -- Integration with locally-running Ollama models
- **Llama** (`packages/llama-provider/`) -- Local GGUF inference via node-llama-cpp

Each provider implements the `ModelProvider` interface defined in `packages/model-provider/`, enabling consistent usage across different LLM backends.
