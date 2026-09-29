# Session elicitation

## Goal

Let a `Session` or `AgentSession` answer `elicitation/create` requests from any connected MCP
server, so a server can ask the human user for input mid-call. Today `ContextClient` supports an
`elicit` handler, but `ContextHost` builds every client without one, so no server reached through
a session can elicit.

Elicitation is general: any server benefits. The first consumer is the planned decision-flow
server, whose flow `input` nodes become MCP task input requests, which the MCP Tasks client
fulfils with the same `elicit` handler MRTR uses.

This work is independent of the MCP Tasks extension branch and can land first.

## Scope

- `@mokei/host`: a host-level elicitation handler, passed to every client the host creates.
- `@mokei/host-node`: stdio contexts, `NodeContextHost`, `ProxyHost` and `spawnHostedContext` get
  the same handler.
- `@mokei/session` and `@mokei/session-node`: `Session` and `NodeSession` forward the option to
  the host they create; `Session.addHTTPContext` and `NodeSession.addContext` forward the
  per-context opt-out; `AgentSession` surfaces requests as streamed agent events and resolves
  them through an application callback.

Out of scope:

- Sampling (`createMessage`) and roots at the host level.
- A CLI or UI prompt implementation (applications supply the callback).
- URL-mode completion. URL-mode requests (`2025-11-25`, `mode: 'url'`) reach the handler like
  form-mode ones, but `notifications/elicitation/complete` is not forwarded to the application.
  A UI showing a URL prompt cannot yet close it on server completion. Follow-on work.

## Design

### Host

- New type `HostElicitHandler = (request: HostElicitRequest) => ElicitResult | Promise<ElicitResult>`
  where `HostElicitRequest = { key: string; params: ElicitRequest['params']; signal: AbortSignal }`.
  `key` is the context key of the server asking, so a UI can say who is asking.
- `ContextHostParams` gains `elicit?: HostElicitHandler | true`. Either value turns elicitation
  on for the host. Without the option, clients stay exactly as today.
- Capability contract: a client's capabilities are fixed when it is built, so the choice is made
  at host construction. With `elicit` set, every client the host builds advertises
  `elicitation` from the start (in `initialize` on `2025-11-25`, in each request's `_meta` on
  `2026-07-28`), before any `AgentSession` is attached. Servers may send requests at any time
  after that.
- Dispatch at request time, in this order:
  1. the installed override (below), if any;
  2. else the base handler, when `elicit` is a function;
  3. else decline: `{ action: 'decline' }`. With `elicit: true`, this is the permanent
     behaviour whenever no override is installed, including before one is installed and after
     it is removed.
- `host.elicitationEnabled: boolean` reports whether the host was built with `elicit`.
- `host.handleElicitation(handler: HostElicitOverride): () => void` installs the override and
  returns a function that removes it.
  - `HostElicitOverride = (request: HostElicitRequest, fallback: ElicitFallback) =>
    ElicitResult | Promise<ElicitResult>`, where
    `ElicitFallback = (options?: { signal?: AbortSignal }) => Promise<ElicitResult>`.
    `fallback` runs steps 2 and 3 of the dispatch order (base handler, else decline) with the
    same request, so an override can observe a request and still defer. `options.signal`
    replaces the request's signal for the base handler, so an override can link it to other
    cancellation (the agent passes its combined signal, see Abort).
  - One override at a time. Installing while one is present throws: routing requests between
    two owners by context key alone would send some requests to the wrong owner.
  - The remove function is idempotent, and removes only the override it installed.
  - Calling `handleElicitation` on a host built without `elicit` throws: its clients never
    declared the capability, so no server will send the request.
  - Host disposal removes the override.
- A handler that throws turns into the client's existing error path for a failed
  server-initiated request or MRTR input request; the host adds no extra handling.

### Client-building paths

The host passes each client a key-bound dispatcher (`ElicitHandler` that adds `key`).

