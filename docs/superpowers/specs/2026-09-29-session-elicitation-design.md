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
  the host they create; `AgentSession` surfaces requests as streamed agent events and resolves
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
- `host.handleElicitation(handler: HostElicitHandler): () => void` installs the override and
  returns a function that removes it.
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
    `ProxyHost.spawn` builds through `createContext`, so it gets the dispatcher.

### Session

- `SessionParams` gains `elicit?: HostElicitHandler | true`, passed to the `ContextHost` the
  session creates.
- When the caller supplies `contextHost`, elicitation is configured on that host; passing
  `elicit` as well throws, because silently ignoring one of the two would hide a configuration
  error.
- `NodeSession` builds its `NodeContextHost` with the caller's `elicit` and does not pass
  `elicit` to `super`, so the default path works. It throws only when the caller supplied
  both `contextHost` and `elicit`.

### AgentSession

- `AgentParams` gains `onElicitation?: ElicitationFn`, where
  `ElicitationFn = (request: ElicitationRequest) => ElicitResult | Promise<ElicitResult>` and
  `ElicitationRequest = HostElicitRequest & { toolCall?: FunctionToolCall }`.
- Ownership: on construction, `AgentSession` installs the host override with
  `session.contextHost.handleElicitation(...)`, and removes it on dispose. One agent owns a
  host's elicitation at a time: a second `AgentSession` on the same host throws at
  construction, and so does an agent on a host without elicitation enabled.
- Attribution: `toolCall` is best-effort. It is set when the agent has exactly one tool call in
  flight whose context key matches the request's `key` (tool calls within a run execute one at a
  time). Otherwise it is omitted. A request caused by an unrelated call on the same context
  during a run can be attributed to the in-flight tool call; the spec accepts this, because the
  request carries no originating-call identity.
- Without `onElicitation`, the override still emits events, then defers to the host's base
  handler, or declines when there is none.
- New agent events, added to the `AgentEvent` union. Each carries `requestID` (unique per
  request within the agent) so a UI can pair them:
  - `elicitation-request`: `{ type, requestID, key, params, toolCall?, timestamp }`, emitted
    before the callback is awaited.
  - `elicitation-response`: `{ type, requestID, key, action, toolCall?, timestamp }`
    (`action`: `accept`, `decline` or `cancel`), emitted after the callback resolves. Content is
    not included, so answers do not leak into event logs by default.
  - `elicitation-error`: `{ type, requestID, key, error, toolCall?, timestamp }`, emitted when
    the callback rejects or its request is aborted, before the error propagates to the client.
  Every `elicitation-request` is followed by exactly one `elicitation-response` or
  `elicitation-error`.

### Agent loop event channel

The agent loop awaits `#executeToolCall`, which buffers `tool-call-start` and the terminal tool
event and returns them together. An elicitation arriving during the call must reach the stream
before its callback is awaited, or an interactive UI waiting on the event hangs (the failure
`tool-call-pending` solved).

- Each run has one ordered event channel. The override pushes elicitation events into the
  channel of the run that owns the in-flight tool call; with no run active (for example during
  `setup`), events go to `onEvent` only.
- Before starting a tool call, the loop subscribes to the channel. While the call is in flight,
  it yields channel events as they arrive.
- When the call settles, the loop drains every event already in the channel, then yields the
  tool's buffered events. Elicitation events therefore always precede that tool call's terminal
  event, including a response queued in the same microtask as settlement.
- The channel is closed and its waiters woken in the run's `finally`.

### Abort and abandoned streams

- Each run owns an internal `AbortController`, linked to the caller's run signal. The
  generator's `finally` aborts it, so a consumer's `return()` or `break` counts as cancelling the
  run.
- The per-tool-call signal is linked to the run controller, so aborting the run aborts the tool
  call, and through the client, the pending MCP request and its elicitation `signal`.
- An elicitation whose `signal` aborts emits `elicitation-error`. A callback result that
  arrives after abort is ignored.
- `cancelToolCall()` and the tool timeout abort the same per-tool-call signal, with the same
  effect on a pending elicitation.

## Errors

| Case | Behaviour |
|---|---|
| Host built without `elicit` | Clients built without `elicit`; no `elicitation` capability (today's behaviour) |
| `handleElicitation` on such a host, including `AgentSession` construction | Throws |
| Second override on one host, including a second `AgentSession` | Throws |
| No override, base handler set | Base handler answers |
| No override, `elicit: true` | `{ action: 'decline' }` |
| `AgentSession` without `onElicitation` | Events emitted; base handler answers, else decline |
| `contextHost` and `elicit` both passed to `Session` or `NodeSession` | Constructor throws |
| Callback rejects | `elicitation-error`, then the error propagates to the client, which reports the request as failed to the server |
| Request aborted (run cancelled, stream abandoned, tool timeout, `cancelToolCall`) | `elicitation-error`; late callback result ignored |

## Testing

- Host:
  - a direct context whose server elicits during a tool call gets the host handler's result,
    with the right `key`;
  - dispatch order: override, then base, then decline;
  - a second override throws; remove is idempotent and restores base behaviour; host disposal
    removes the override;
  - `elicit: false` opt-out on `createContext`, `addDirectContext` and `addHTTPContext`;
  - `registerHostedContext` leaves the supplied client's capabilities untouched;
  - no option leaves the capability undeclared and makes `handleElicitation` throw;
  - key reuse after `remove` routes with the new context.
- Capability declaration on both revisions: `initialize` capabilities on `2025-11-25`, `_meta`
  client capabilities on `2026-07-28`; decline behaviour before an override is installed and
  after it is removed.
- Host-node: `addLocalContext` (with and without opt-out), standalone `spawnHostedContext` with
  its own handler, and a `ProxyHost` built through `forDaemon` with `elicit`.
- Session: option forwarded; `contextHost` plus `elicit` throws; `NodeSession({ elicit })`
  works; `NodeSession` with both throws.
- AgentSession:
  - construction throws on a host without elicitation, and for a second agent on one host;
  - `elicitation-request` is yielded before the callback resolves (a callback waiting on the
    consumer having seen the event does not deadlock);
  - a callback resolving immediately, a response at tool settlement, and several requests in one
    MRTR round all keep order: requests and responses precede the tool's terminal event;
  - callback rejection emits `elicitation-error` on both revisions;
  - `return()` on the stream, explicit abort, tool timeout and `cancelToolCall()` while a
    callback is pending each abort the request and emit `elicitation-error`;
  - without `onElicitation`, base handler then decline; dispose removes the override;
  - `toolCall` set during a matching single tool call, omitted otherwise.
- Both protocol revisions end to end: `2025-11-25` server-initiated `elicitation/create`, and
  `2026-07-28` MRTR input requests fulfilled through the same handler.

## Docs and release

- `@mokei/host`, `@mokei/host-node` and `@mokei/session` READMEs: the option, the capability
  contract, the override, the events, the decline default, the URL-mode limitation.
- Changeset: minor for `@mokei/host`, `@mokei/host-node`, `@mokei/session`,
  `@mokei/session-node`.
