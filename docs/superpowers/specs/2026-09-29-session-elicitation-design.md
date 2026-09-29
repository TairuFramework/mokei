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
- `@mokei/host-node`: stdio contexts get the same handler.
- `@mokei/session`: `Session` forwards the option to the host it creates; `AgentSession` surfaces
  requests as streamed agent events and resolves them through an application callback.

Out of scope: sampling (`createMessage`) and roots at the host level; a CLI or UI prompt
implementation (applications supply the callback).

## Design

### Host

- New type `HostElicitHandler = (request: HostElicitRequest) => ElicitResult | Promise<ElicitResult>`
  where `HostElicitRequest = { key: string; params: ElicitRequest['params']; signal: AbortSignal }`.
  `key` is the context key of the server asking, so a UI can say who is asking.
- `ContextHostParams` gains `elicit?: HostElicitHandler | true`. Either value turns elicitation
  on for the host: every client it creates gets an `elicit` handler and so declares the
  `elicitation` capability (existing `ContextClient` behaviour). `true` enables it with no base
  handler, for a host whose handler is installed later (see `AgentSession`). Without the
  option, clients stay exactly as today.
- Capability is fixed when a client is built, so the choice is made at host construction. The
  handler itself is dispatched at request time:
  - `host.handleElicitation(handler: HostElicitHandler): () => void` installs an override and
    returns a function that removes it. Overrides stack: the most recently installed one
    handles each request; removing it restores the previous one.
  - With no override, the base handler from `ContextHostParams.elicit` handles the request.
  - With neither (`elicit: true`, nothing installed), the request is declined:
    `{ action: 'decline' }`.
  - Calling `handleElicitation` on a host built without `elicit` throws: its clients never
    declared the capability, so no server will send the request.
- `createHostedContext` gains `elicit?: ElicitHandler` and passes it to `ContextClient`. The host
  passes a per-context dispatcher that adds the context `key`.
- Every host path that builds a client uses it: `addDirectContext`, `addHTTPContext`, and
  `NodeContextHost`'s spawned stdio contexts and daemon proxy contexts (`createContext`).
- A context can opt out: the add-context params gain `elicit?: false`.
- A handler that throws turns into the client's existing error path for a failed
  server-initiated request or MRTR input request; the host adds no extra handling.

### Session

- `SessionParams` gains `elicit?: HostElicitHandler | true`, passed to the `ContextHost` the
  session creates. When the caller supplies `contextHost`, elicitation is configured on that
  host instead, and passing `elicit` as well throws: silently ignoring one of the two would hide
  a configuration error.

### AgentSession

- `AgentParams` gains `onElicitation?: ElicitationFn`, where
  `ElicitationFn = (request: ElicitationRequest) => ElicitResult | Promise<ElicitResult>` and
  `ElicitationRequest = HostElicitRequest & { toolCall?: FunctionToolCall }`. `toolCall` is set
  when the request arrives while the agent is executing that tool call.
- On construction, `AgentSession` installs an override with
  `session.contextHost.handleElicitation(...)` and removes it on dispose. The override emits
  events and calls `onElicitation`. The session's host must have elicitation enabled; otherwise
  the `handleElicitation` call throws, so a misconfigured agent fails at construction rather
  than silently never eliciting.
- Without `onElicitation`, the override still emits events, then defers to the host's base
  handler, or declines when there is none. This mirrors `toolApproval: 'ask'` without a
  function: the event is emitted, then the safe default applies.
- New agent events, added to the `AgentEvent` union:
  - `elicitation-request`: `{ type, key, params, toolCall?, timestamp }`, emitted before the
    callback is awaited.
  - `elicitation-response`: `{ type, key, action, toolCall?, timestamp }` (`action` is
    `accept`, `decline` or `cancel`), emitted after the callback settles. Content is not
    included in the event, so answers do not leak into event logs by default.
- Streaming requirement: the agent loop awaits `#executeToolCall`, so an elicitation that
  arrives during a tool call must still reach the stream before the callback is awaited, or an
  interactive UI hangs (the same failure the `tool-call-pending` event solved). The loop races
  tool execution against a per-run event queue: elicitation events pushed onto the queue are
  yielded while the tool call is in flight, then the loop resumes waiting on the tool.
- Requests that arrive outside a run (for example during `setup`) still go through the
  override; their events reach `onEvent` only, since no generator is active.
- Abort: the request `signal` aborts when the client aborts the server request. The
  `AgentSession` run signal does not abort pending elicitations on its own; cancelling the run
  cancels the tool call, which aborts the request.

## Errors

| Case | Behaviour |
|---|---|
| Host built without `elicit` | Clients built without `elicit`; no `elicitation` capability (today's behaviour) |
| `handleElicitation` on such a host (including `AgentSession` construction) | Throws |
| `elicit: true`, no override installed | `{ action: 'decline' }` |
| `contextHost` and `elicit` both passed to `Session` | Constructor throws |
| `onElicitation` throws | The error propagates to the client, which reports the request as failed to the server |
| No `onElicitation` in `AgentSession` | Events emitted, then `{ action: 'decline' }` |

## Testing

- Host: a direct context whose server elicits during a tool call receives the host handler's
  result, with the right `key`; overrides stack and unwind; `elicit: true` with no override
  declines; `elicit: false` opts a context out; no option leaves the capability undeclared and
  makes `handleElicitation` throw.
- Host-node: a spawned stdio context receives the handler.
- Session: handler forwarded; `contextHost` plus `elicit` throws.
- AgentSession: construction on a host without elicitation throws; `elicitation-request` is yielded before the callback resolves (a callback that
  waits on the consumer having seen the event does not deadlock); `elicitation-response`
  follows; no callback defers to the base handler or declines; dispose removes the override; `toolCall` is set during tool execution.
- Both protocol revisions: `2025-11-25` server-initiated `elicitation/create`, and
  `2026-07-28` MRTR input requests fulfilled through the same handler.

## Docs and release

- `@mokei/host` and `@mokei/session` READMEs: the handler, the events, the decline default.
- Changeset: minor for `@mokei/host`, `@mokei/host-node`, `@mokei/session`.