- `createHostedContext` gains `elicit?: ElicitHandler` and passes it to `ContextClient`.
- `CreateContextParams` is redefined as
  `Omit<CreateHostedContextParams, 'elicit'> & { key: string; elicit?: false }` (today it
  intersects `CreateHostedContextParams`, which would make `elicit: false` unassignable).
  `createContext` passes the host dispatcher to `createHostedContext`, or nothing when opted
  out.
- These params types gain `elicit?: false` to opt one context out: `CreateContextParams`,
  `AddDirectContextParams`, `HTTPContextParams`, the `NodeContextHost` stdio add params, and
  `ProxySpawnParams`.
- `ContextHost.createContext`, `addDirectContext` and `addHTTPContext` pass the dispatcher
  unless opted out.
- `registerHostedContext` registers a client the caller built; it keeps that client's own
  capabilities and handler, and the host dispatcher is not involved.
- `@mokei/host-node`:
  - `spawnHostedContext` gains `elicit?: ElicitHandler`, independent of any host key, and passes
    it to `createHostedContext`.
  - `NodeContextHost` accepts `elicit` like `ContextHost`; `addLocalContext` passes its
    key-bound dispatcher to `spawnHostedContext` unless opted out.
  - `ProxyHostParams` and `ProxyHost.forDaemon` options gain `elicit`, passed to `super`;
    `ProxyHost.spawn` builds through `createContext`, so it gets the dispatcher. `spawn`
    extracts `elicit` from `ProxySpawnParams`, keeps it out of the daemon payload, and passes it
    to `createContext`.

### Session

- `SessionParams` gains `elicit?: HostElicitHandler | true`, passed to the `ContextHost` the
  session creates.
- When the caller supplies `contextHost`, elicitation is configured on that host; passing
  `elicit` as well throws, because silently ignoring one of the two would hide a configuration
  error.
- `NodeSession` builds its `NodeContextHost` with the caller's `elicit` and does not pass
  `elicit` to `super`, so the default path works. It throws only when the caller supplied
  both `contextHost` and `elicit`.
- Per-context opt-out through the session entry points: `Session.addHTTPContext` forwards
  `elicit` from its params when it rebuilds the host params, and `NodeSession`'s
  `AddContextParams` gains `elicit?: false`, forwarded to `addLocalContext`.

### AgentSession

- `AgentParams` gains `onElicitation?: ElicitationFn`, where
  `ElicitationFn = (request: ElicitationRequest) => ElicitResult | Promise<ElicitResult>` and
  `ElicitationRequest = HostElicitRequest & { toolCall?: FunctionToolCall }`.
- Ownership:
  - On a host with `elicitationEnabled`, `AgentSession` installs the host override with
    `session.contextHost.handleElicitation(...)` at construction and removes it on dispose.
  - On a host without elicitation, the agent installs nothing and constructs as today, so
    existing `AgentSession` users are unaffected. Passing `onElicitation` there throws, because
    no server can reach the callback.
  - One agent owns a host's elicitation at a time: a second `AgentSession` on the same
    elicitation-enabled host throws at construction.
- Attribution: a request is attributed when the agent has exactly one active run and that run
  has exactly one tool call in flight whose context key matches the request's `key` (tool calls
  within a run execute one at a time). The request then gets `toolCall`, goes to that run's
  event channel, and is linked to that tool call's signal (see Abort). Otherwise it is
  unattributed: no `toolCall`, events go to `onEvent` only, and only the request's own signal
  and agent disposal abort it. An unrelated call on the same context during a run can be
  misattributed to the in-flight tool call; the request carries no originating-call identity,
  so the spec accepts this.
- Without `onElicitation`, the override emits events, then calls `fallback({ signal })` with
  the same signal an `onElicitation` callback would get (base handler, else decline).
- New agent events, added to the `AgentEvent` union. Each carries `requestID` (unique per
  request within the agent) so a UI can pair them:
  - `elicitation-request`: `{ type, requestID, key, params, toolCall?, timestamp }`, emitted
    before the callback is awaited.
  - `elicitation-response`: `{ type, requestID, key, action, toolCall?, timestamp }`
    (`action`: `accept`, `decline` or `cancel`), emitted after the callback resolves. Content is
    not included, so answers do not leak into event logs by default.
  - `elicitation-error`: `{ type, requestID, key, error, toolCall?, timestamp }`, emitted when
    the callback rejects or its request is aborted, before the error propagates to the client.
- Pairing: `onEvent` receives exactly one `elicitation-response` or `elicitation-error` after
  every `elicitation-request`, including after the stream is abandoned. A `stream()` consumer
  receives the same pairing while its stream stays open; events emitted after the stream closed
  reach `onEvent` only.

### Agent loop event channel

The agent loop awaits `#executeToolCall`, which buffers `tool-call-start` and the terminal tool
event and returns them together. An elicitation arriving during the call must reach the stream
before its callback is awaited, or an interactive UI waiting on the event hangs (the failure
`tool-call-pending` solved).

- Each run has one ordered event channel. Attributed elicitation events go into the channel of
  the owning run and to `onEvent`; unattributed ones, and any emitted with no run active (for
  example during `setup`), go to `onEvent` only.
- `tool-call-start` goes through the channel when the call starts, so the stream yields it
  before any elicitation event of that call. While the call is in flight, the loop yields
  channel events as they arrive.
- A `2025-11-25` server can start `elicitation/create` during a tool call and return the tool
  result before the user answers. When the call settles, the agent first aborts the callback
  signal of every attributed request of that call still pending (reason: the tool call
  settled), so each emits its `elicitation-error`. The request belongs to the tool call it
  was attributed to and does not outlive it.
- When the call settles, the loop then drains every event already in the channel, and yields
  the tool's terminal event. The stream order is therefore `tool-call-start`, the call's
  elicitation events, then the terminal event, matching the order `onEvent` sees, including a
  response queued in the same microtask as settlement.
- The channel is closed and its waiters woken in the run's `finally`.

### Abort and abandoned streams

- Each run owns an internal `AbortController`, linked to the caller's run signal. The
  generator's `finally` aborts it first, then closes the channel, so a consumer's `return()` or
  `break` counts as cancelling the run.
- The per-tool-call signal is linked to the run controller. Aborting the run aborts the tool
  call, and through the client, the pending MCP request.
- The callback's `signal` for an attributed request combines the request's own signal and the
  per-tool-call signal. This matters on `2025-11-25`: `elicitation/create` is a separate reverse
  RPC, and a server that does not forward its tool signal to `elicit()` never cancels it when the
  tool call is cancelled. The agent aborts the callback anyway; the reverse RPC then fails with
  the abort error.
- An elicitation whose `signal` aborts emits `elicitation-error`. A callback result that
  arrives after abort is ignored.
- `cancelToolCall()` and the tool timeout abort the same per-tool-call signal, with the same
  effect on a pending attributed elicitation.
- The same combined signal is passed to `fallback({ signal })`, so a base handler answering an
  attributed request is cancelled the same way.
- Tool settlement aborts still-pending attributed requests (see Agent loop event channel).

## Errors

| Case | Behaviour |
|---|---|
| Host built without `elicit` | Clients built without `elicit`; no `elicitation` capability (today's behaviour) |
| `handleElicitation` on such a host | Throws |
| `AgentSession` on such a host | Constructs as today; no override. With `onElicitation`, throws |
| Second override on one host, including a second `AgentSession` | Throws |
| No override, base handler set | Base handler answers |
| No override, `elicit: true` | `{ action: 'decline' }` |
| `AgentSession` without `onElicitation` | Events emitted; `fallback()`: base handler answers, else decline |
| `contextHost` and `elicit` both passed to `Session` or `NodeSession` | Constructor throws |
| Callback rejects, `2025-11-25` | `elicitation-error`; the reverse `elicitation/create` RPC returns the error to the server |
| Callback rejects, `2026-07-28` | `elicitation-error`; the MRTR flow fails locally and the tool call rejects; the server gets no input response |
| Request aborted (run cancelled, stream abandoned, tool timeout, `cancelToolCall`) | `elicitation-error`; late callback result ignored |

## Testing

- Host:
  - a direct context whose server elicits during a tool call gets the host handler's result,
    with the right `key`;
  - dispatch order: override, then base, then decline;
  - an override calling `fallback()` gets the base handler's result, else decline;
  - a second override throws; remove is idempotent and restores base behaviour; host disposal
    removes the override;
  - `elicit: false` opt-out on `createContext`, `addDirectContext` and `addHTTPContext`;
  - `registerHostedContext` leaves the supplied client's capabilities untouched;
  - no option leaves the capability undeclared and makes `handleElicitation` throw;
  - key reuse after `remove` routes with the new context.
- Capability declaration on both revisions: `initialize` capabilities on `2025-11-25`, `_meta`
  client capabilities on `2026-07-28`; decline behaviour before an override is installed and
  after it is removed.
- `createContext({ elicit: false })` type-checks and leaves the capability undeclared.
- Host-node: `ProxyHost.spawn({ elicit: false })` leaves the capability undeclared and does not
  send `elicit` to the daemon; `addLocalContext` (with and without opt-out), standalone `spawnHostedContext` with
  its own handler, and a `ProxyHost` built through `forDaemon` with `elicit`.
- Session: option forwarded; `contextHost` plus `elicit` throws; `NodeSession({ elicit })`
  works; `NodeSession` with both throws.
- AgentSession:
  - an agent on a default `Session` or `NodeSession` (no `elicit`) constructs as today; with
    `onElicitation` it throws; a second agent on one elicitation-enabled host throws;
  - `elicitation-request` is yielded before the callback resolves (a callback waiting on the
    consumer having seen the event does not deadlock);
  - `stream()` and `onEvent` see the same order: `tool-call-start`, then the call's elicitation
    events, then the terminal event, for a callback resolving immediately, a response at tool
    settlement, and several requests in one MRTR round;
  - callback rejection emits `elicitation-error` on both revisions, with the revision-specific
    outcome from Errors;
  - `return()` on the stream, explicit abort, tool timeout and `cancelToolCall()` while a
    callback is pending each abort the request and emit `elicitation-error`; on `2025-11-25`,
    both with a server that forwards its tool signal to `elicit()` and one that does not;
  - breaking the stream right after `elicitation-request`: `onEvent` still gets exactly one
    `elicitation-error`;
  - a `2025-11-25` server that starts elicitation and returns its tool result before the
    callback settles: the request is aborted at settlement, and its `elicitation-error`
    precedes the tool's terminal event;
  - a pending base handler reached through `fallback({ signal })` is aborted by tool
    cancellation on `2025-11-25`;
  - without `onElicitation`, a function base handler answers through `fallback()`, else
    decline; dispose removes the override;
  - `toolCall` set during a matching single tool call, omitted otherwise; two concurrent
    `stream()` runs calling the same context leave requests unattributed (`onEvent` only).
- Session opt-out: capability absent for a context added through `Session.addHTTPContext` and
  `NodeSession.addContext` with `elicit: false`.
- Both protocol revisions end to end: `2025-11-25` server-initiated `elicitation/create`, and
  `2026-07-28` MRTR input requests fulfilled through the same handler.

## Docs and release

- `@mokei/host`, `@mokei/host-node` and `@mokei/session` READMEs: the option, the capability
  contract, the override, the events, the decline default, the URL-mode limitation.
- Changeset: minor for `@mokei/host`, `@mokei/host-node`, `@mokei/session`,
  `@mokei/session-node`.
